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
