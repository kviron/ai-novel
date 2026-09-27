import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

type Draft = { story_id: string; version_id: string; draft_revision: number; identity: { title: string; premise: string }; canon: { facts: { id: string }[]; beats: { id: string }[] } }
const read = async <T>(response: Awaited<ReturnType<APIRequestContext['fetch']>>) => { expect(response.ok(), await response.text()).toBeTruthy(); return response.json() as Promise<T> }

async function save(page: Page) {
  const response = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/api/author/stories/'))
  await page.getByRole('button', { name: 'Сохранить раздел' }).click(); expect((await response).ok()).toBeTruthy()
}
async function step(page: Page, name: string) { await page.getByRole('button', { name, exact: true }).click(); await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'step') }
async function create(page: Page, title: string, slug: string) {
  await page.goto('/studio'); await page.getByRole('link', { name: 'Создать новеллу' }).click(); await expect(page).toHaveURL(/\/studio\/stories\/[^/]+\/edit$/)
  for (const [label, value] of [['Название', title], ['Адресное имя', slug], ['Краткое описание', 'Полный авторский E2E-маршрут.'], ['Завязка', 'Герой ищет источник сигнала в ночном городе.'], ['Место и время', 'Неоновый город ночью.'], ['Начальная ситуация', 'Аканэ встречает героя у архива сигнала.'], ['Жанры', 'мистика'], ['Тон', 'напряжённый']]) await page.getByRole('textbox', { name: label, exact: true }).fill(value)
  await save(page); return page.url().split('/').at(-2)!
}
async function cast(page: Page, name: string) { await step(page, 'Состав'); await page.getByRole('button', { name: new RegExp(`Добавить ${name}`) }).click(); await expect(page.getByText(new RegExp(`${name} · ревизия 1 ·`))).toBeVisible(); await save(page) }
async function publish(page: Page) { await step(page, 'Проверка'); await page.getByRole('button', { name: 'Проверить черновик' }).click(); await expect(page.getByRole('button', { name: 'Опубликовать' })).toBeEnabled(); await page.getByRole('button', { name: 'Опубликовать' }).click(); await expect(page.getByRole('button', { name: 'Создать новую редакцию' })).toBeVisible() }

