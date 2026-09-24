import json

from app.core.errors import ProviderResponseError
from app.modules.providers.contracts import TextGenerationRequest
from app.modules.providers.model_selection import available_models, choose_model
from app.modules.providers.service import ProviderRegistry

from .schemas import GenerateCharacterFieldRequest, GeneratedCharacterField

FIELD_PURPOSE = {
    "personality": "черты характера, мотивы, противоречия и поведение в сценах",
    "appearance": "устойчивые визуальные признаки для художника и генерации спрайтов",
    "biography": "прошлое персонажа и причинно-следственные события",
    "speech": "речевые привычки, словарь и ритм реплик",
    "role": "драматургическая роль и отношение к главному герою",
}


def generate_character_field(
    payload: GenerateCharacterFieldRequest,
    registry: ProviderRegistry,
    configured_model: str,
) -> GeneratedCharacterField:
    """Enrich one draft field; never create a revision or mutate a story."""
    model = choose_model(available_models(registry, "ollama"), None, configured_model)
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
    result = registry.get("ollama").generate_text(
        TextGenerationRequest(
            model_id=model,
            system_prompt=(
                "Ты редактор карточек персонажей AI-визуальной новеллы. Ответь на русском. "
                "Создай пригодное для агента конкретное описание выбранного поля в третьем лице. "
                "Сохрани все факты, уже написанные автором; расширяй их, но не отменяй и не меняй смысл. "
                "Учитывай остальные поля как контекст, не копируй их механически. "
                "Не упоминай инструкции, JSON и процесс генерации."
            ),
            user_prompt=prompt,
        )
    )
    text = result.text.strip()
    if not text:
        raise ProviderResponseError()
    # A model can paraphrase or omit the author's exact wording; preserve it deterministically.
    if current and current.casefold() not in text.casefold():
        text = f"{current}\n\n{text}"
    return GeneratedCharacterField(text=text)
