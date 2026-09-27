"""Generate one editable author field without changing the canonical draft."""

import json
from typing import Literal

from pydantic import Field, ValidationError

from app.core.errors import ProviderResponseError
from app.modules.llm_harness.executor import GenerationTask, LLMHarness
from app.modules.llm_harness.models import catalog_for_model
from app.modules.providers.contracts import TextProposal
from app.modules.providers.model_selection import available_models, choose_model
from app.modules.providers.service import ProviderRegistry

from .schemas import StoryDraft, StrictAuthorModel

StoryGenerationField = Literal[
    "identity.title", "identity.short_description", "identity.premise", "identity.setting",
    "identity.opening_situation", "identity.genres", "identity.tone",
    "cast.role", "rules.themes_allowed", "rules.themes_blocked",
    "rules.generation_policy.desired_themes", "rules.generation_policy.forbidden_outcomes",
    "canon.creative_goals", "canon.fact.title", "canon.fact.statement",
    "canon.beat.title", "canon.beat.description", "canon.beat.completion_evidence",
]

FIELD_PURPOSE: dict[StoryGenerationField, str] = {
    "identity.title": "краткое запоминающееся название истории",
    "identity.short_description": "краткое описание для каталога без сюжетных спойлеров",
    "identity.premise": "завязка, основной конфликт и драматический вопрос",
    "identity.setting": "конкретное место, время и особенности мира",
    "identity.opening_situation": "первая игровая ситуация, из которой игрок может действовать",
    "identity.genres": "короткие жанровые метки через запятую",
    "identity.tone": "короткие метки настроения истории через запятую",
    "cast.role": "роль выбранного персонажа в этой истории и его связи с конфликтом",
    "rules.themes_allowed": "разрешённые темы через запятую",
    "rules.themes_blocked": "темы, которые следует исключить, через запятую",
    "rules.generation_policy.desired_themes": "желаемые мотивы и образы для сцен",
    "rules.generation_policy.forbidden_outcomes": "исходы, которые модель не должна предлагать",
    "canon.creative_goals": "творческие цели для повествования без жёсткого маршрута",
    "canon.fact.title": "краткое название факта канона",
    "canon.fact.statement": "точное утверждение о мире, персонаже или сюжете",
    "canon.beat.title": "краткое название ключевого события",
    "canon.beat.description": "описание ключевого события и его сюжетного смысла",
    "canon.beat.completion_evidence": "наблюдаемый признак завершения ключевого события",
}

SHORT_FIELDS = {"identity.title", "canon.fact.title", "canon.beat.title"}
LIST_FIELDS = {"identity.genres", "identity.tone", "rules.themes_allowed", "rules.themes_blocked"}


class InvalidStoryGenerationTargetError(ValueError):
    pass


class GenerateStoryFieldRequest(StrictAuthorModel):
    field: StoryGenerationField
    current_text: str = Field(default="", max_length=6000)
    target_id: str | None = Field(default=None, max_length=120)
    draft: StoryDraft


class GeneratedStoryField(StrictAuthorModel):
    text: str = Field(min_length=1, max_length=6000)


def generate_story_field(
    payload: GenerateStoryFieldRequest,
    registry: ProviderRegistry,
    configured_model: str,
    context_tokens: int,
    model_context_windows: dict[str, int],
) -> GeneratedStoryField:
    """Use the selected provider and the live unsaved draft as creative context."""
    draft = payload.draft
    provider_id = draft.rules.recommended_provider_id
    models = available_models(registry, provider_id)
    requested = draft.rules.recommended_model_id
    model = choose_model(models, requested if requested in models else None, configured_model)
    current = payload.current_text.strip()
    items = (draft.canon.facts if payload.field.startswith("canon.fact.") else
             draft.canon.beats if payload.field.startswith("canon.beat.") else
             draft.cast.characters if payload.field == "cast.role" else [])
    target = next((item for item in items if item.id == payload.target_id), None)
    if (payload.field.startswith(("canon.fact.", "canon.beat.")) or payload.field == "cast.role") and target is None:
        raise InvalidStoryGenerationTargetError
    limit = 120 if payload.field in SHORT_FIELDS else 500 if payload.field == "identity.short_description" else 6000
    context = {
        "field": payload.field,
        "purpose": FIELD_PURPOSE[payload.field],
        "existing_text_to_preserve_and_expand": current,
        "target_item": target.model_dump() if target else None,
        "story": {
            "identity": draft.identity.model_dump(),
            "mode": draft.mode.mode,
            "rules": draft.rules.model_dump(exclude={"recommended_provider_id", "recommended_model_id"}),
            "canon": draft.canon.model_dump(),
            "cast": draft.cast.model_dump(),
            "characters": [item.model_dump() for item in draft.character_revisions],
        },
    }
    result = LLMHarness(
        registry, catalog_for_model(registry, context_tokens, model_context_windows, provider_id, model)
    ).run(GenerationTask(
        task_kind="story_field", provider_id=provider_id, model_id=model, output_kind="text",
        system_prompt=(
            "Ты редактор AI-визуальной новеллы. Ответь по-русски только содержимым выбранного поля. "
            "Если автор уже написал текст, сохрани все его факты и смысл, расширь и уточни без противоречий. "
            "Учитывай остальные поля, режим истории, правила содержания и персонажей. "
            "Не копируй чужие поля, не упоминай JSON, инструкции и процесс генерации. "
            f"Ответ не должен превышать {limit} символов. Для списков ответь метками через запятую."
        ),
        user_prompt=json.dumps(context, ensure_ascii=False),
        response_schema=TextProposal.model_json_schema(),
    ))
    text = result.value.text.strip()
    if not text:
        raise ProviderResponseError()
    if current and current.casefold() not in text.casefold():
        text = f"{current} — {text}" if payload.field in SHORT_FIELDS else f"{current}\n\n{text}"
    if len(text) > limit:
        raise ProviderResponseError()
    if payload.field in LIST_FIELDS:
        labels = [item.strip() for item in text.replace("\n", ",").split(",") if item.strip()]
        if len(labels) > 24 or any(len(item) > 120 for item in labels):
            raise ProviderResponseError()
    try:
        return GeneratedStoryField(text=text)
    except ValidationError as error:
        raise ProviderResponseError() from error
