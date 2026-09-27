import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

type Draft = {
  story_id: string
  version_id: string
  draft_revision: number
  identity: Record<string, unknown>
  rules: Record<string, unknown>
}

async function json<T>(response: Awaited<ReturnType<APIRequestContext['fetch']>>): Promise<T> {
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json() as Promise<T>
}

async function saveSection(
  request: APIRequestContext,
  draft: Draft,
  section: string,
  data: unknown,
): Promise<Draft> {
  return json<Draft>(await request.put(`/api/author/stories/${draft.story_id}/draft/${section}`, {
    data: { expected_revision: draft.draft_revision, data },
  }))
}

async function addAkane(request: APIRequestContext, draft: Draft): Promise<Draft> {
  const characters = await json<Array<{ character_id: string; current_revision_id: string }>>(
    await request.get('/api/characters'),
  )
  const akane = characters.find(({ character_id }) => character_id === 'akane')
  expect(akane).toBeTruthy()
  return saveSection(request, draft, 'cast', {
    characters: [{
      id: `authoring-akane-${draft.story_id}`, character_id: akane!.character_id, revision_id: akane!.current_revision_id,
      order_index: 0, role: 'Проводница', color: '#d94040', playable: false,
    }],
  })
}

async function createDraft(request: APIRequestContext, mode: 'freeform' | 'hybrid', suffix: string) {
  let draft = await json<Draft>(await request.post('/api/author/stories'))
  draft = await saveSection(request, draft, 'identity', {
    ...draft.identity,
    title: `E2E ${suffix}`,
    slug: mode === 'freeform' ? 'e2e-freeform-route' : 'e2e-hybrid-v1',
    short_description: 'Проверка полного авторского маршрута.',
    premise: 'Герой ищет источник сигнала в ночном городе.',
    setting: 'Неоновый город ночью.',
    opening_situation: 'Аканэ встречает героя у архива сигнала.',
    genres: ['мистика'],
    tone: ['напряжённый'],
  })
  draft = await saveSection(request, draft, 'mode', { mode })
  draft = await addAkane(request, draft)
  return draft
}

async function openReview(page: Page, storyId: string) {
  await page.goto(`/studio/stories/${storyId}/edit`)
  await page.getByRole('button', { name: 'Проверка' }).click()
}

async function publishFromReview(page: Page) {
  await page.getByRole('button', { name: 'Проверить черновик' }).click()
  await expect(page.getByRole('button', { name: 'Опубликовать' })).toBeEnabled()
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await expect(page.getByRole('button', { name: 'Создать новую редакцию' })).toBeVisible()
}

test('свободная новелла публикуется, запускается игроком и сохраняет ID версии в ходе', async ({ page, request }) => {
  const draft = await createDraft(request, 'freeform', 'Свободный маршрут')
  await openReview(page, draft.story_id)
  await publishFromReview(page)

  await page.goto('/')
  const card = page.getByRole('heading', { name: 'E2E Свободный маршрут' }).locator('xpath=ancestor::*[@data-slot="card"]')
  await card.getByRole('button', { name: 'Начать новую игру' }).click()
  await page.getByRole('textbox', { name: 'Имя' }).fill('E2E Герой')
  await page.getByRole('button', { name: 'Проверить героя' }).click()
  const sessionResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' && response.url().endsWith(`/api/stories/${draft.story_id}/sessions`)
  ))
  await page.getByRole('button', { name: 'Начать историю' }).click()
  const started = await (await sessionResponse).json() as { id: string; story: { current_published_version_id: string } }
  expect(started.story.current_published_version_id).toBe(draft.version_id)

  await page.getByRole('textbox', { name: 'Ваше действие' }).fill('Осмотреть архив сигнала')
  const turnResponse = page.waitForResponse((response) => response.url().endsWith(`/api/sessions/${started.id}/turns`))
  await page.getByRole('button', { name: 'Отправить' }).click()
  const turn = await (await turnResponse).json() as { state_version: number }
  expect(turn.state_version).toBe(2)
  const session = await json<{ story: { title: string; current_published_version_id: string } }>(
    await request.get(`/api/sessions/${started.id}`),
  )
  expect(session.story).toMatchObject({
    title: 'E2E Свободный маршрут',
    current_published_version_id: draft.version_id,
  })
})

test('гибридный тест, repair и старая сессия остаются на опубликованной v1 после публикации v2', async ({ page, request }) => {
  let draft = await createDraft(request, 'hybrid', 'Гибридная v1')
  draft = await saveSection(request, draft, 'rules', { ...draft.rules, ending_policy: 'required_beats_then_end' })
  draft = await saveSection(request, draft, 'canon', {
    creative_goals: 'Не завершать историю до открытия архива.',
    facts: [{
      id: 'signal-exists', order_index: 0, title: 'Сигнал существует',
      statement: 'Сигнал реален и исходит из архива.', severity: 'hard', scope: 'world',
      referenced_character_ids: [],
    }],
    beats: [{
      id: 'open-archive', order_index: 0, title: 'Открыть архив', description: 'Герой открывает архив сигнала.',
      activation_condition: { kind: 'always' }, completion_evidence: 'Дверь архива открыта.',
      required: true, ending_gate: true,
    }],
  })

  await openReview(page, draft.story_id)
  await page.getByRole('button', { name: 'Запустить тест' }).click()
  await expect(page).toHaveURL(/\/studio\/[^/]+$/)
  await expect(page.getByRole('heading', { name: 'E2E Гибридная v1' })).toBeVisible()

  await openReview(page, draft.story_id)
  await publishFromReview(page)
  const version1 = draft.version_id
  const playerV1 = await json<{ id: string; state_version: number; story: { current_published_version_id: string } }>(
    await request.post(`/api/stories/${draft.story_id}/sessions`, {
      data: {
        provider_id: 'ollama',
        hero: { source_kind: 'draft', name: 'Герой v1', address: null, gender: 'unspecified', appearance: '', biography: '' },
      },
    }),
  )
  expect(playerV1.story.current_published_version_id).toBe(version1)

  const repaired = await json<{ id: string; state_version: number }>(await request.post(`/api/sessions/${playerV1.id}/turns`, {
    data: { request_id: 'early-ending-repair', expected_state_version: 1, action: 'Попытка раннего финала' },
  }))
  expect(repaired.state_version).toBe(2)
  const replay = await json<{ id: string; state_version: number }>(await request.post(`/api/sessions/${playerV1.id}/turns`, {
    data: { request_id: 'early-ending-repair', expected_state_version: 1, action: 'Попытка раннего финала' },
  }))
  expect(replay).toMatchObject({ id: repaired.id, state_version: 2 })

  draft = await json<Draft>(await request.post(`/api/author/stories/${draft.story_id}/draft-from/${version1}`))
  draft = await saveSection(request, draft, 'identity', {
    ...draft.identity,
    title: 'E2E Гибридная v2',
    short_description: 'Новая редакция не меняет старые прохождения.',
  })
  const publishedV2 = await json<Draft>(await request.post(`/api/author/stories/${draft.story_id}/publish`))
  expect(publishedV2.version_id).not.toBe(version1)

  const oldSession = await json<{ state_version: number; story: { title: string; current_published_version_id: string } }>(
    await request.get(`/api/sessions/${playerV1.id}`),
  )
  expect(oldSession).toMatchObject({
    state_version: 2,
    story: { title: 'E2E Гибридная v1', current_published_version_id: version1 },
  })
})
