import { afterEach, expect, test, vi } from 'vitest'

import { createApiClient } from './client'

afterEach(() => vi.unstubAllGlobals())

test('uses the configured base URL and forwards an abort signal', async () => {
  const signal = new AbortController().signal
  const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)

  await createApiClient({ baseUrl: 'https://api.example.test/' }).listStories(signal)

  expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/stories', expect.objectContaining({ signal }))
})

test('loads story detail using an encoded story id', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ characters: [] }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)

  await createApiClient().getStory('a/b')

  expect(fetchMock).toHaveBeenCalledWith('/api/stories/a%2Fb', expect.any(Object))
})

test('lists player saves from the configured API and forwards cancellation', async () => {
  const signal = new AbortController().signal
  const fetchMock = vi.fn(async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)

  await createApiClient({ baseUrl: 'https://api.example.test/' }).listSessions('player', signal)

  expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/sessions?kind=player', expect.objectContaining({ signal }))
})

test('converts typed API errors into structured request errors', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    code: 'provider_unavailable',
    detail: 'Ollama недоступна. Проверьте, что она запущена, и повторите.',
    retryable: true,
  }), { status: 503, headers: { 'Content-Type': 'application/json' } })))

  const request = createApiClient().providers()

  await expect(request).rejects.toMatchObject({
    name: 'ApiRequestError',
    code: 'provider_unavailable',
    message: 'Ollama недоступна. Проверьте, что она запущена, и повторите.',
    status: 503,
    retryable: true,
  })
})

test('does not expose non-JSON error bodies to consumers', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream stack trace', { status: 502, headers: { 'Content-Type': 'text/html' } })))

  const request = createApiClient().listStories()

  await expect(request).rejects.toMatchObject({
    code: 'http_error',
    message: 'Сервис временно недоступен. Повторите попытку позже.',
    status: 502,
    retryable: true,
  })
})

test('converts network failures into retryable request errors', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

  const request = createApiClient().getSession('session-1')

  await expect(request).rejects.toMatchObject({
    code: 'network_error',
    message: 'Не удалось подключиться к серверу. Повторите попытку.',
    status: 0,
    retryable: true,
  })
})

test('preserves an AbortError so callers can suppress cancellation', async () => {
  const aborted = new DOMException('The operation was aborted.', 'AbortError')
  vi.stubGlobal('fetch', vi.fn(async () => { throw aborted }))

  await expect(createApiClient().listStories()).rejects.toBe(aborted)
})

test('writes character profiles and pins a selected revision using dedicated endpoints', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  const client = createApiClient()
  const profile = { name: 'Марк', gender: 'male' as const, age: 29, personality: 'Спокойный', appearance: 'Тёмные волосы', biography: '', speech: '' }

  await client.createCharacter(profile)
  await client.reviseCharacter('mark', profile)
  await client.attachCharacter('story-1', 'mark', 'mark-v2', 'Союзник')
  await client.pinCharacterRevision('story-1', 'mark', 'mark-v1', 'Соперник')

  expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/characters', expect.objectContaining({ method: 'POST', body: JSON.stringify(profile) }))
  expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/characters/mark/revisions', expect.objectContaining({ method: 'POST', body: JSON.stringify(profile) }))
  expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/stories/story-1/characters', expect.objectContaining({ method: 'POST', body: JSON.stringify({ character_id: 'mark', revision_id: 'mark-v2', role: 'Союзник' }) }))
  expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/stories/story-1/characters/mark', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ revision_id: 'mark-v1', role: 'Соперник' }) }))
})

test('sends the unsaved character draft to field generation', async () => {
  const fetchMock = vi.fn(async () => new Response('{"text":"Описание"}', { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  const draft = { name: 'Леон', gender: 'male' as const, age: 29, personality: 'Осторожный', appearance: 'Плащ', biography: '', speech: '' }

  await expect(createApiClient().generateCharacterField('personality', draft)).resolves.toEqual({ text: 'Описание' })
  expect(fetchMock).toHaveBeenCalledWith('/api/characters/generate-field', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ field: 'personality', draft }),
  }))
})

test('uses dedicated authoring endpoints and sends optimistic revision separately from section data', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  const client = createApiClient()
  const identity = {
    title: 'Эхо неона', slug: 'echo-neona', short_description: '', premise: 'Город помнит всё.',
    cover_material_id: null, genres: ['мистика'], tone: ['мрачный'], setting: 'Ночной город',
    opening_situation: 'Начинается дождь.', content_rating: 'adult_18_plus' as const,
  }

  await client.createStoryDraft(identity)
  await client.getStoryDraft('story/1')
  await client.saveStoryDraftSection('story/1', 'identity', identity, 7)
  await client.validateStoryDraft('story/1')
  await client.startDraftTest('story/1', { provider_id: 'ollama', model_id: 'qwen3' })
  await client.publishStoryDraft('story/1')
  await client.createDraftFromVersion('story/1', 'version/2')

  expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/author/stories', expect.objectContaining({ method: 'POST', body: JSON.stringify(identity) }))
  expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/author/stories/story%2F1/draft', expect.any(Object))
  expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/author/stories/story%2F1/draft/identity', expect.objectContaining({
    method: 'PUT', body: JSON.stringify({ expected_revision: 7, data: identity }),
  }))
  expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/author/stories/story%2F1/validate', expect.objectContaining({ method: 'POST' }))
  expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/author/stories/story%2F1/test-sessions', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ provider_id: 'ollama', model_id: 'qwen3' }),
  }))
  expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/author/stories/story%2F1/publish', expect.objectContaining({ method: 'POST' }))
  expect(fetchMock).toHaveBeenNthCalledWith(7, '/api/author/stories/story%2F1/draft-from/version%2F2', expect.objectContaining({ method: 'POST' }))
})

test('preserves draft diagnostics and latest revision on structured authoring errors', async () => {
  const diagnostics = [{
    code: 'required', severity: 'error', step: 'identity', field: 'identity.title', item_id: null,
    message: 'Укажите название новеллы.',
  }]
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    code: 'draft_invalid', detail: 'Исправьте ошибки.', retryable: false, diagnostics,
  }), { status: 422, headers: { 'Content-Type': 'application/json' } })))

  await expect(createApiClient().publishStoryDraft('story-1')).rejects.toMatchObject({
    code: 'draft_invalid', diagnostics,
  })

  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
    code: 'draft_conflict', detail: 'Черновик изменён.', retryable: false, latest_revision: 9,
  }), { status: 409, headers: { 'Content-Type': 'application/json' } }))

  await expect(createApiClient().validateStoryDraft('story-1')).rejects.toMatchObject({
    code: 'draft_conflict', latestRevision: 9,
  })
})

test('uploads story cover as raw file with encoded provenance', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  const file = new File(['image'], 'cover art.png', { type: 'image/png' })

  await createApiClient().uploadStoryCover('story/1', file, {
    creator: 'Рома & Co', license: 'CC BY', source: 'https://example.test/a?b=1',
  })

  expect(fetchMock).toHaveBeenCalledWith(
    '/api/author/stories/story%2F1/draft/cover?filename=cover+art.png&creator=%D0%A0%D0%BE%D0%BC%D0%B0+%26+Co&license=CC+BY&source=https%3A%2F%2Fexample.test%2Fa%3Fb%3D1',
    expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'image/png' }, body: file }),
  )
})
