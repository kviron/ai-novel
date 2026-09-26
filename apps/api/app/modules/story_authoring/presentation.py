"""One public representation for persisted-draft diagnostics."""

from app.modules.story_authoring.schemas import DraftDiagnostic, DraftValidationResult, StoryDraft

_RUSSIAN_MESSAGES = {
    "identity_title_required": "Укажите название новеллы.",
    "identity_slug_required": "Укажите адресное имя новеллы.",
    "identity_premise_required": "Опишите замысел новеллы.",
    "identity_setting_required": "Опишите место действия.",
    "identity_opening_situation_required": "Опишите начальную ситуацию.",
    "identity_slug_duplicate": "Адресное имя уже занято другой новеллой.",
    "cover_missing": "Добавьте обложку, чтобы новеллу было проще узнать.",
    "cover_material_invalid": "Выберите обложку, загруженную для этой новеллы.",
    "hero_source_required": "Выберите хотя бы один источник героя.",
    "hero_fixed_revision_required": "Выберите версию фиксированного героя.",
    "hero_fixed_revision_missing": "Выбранная версия героя не найдена.",
    "hero_character_underage": "Возраст героя должен быть не меньше 18 лет.",
    "hero_fixed_cast_conflict": "Фиксированный герой не может одновременно быть персонажем под управлением модели.",
    "cast_optional_empty": "В новелле пока нет дополнительных персонажей.",
    "cast_id_duplicate": "У персонажей повторяется идентификатор привязки.",
    "cast_character_duplicate": "Один персонаж добавлен в состав несколько раз.",
    "cast_order_duplicate": "У персонажей повторяется порядок отображения.",
    "cast_revision_missing": "Версия персонажа не найдена.",
    "cast_revision_character_mismatch": "Выбранная версия принадлежит другому персонажу.",
    "cast_character_underage": "Возраст персонажа должен быть не меньше 18 лет.",
    "choice_count_invalid": "Количество вариантов не соответствует правилу выбора.",
    "theme_overlap": "Тема не может быть одновременно разрешена и запрещена.",
    "provider_unsupported": "Выбранный провайдер не поддерживается.",
    "model_identifier_required": "Укажите корректный идентификатор модели.",
    "model_unavailable": "Рекомендованная модель сейчас недоступна.",
    "hybrid_structure_required": "Добавьте жёсткий факт канона или обязательное событие.",
    "freeform_fact_forbidden": "В свободном режиме нельзя добавлять факты канона.",
    "freeform_beat_forbidden": "В свободном режиме нельзя добавлять обязательные события.",
    "ending_gate_required": "Добавьте обязательное событие, открывающее завершение истории.",
    "soft_guidance_missing": "Добавьте творческую цель или мягкую подсказку для модели.",
    "fact_id_duplicate": "У фактов канона повторяется идентификатор.",
    "fact_order_duplicate": "У фактов канона повторяется порядок.",
    "fact_character_missing": "Факт ссылается на отсутствующего персонажа.",
    "beat_id_duplicate": "У событий повторяется идентификатор.",
    "beat_order_duplicate": "У событий повторяется порядок.",
    "beat_dependency_missing": "Событие ссылается на отсутствующее предыдущее событие.",
    "beat_dependency_not_prior": "Событие может зависеть только от более раннего события.",
    "beat_dependency_cycle": "Зависимости событий образуют цикл.",
}


def public_diagnostics(diagnostics: list[DraftDiagnostic]) -> list[DraftDiagnostic]:
    """Keep codes stable while giving every endpoint the same control path and safe text."""
    ordered = sorted(diagnostics, key=lambda item: item.severity != "error")
    return [
        item.model_copy(
            update={
                "field": item.field if item.field.startswith(f"{item.step}.") else f"{item.step}.{item.field}",
                "message": _RUSSIAN_MESSAGES[item.code],
            }
        )
        for item in ordered
    ]


def public_draft(draft: StoryDraft) -> StoryDraft:
    return draft.model_copy(update={"diagnostics": public_diagnostics(draft.diagnostics)})


def public_validation(result: DraftValidationResult) -> DraftValidationResult:
    return result.model_copy(update={"diagnostics": public_diagnostics(result.diagnostics)})
