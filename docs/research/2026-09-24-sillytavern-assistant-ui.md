# SillyTavern и assistant-ui: применимые практики

Срез SillyTavern: [`06bde939`](https://github.com/SillyTavern/SillyTavern/tree/06bde939fb1e9c4c8d8641d810f0a916b5bce127). Сравнение относится к текущему первому игровому срезу «Эха неона», а не к полному функциональному паритету.

| Тема | SillyTavern / assistant-ui | Наше решение сейчас | Следующий оправданный шаг |
| --- | --- | --- | --- |
| Промпт и контекст | [SillyTavern собирает промпт с учётом порядка блоков и лимитов токенов](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/openai.js); [World Info отдельно бюджетирует lore](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/world-info.js). | Версионированный промпт и подтверждённый ход хранятся на сервере; студия показывает версию промпта. | До длинных историй добавить измеряемый бюджет контекста и тесты усечения, не переносить глобальный конфиг SillyTavern. |
| Ветвление | [Bookmark создаёт снимок ветки чата](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/public/scripts/bookmarks.js). | Тестовая сессия автора создаётся отдельно от прохождения игрока. | При появлении редактора сцен добавить fork от конкретного подтверждённого хода; обычное копирование текущей сессии пока не нужно. |
| Надёжность записи | [Файловые чаты пишутся атомарно](https://github.com/SillyTavern/SillyTavern/blob/06bde939fb1e9c4c8d8641d810f0a916b5bce127/src/endpoints/chats.js). | У нас БД и проверка `state_version` + `request_id`; это другой механизм с той же целью — не потерять или не продублировать ход. | Сохранять контракт идемпотентности и покрывать конфликт/повтор запроса интеграционными тестами. |
| Состояния агента | [assistant-ui различает running, requires-action, incomplete и complete](https://www.assistant-ui.com/docs/tools/tool-ui); [Progress Tracker описывает pending/in-progress/completed/failed](https://github.com/assistant-ui/tool-ui/blob/main/apps/www/app/docs/progress-tracker/content.mdx). | Игровая сцена и студия показывают фактические loading, submitting, ready, error и provider unavailable; загрузка обозначена неопределённым спиннером, процент не выдумывается. | Реальный поэтапный прогресс показывать лишь после появления серверных событий для этих этапов. |

## Границы реализации

Мы не переносим чатовый runtime assistant-ui: новелла — сцена с выбором и авторским инспектором, не универсальный мессенджер. Повторно используем shadcn/ui Mira (`b1D1mJdI`) для примитивов; цвета истории локально задаются CSS-токенами по `story.slug`, а системные меню наследуют отдельную базовую тему. Сервер остаётся источником истины: после загрузки сессии `latest_turn` содержит действие и версию промпта, нужные инспектору.
