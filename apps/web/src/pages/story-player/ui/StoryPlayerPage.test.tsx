import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { StorySession, TurnResult } from '@/shared/api'
import { apiServer } from '@/test/api-server'
import { StoryPlayerPage } from './StoryPlayerPage'

const session: StorySession = {
  id: 'session-1', state_version: 1, current_scene: 'Крыша', provider_id: 'ollama', model_id: 'gemma4-local:32k',
  story: { id: 'story-1', slug: 'akane-neon-echo', title: 'Эхо неона', premise: 'Дождливый город', story_mode: 'hybrid', recommended_provider_id: 'ollama', recommended_model_id: 'gemma4-local:32k' },
  characters: [{ id: 'akane', name: 'Аканэ', age: 25, personality: 'Наблюдательная', appearance: 'Красное платье', visual_profile_version: 1 }],
  latest_turn: null, visual_state: { emotion: 'neutral', pose: 'standing', outfit: 'red_dress' },
}
const turn: TurnResult = {
  id: 'turn-1', session_id: 'session-1', request_id: 'request-1', state_version: 2, action: 'Спросить о веере', speaker: 'Аканэ',
  narration: 'Дождь стихает.', dialogue: 'Веер хранит больше тайн, чем кажется.', choices: ['Уточнить'],
  visual_directive: { character_id: 'akane', mode: 'sprite_scene', emotion: 'fan', pose: 'fan_open', outfit: 'red_dress' },
  provider_id: 'ollama', model_id: 'gemma4-local:32k', prompt_version: 'v1', created_at: '2026-09-19T00:00:00Z',
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }) }
const error = (code: string, status: number) => json({ code, detail: 'Не удалось продолжить. Повторите попытку.', retryable: true }, status)
beforeEach(() => { apiServer.session(session); apiServer.providersAvailable(); apiServer.turn(session.id, turn) })
afterEach(() => { cleanup(); apiServer.reset(); vi.restoreAllMocks() })

test('восстанавливает подтверждённый ход, версию, модель и пропорции спрайта', async () => {
  apiServer.session({ ...session, state_version: 2, latest_turn: turn })
  render(<StoryPlayerPage sessionId="session-1" />)
  const sprite = await screen.findByRole('img', { name: 'Аканэ: С веером' })
  expect(sprite).toHaveStyle({ aspectRatio: '1 / 3', backgroundSize: '600% 100%' })
  expect(screen.getByText('Состояние · v2')).toBeInTheDocument()
  expect(screen.getByText(/gemma4-local:32k/)).toBeInTheDocument()
  expect(screen.getByText('Дождь стихает.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Уточнить' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: 'Показать полностью' }))
  expect(screen.getByText(turn.dialogue)).toBeInTheDocument()
})

test('блокирует действия offline и после проверки возвращает управление', async () => {
  apiServer.providersAvailable(false)
  render(<StoryPlayerPage sessionId="session-1" />)
  expect(await screen.findByText('Нейросеть недоступна')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Ваше действие' })).toBeDisabled()
  apiServer.providersAvailable()
  await userEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }))
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled())
})

test('пустая отправка объясняет блокировку, свободное действие открывает кнопку', async () => {
  render(<StoryPlayerPage sessionId="session-1" />)
  const send = await screen.findByRole('button', { name: 'Отправить' })
  expect(send).toBeDisabled()
  expect(send).toHaveAccessibleDescription(/Введите действие/)
  await userEvent.type(screen.getByRole('textbox'), 'Посмотреть вокруг')
  expect(send).toBeEnabled()
})

test('медленная проверка блокирует повторные проверки и отправку', async () => {
  apiServer.providersAvailable(false)
  render(<StoryPlayerPage sessionId="session-1" />)
  await screen.findByText('Нейросеть недоступна')
  const pending = deferred<Response>()
  vi.mocked(fetch).mockImplementationOnce(() => pending.promise)
  const retry = screen.getByRole('button', { name: 'Повторить проверку' })
  fireEvent.click(retry); fireEvent.click(retry)
  expect(screen.getByRole('button', { name: 'Проверяем…' })).toBeDisabled()
  expect(screen.getByRole('textbox')).toBeDisabled()
  await act(async () => pending.resolve(json([{ provider_id: 'ollama', available: true, detail: 'Готово', models: [] }])))
  expect(screen.getByRole('textbox')).toBeEnabled()
})

test('двойной submit отправляет один запрос и меняет эмоцию только после ответа', async () => {
  render(<StoryPlayerPage sessionId="session-1" />)
  const input = await screen.findByRole('textbox')
  await userEvent.type(input, 'Она улыбается с веером')
  const pending = deferred<Response>()
  vi.mocked(fetch).mockImplementationOnce(() => pending.promise)
  const before = vi.mocked(fetch).mock.calls.length
  const form = input.closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  expect(vi.mocked(fetch).mock.calls.length - before).toBe(1)
  const [url, options] = vi.mocked(fetch).mock.calls.at(-1)!
  expect(url).toBe('/api/sessions/session-1/turns')
  expect(JSON.parse(options!.body as string)).toEqual({ action: 'Она улыбается с веером', expected_state_version: 1, request_id: expect.any(String) })
  expect(screen.getByRole('img')).toHaveAttribute('data-expression', 'neutral')
  expect(input).toBeDisabled()
  await act(async () => pending.resolve(json(turn, 201)))
  expect(screen.getByRole('img')).toHaveAttribute('data-expression', 'fan')
  expect(screen.getByRole('button', { name: 'Уточнить' })).toBeEnabled()
  expect(input).toHaveValue('')
})