test('свободная новелла проходит видимый конструктор и закрепляет опубликованную версию', async ({ page, request }) => {
  const storyId = await create(page, 'E2E Свободный маршрут', 'e2e-freeform-route')
  await step(page, 'Режим'); await expect(page.getByRole('radio', { name: 'Свободный' })).toBeChecked(); await save(page)
  await step(page, 'Герой'); await expect(page.getByRole('radio', { name: 'Выбор игрока' })).toBeChecked(); await expect(page.getByRole('checkbox', { name: 'Новый герой игрока' })).toBeChecked(); await save(page)
  await cast(page, 'Аканэ Куроха')
  await step(page, 'Правила'); await page.getByRole('textbox', { name: 'Желаемые мотивы' }).fill('исследование памяти'); await save(page)
  await step(page, 'Канон'); await page.getByRole('textbox', { name: 'Творческие цели' }).fill('Сохранять свободу выбора героя.'); await save(page)
  const draft = await read<Draft>(await request.get(`/api/author/stories/${storyId}/draft`)); await publish(page)
  await page.goto('/'); const card = page.getByRole('heading', { name: 'E2E Свободный маршрут' }).locator('xpath=ancestor::*[@data-slot="card"]'); await card.getByRole('button', { name: 'Начать новую игру' }).click()
  await page.getByRole('textbox', { name: 'Имя' }).fill('E2E Герой'); await page.getByRole('textbox', { name: 'Предыстория' }).fill('Ищет сигнал.'); await page.getByRole('button', { name: 'Проверить героя' }).click()
  const response = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/stories/${storyId}/sessions`)); await page.getByRole('button', { name: 'Начать историю' }).click()
  const session = await (await response).json() as { story: { current_published_version_id: string }; protagonist: { source_kind: string; name: string } }
  expect(session.story.current_published_version_id).toBe(draft.version_id); expect(session.protagonist).toMatchObject({ source_kind: 'draft', name: 'E2E Герой' })
})

test('гибридный конструктор замораживает draft test, repair атомарен, старая игра остаётся на v1', async ({ page, request }) => {
  test.setTimeout(60_000)
  const fake = `http://127.0.0.1:${process.env.E2E_FAKE_PORT ?? 11435}`; await request.post(`${fake}/test/reset`)
  const storyId = await create(page, 'E2E Гибридная v1', 'e2e-hybrid-v1')
  await step(page, 'Режим'); await page.getByRole('radio', { name: 'Гибридный' }).click(); await save(page)
  await step(page, 'Герой'); await page.getByRole('radio', { name: 'Фиксированный герой' }).click(); await page.getByRole('button', { name: /Выбрать Аканэ Куроха · ревизия 1 · 25 лет/ }).click(); await expect(page.locator('[data-slot="badge"]').getByText('Аканэ Куроха · ревизия 1 · 25 лет')).toBeVisible(); await save(page)
  await cast(page, 'Марк Ветров')
  await step(page, 'Правила'); await page.getByRole('combobox', { name: 'Завершение истории' }).click(); await page.getByRole('option', { name: 'После обязательных событий' }).click(); await save(page)
  await step(page, 'Канон'); await page.getByRole('textbox', { name: 'Творческие цели' }).fill('Не завершать историю до открытия архива.'); await page.getByRole('button', { name: 'Добавить факт' }).click(); await page.getByRole('textbox', { name: 'Название факта 1' }).fill('signal-exists'); await page.getByRole('textbox', { name: 'Описание факта 1' }).fill('Сигнал реален и исходит из архива.')
  await page.getByRole('button', { name: 'Добавить событие' }).click(); await page.getByRole('textbox', { name: 'Название события 1' }).fill('open-archive'); await page.getByRole('textbox', { name: 'Описание события 1' }).fill('Герой открывает архив сигнала.'); await page.getByRole('textbox', { name: 'Признак завершения' }).fill('Дверь архива открыта.'); await page.getByRole('checkbox', { name: 'Обязательное' }).click(); await page.getByRole('checkbox', { name: 'Открывает финал' }).click(); await save(page)
  const draft = await read<Draft>(await request.get(`/api/author/stories/${storyId}/draft`)); const beatId = draft.canon.beats[0].id; await step(page, 'Проверка')
  const testResponse = page.waitForResponse((r) => r.url().endsWith(`/api/author/stories/${storyId}/test-sessions`)); await page.getByRole('button', { name: 'Запустить тест' }).click()
  const author = await (await testResponse).json() as { id: string; protagonist: { source_revision_id: string; age: number; name: string } }; expect(author.protagonist).toMatchObject({ name: 'Аканэ Куроха', age: 25 }); expect(author.protagonist.source_revision_id).toBeTruthy()
  type Audit = { source: string; draft_snapshot_id: string; snapshot_sha256: string; source_draft_revision: number; snapshot_title: string; snapshot_premise: string; completed_beat_ids: string[] }
  const before = await read<Audit>(await request.get(`/api/author/stories/test-sessions/${author.id}/audit`)); expect(before).toMatchObject({ source: 'draft_snapshot', snapshot_title: 'E2E Гибридная v1', snapshot_premise: 'Герой ищет источник сигнала в ночном городе.' }); expect(before.draft_snapshot_id).toBeTruthy(); expect(before.snapshot_sha256).toMatch(/^[a-f0-9]{64}$/)
  await page.goto(`/studio/stories/${storyId}/edit`); await page.getByRole('textbox', { name: 'Завязка' }).fill('ИЗМЕНЁННЫЙ исходный черновик.'); await save(page); expect(await read<Audit>(await request.get(`/api/author/stories/test-sessions/${author.id}/audit`))).toEqual(before)
  await page.goto(`/studio/${author.id}`); await page.getByRole('textbox', { name: 'Ваше действие' }).fill('Попытка раннего финала'); const sentRequest = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/api/sessions/${author.id}/turns`)); await page.getByRole('button', { name: 'Отправить' }).click(); const sent = await sentRequest; await expect(page.getByText('Исправленный ответ после проверки канона.')).toBeVisible()
  type Call = { prompt: string; repaired: boolean; proposal: { completed_beat_ids: string[]; requests_ending: boolean } }
  const calls = await read<Call[]>(await request.get(`${fake}/test/requests`)); expect(calls).toHaveLength(2); expect(calls[0].prompt).toContain('signal-exists'); expect(calls[0].prompt).toContain('open-archive'); expect(calls[0]).toMatchObject({ repaired: false, proposal: { completed_beat_ids: [], requests_ending: true } }); expect(calls[1].repaired).toBe(true); expect(calls[1].proposal.completed_beat_ids).toContain(beatId)
  expect((await read<Audit>(await request.get(`/api/author/stories/test-sessions/${author.id}/audit`))).completed_beat_ids).toEqual([beatId]); const body = sent.postDataJSON() as object; expect((await read<{ state_version: number }>(await request.post(`/api/sessions/${author.id}/turns`, { data: body }))).state_version).toBe(2); expect((await read<{ state_version: number }>(await request.get(`/api/sessions/${author.id}`))).state_version).toBe(2)
  await page.goto(`/studio/stories/${storyId}/edit`); await publish(page); const player = await read<{ id: string; story: { current_published_version_id: string } }>(await request.post(`/api/stories/${storyId}/sessions`, { data: { provider_id: 'ollama', hero: { source_kind: 'fixed' } } })); expect(player.story.current_published_version_id).toBe(draft.version_id)
  await page.getByRole('button', { name: 'Создать новую редакцию' }).click(); await step(page, 'Основа'); await page.getByRole('textbox', { name: 'Название' }).fill('E2E Гибридная v2'); await save(page); await publish(page)
  expect((await read<{ story: { title: string; current_published_version_id: string } }>(await request.get(`/api/sessions/${player.id}`))).story).toMatchObject({ title: 'E2E Гибридная v1', current_published_version_id: draft.version_id })
})
