import json

from sqlmodel import Session

from app.core.errors import ProviderResponseError
from app.db.models import CharacterRevision, Story
from app.modules.llm_harness.executor import GenerationTask, LLMHarness
from app.modules.llm_harness.models import catalog_for_model
from app.modules.providers.contracts import TextProposal
from app.modules.providers.model_selection import available_models, choose_model
from app.modules.providers.service import ProviderRegistry

from .schemas import GenerateCharacterFieldRequest, GeneratedCharacterField, GenerateStoryRoleRequest
from .service import InvalidRevisionError, StoryNotFoundError

FIELD_PURPOSE = {
    "personality": "черты характера, мотивы, противоречия и поведение в сценах",
    "appearance": "устойчивые визуальные признаки для художника и генерации спрайтов",
    "biography": "прошлое персонажа и причинно-следственные события",
    "speech": "речевые привычки, словарь и ритм реплик",
}


def generate_character_field(
    payload: GenerateCharacterFieldRequest,
    registry: ProviderRegistry,
    configured_model: str,
    context_tokens: int = 16384,
    model_context_windows: dict[str, int] | None = None,
) -> GeneratedCharacterField:
    """Enrich one draft field; never create a revision or mutate a story."""
    current = getattr(payload.draft, payload.field).strip()
    prompt = json.dumps(
        {
            "field": payload.field,
            "purpose": FIELD_PURPOSE[payload.field],
            "existing_text_to_preserve_and_expand": current,
            "character_draft": payload.draft.model_dump(),
        },
        ensure_ascii=False,
    )
    return _generate_text(
        registry,
        "character_field",
        configured_model,
        current,
        (
            "Ты редактор карточек персонажей AI-визуальной новеллы. Ответь на русском. "
            "Создай пригодное для агента конкретное описание выбранного поля в третьем лице. "
            "Сохрани все факты, уже написанные автором; расширяй их, но не отменяй и не меняй смысл. "
            "Учитывай остальные поля как контекст, не копируй их механически. "
            "Не упоминай инструкции, JSON и процесс генерации."
        ),
        prompt,
        context_tokens,
        model_context_windows,
    )


def generate_story_role(
    session: Session,
    story_id: str,
    payload: GenerateStoryRoleRequest,
    registry: ProviderRegistry,
    configured_model: str,
    context_tokens: int = 16384,
    model_context_windows: dict[str, int] | None = None,
) -> GeneratedCharacterField:
    """Draft a story-local role from the chosen profile without changing either record."""
    story = session.get(Story, story_id)
    if story is None:
        raise StoryNotFoundError
    revision = session.get(CharacterRevision, payload.revision_id)
    if revision is None or revision.character_id != payload.character_id:
        raise InvalidRevisionError
    current = payload.existing_text.strip()
    prompt = json.dumps(
        {
            "story": {"title": story.title, "premise": story.premise, "description": story.description},
            "character": {
                "name": revision.name,
                "personality": revision.personality,
                "biography": revision.biography,
                "speech": revision.speech,
            },
            "existing_text_to_preserve_and_expand": current,
        },
        ensure_ascii=False,
    )
    return _generate_text(
        registry,
        "story_role",
        configured_model,
        current,
        "Ты редактор AI-визуальной новеллы. На русском языке опиши роль персонажа только в этой истории: "
        "его функцию в сюжете, отношения, мотивы и возможные конфликты. Не меняй факты автора. "
        "Не упоминай инструкции, JSON и процесс генерации.",
        prompt,
        context_tokens,
        model_context_windows,
    )


def _generate_text(
    registry: ProviderRegistry,
    task_kind: str,
    configured_model: str,
    current: str,
    system_prompt: str,
    user_prompt: str,
    context_tokens: int,
    model_context_windows: dict[str, int] | None,
) -> GeneratedCharacterField:
    model = choose_model(available_models(registry, "ollama"), None, configured_model)
    harness = LLMHarness(registry, catalog_for_model(registry, context_tokens, model_context_windows, "ollama", model))
    result = harness.run(
        GenerationTask(
            task_kind=task_kind,
            provider_id="ollama",
            model_id=model,
            output_kind="text",
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            response_schema=TextProposal.model_json_schema(),
        )
    )
    text = result.value.text.strip()
    if not text:
        raise ProviderResponseError()
    # A model can paraphrase or omit the author's exact wording; preserve it deterministically.
    if current and current.casefold() not in text.casefold():
        text = f"{current}\n\n{text}"
    return GeneratedCharacterField(text=text)