test('ошибка сервера сохраняет текст, ход и request ID при повторе того же намерения', async () => {
  apiServer.session({ ...session, latest_turn: turn, state_version: 2 })
  render(<StoryPlayerPage sessionId="session-1" />)
  await userEvent.type(await screen.findByRole('textbox'), 'Моё действие')
  vi.mocked(fetch).mockResolvedValueOnce(error('network_error', 500))
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось продолжить')
  expect(screen.getByRole('img')).toHaveAttribute('data-expression', 'fan')
  expect(screen.getByRole('textbox')).toHaveValue('Моё действие')
  const first = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string)
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  const second = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string)
  expect(second.request_id).toBe(first.request_id)
})

test('provider_unavailable сохраняет действие до успешной health-проверки', async () => {
  render(<StoryPlayerPage sessionId="session-1" />)
  await userEvent.type(await screen.findByRole('textbox'), 'Остаться')
  vi.mocked(fetch).mockResolvedValueOnce(error('provider_unavailable', 503))
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  await screen.findByText('Нейросеть недоступна')
  expect(screen.getByRole('textbox')).toHaveValue('Остаться')
  expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled())
})

test('409 перезагружает сессию до новой попытки с новой версией и ID', async () => {
  render(<StoryPlayerPage sessionId="session-1" />)
  await userEvent.type(await screen.findByRole('textbox'), 'Продолжить')
  const reload = deferred<Response>()
  vi.mocked(fetch).mockResolvedValueOnce(error('state_conflict', 409)).mockImplementationOnce(() => reload.promise)
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  const first = JSON.parse(vi.mocked(fetch).mock.calls.at(-2)![1]!.body as string)
  expect(screen.getByRole('textbox')).toBeDisabled()
  await act(async () => reload.resolve(json({ ...session, state_version: 8, latest_turn: { ...turn, state_version: 8 } })))
  expect(screen.getByRole('status')).toHaveTextContent('Состояние обновлено')
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  const second = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string)
  expect(second.expected_state_version).toBe(8)
  expect(second.request_id).not.toBe(first.request_id)
})

test('старый ответ не заменяет другую сессию при навигации', async () => {
  const view = render(<StoryPlayerPage sessionId="session-1" />)
  await userEvent.type(await screen.findByRole('textbox'), 'Ждать')
  const pending = deferred<Response>()
  vi.mocked(fetch).mockImplementationOnce(() => pending.promise)
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  const signal = vi.mocked(fetch).mock.calls.at(-1)![1]!.signal!
  apiServer.session({ ...session, id: 'session-2', story: { ...session.story, title: 'Другая история' } })
  view.rerender(<StoryPlayerPage sessionId="session-2" />)
  expect(await screen.findByRole('heading', { name: 'Другая история' })).toBeInTheDocument()
  expect(signal.aborted).toBe(true)
  await act(async () => pending.resolve(json(turn)))
  expect(screen.getByRole('img')).toHaveAttribute('data-expression', 'neutral')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('отмена запроса не показывается как ошибка сюжета', async () => {
  render(<StoryPlayerPage sessionId="session-1" />)
  await userEvent.type(await screen.findByRole('textbox'), 'Ждать')
  vi.mocked(fetch).mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'))
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('выбор доступен с клавиатуры и новое действие получает новый request ID', async () => {
  render(<StoryPlayerPage sessionId="session-1" />)
  const choice = await screen.findByRole('button', { name: 'Спросить о веере' })
  choice.focus()
  await userEvent.keyboard('{Enter}')
  expect(await screen.findByRole('button', { name: 'Уточнить' })).toBeEnabled()
  const first = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string)
  expect(first.action).toBe('Спросить о веере')
  await userEvent.click(screen.getByRole('button', { name: 'Уточнить' }))
  const second = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string)
  expect(second.request_id).not.toBe(first.request_id)
  expect(second.expected_state_version).toBe(2)
})

test('неудачный reload после 409 блокирует новые ходы до успешного восстановления', async () => {
  render(<StoryPlayerPage sessionId="session-1" />)
  await userEvent.type(await screen.findByRole('textbox'), 'Продолжить')
  vi.mocked(fetch).mockResolvedValueOnce(error('state_conflict', 409)).mockResolvedValueOnce(error('network_error', 503))
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
  apiServer.session({ ...session, state_version: 7 })
  await userEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  expect(JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string).expected_state_version).toBe(7)
})

test('медленный initial health не открывает управление и не меняет новую сессию', async () => {
  const health = deferred<Response>()
  vi.mocked(fetch).mockResolvedValueOnce(json(session)).mockImplementationOnce(() => health.promise)
  const view = render(<StoryPlayerPage sessionId="session-1" />)
  expect(await screen.findByRole('textbox')).toBeDisabled()
  apiServer.session({ ...session, id: 'session-2' })
  apiServer.providersAvailable(false)
  view.rerender(<StoryPlayerPage sessionId="session-2" />)
  await screen.findByText('Нейросеть недоступна')
  await act(async () => health.resolve(json([{ provider_id: 'ollama', available: true, detail: 'Готово', models: [] }])))
  expect(screen.getByRole('textbox')).toBeDisabled()
  expect(screen.getByText('Нейросеть недоступна')).toBeInTheDocument()
})

test('unmount отменяет pending turn без сообщения об ошибке', async () => {
  const view = render(<StoryPlayerPage sessionId="session-1" />)
  await userEvent.type(await screen.findByRole('textbox'), 'Ждать')
  const pending = deferred<Response>()
  vi.mocked(fetch).mockImplementationOnce(() => pending.promise)
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  const signal = vi.mocked(fetch).mock.calls.at(-1)![1]!.signal!
  view.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => pending.resolve(json(turn)))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
