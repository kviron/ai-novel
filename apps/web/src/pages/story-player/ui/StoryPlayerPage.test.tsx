import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { StorySession, TurnResult } from '@/shared/api'
import { apiServer } from '@/test/api-server'
import { StoryPlayerPage } from './StoryPlayerPage'

const session: StorySession = {
  id: 'session-1', state_version: 1, can_rewind: false, current_scene: 'Крыша', provider_id: 'ollama', model_id: 'gemma4-local:32k',
  story: { id: 'story-1', slug: 'akane-neon-echo', title: 'Эхо неона', premise: 'Дождливый город', description: 'Дождливый город', cover_image_url: null, story_mode: 'hybrid', recommended_provider_id: 'ollama', recommended_model_id: 'gemma4-local:32k' },
  characters: [{ id: 'akane', name: 'Аканэ', gender: 'female', age: 25, personality: 'Наблюдательная', appearance: 'Красное платье', visual_profile_version: 1 }],
  latest_turn: null, visual_state: { emotion: 'neutral', pose: 'standing', outfit: 'red_dress', background: 'neon_crossroads' },
}
const turn: TurnResult = {
  id: 'turn-1', session_id: 'session-1', request_id: 'request-1', state_version: 2, action: 'Спросить о веере', speaker: 'Аканэ',
  narration: 'Дождь стихает.', dialogue: 'Веер хранит больше тайн, чем кажется.', choices: ['Уточнить'],
  visual_directive: { character_id: 'akane', mode: 'sprite_scene', emotion: 'fan', pose: 'fan_open', outfit: 'red_dress', background: 'neon_crossroads' },
  provider_id: 'ollama', model_id: 'gemma4-local:32k', prompt_version: 'v1', created_at: '2026-09-19T00:00:00Z',
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }) }
const error = (code: string, status: number) => json({ code, detail: 'Не удалось продолжить. Повторите попытку.', retryable: true }, status)
beforeEach(() => { apiServer.session(session); apiServer.providersAvailable(true, ['gemma4-local:32k']); apiServer.turn(session.id, turn) })
afterEach(() => { cleanup(); apiServer.reset(); vi.restoreAllMocks() })

test('даёт перейти в Студию без технических деталей в шапке игрока', async () => {
  render(<StoryPlayerPage sessionId="session-1" />)
  expect(await screen.findByRole('link', { name: 'Студия' })).toHaveAttribute('href', '/studio/session-1')
  expect(screen.getByRole('banner')).not.toHaveTextContent('gemma4-local:32k')
  expect(screen.getByTestId('story-player-route')).toHaveAttribute('data-story-theme', 'akane-neon-echo')
})

test('открывает переписку из кнопки после названия с разными цветами игрока и персонажа', async () => {
  apiServer.dialogueHistory(session.id, [turn, { ...turn, id: 'turn-2', action: 'Идти дальше', speaker: 'Марк', narration: 'В архиве темно.', dialogue: 'Я нашёл запись.' }])
  render(<StoryPlayerPage sessionId="session-1" />)
  const title = await screen.findByRole('heading', { name: 'Эхо неона' })
  const historyButton = screen.getByRole('button', { name: 'История диалогов' })
  expect(title.parentElement).toContainElement(historyButton)

  await userEvent.click(historyButton)
  const dialog = await screen.findByRole('dialog', { name: 'История диалогов' })
  expect(dialog).toHaveTextContent('Спросить о веере')
  expect(dialog).toHaveTextContent('Веер хранит больше тайн, чем кажется.')
  expect(dialog).toHaveTextContent('Аканэ')
  expect(dialog).toHaveTextContent('Марк')
  expect(dialog.textContent?.indexOf('Спросить о веере')).toBeLessThan(dialog.textContent?.indexOf('Идти дальше') ?? 0)
  expect(dialog.querySelector('[data-speaker="player"]')).toHaveClass('bg-primary')
  expect(dialog.querySelector('[data-speaker="character"]')).toHaveClass('bg-muted')
})

test('показывает пустое состояние переписки до первого хода', async () => {
  render(<StoryPlayerPage sessionId="session-1" />)
  await userEvent.click(await screen.findByRole('button', { name: 'История диалогов' }))
  expect(await screen.findByText('Диалогов пока нет.')).toBeInTheDocument()
})

test('не приписывает новой истории Аканэ и готовые варианты Эха неона', async () => {
  apiServer.session({ ...session, story: { ...session.story, slug: 'another-story', title: 'Другая история', premise: 'Новая завязка' }, characters: [] })
  render(<StoryPlayerPage sessionId="session-1" />)
  expect(await screen.findByText('Новая завязка')).toBeInTheDocument()
  expect(screen.queryByRole('img', { name: /Аканэ/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Спросить о веере' })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Ваше действие' })).toBeEnabled()
})

test('восстанавливает подтверждённый ход и пропорции спрайта без технических данных', async () => {
  apiServer.session({ ...session, state_version: 2, latest_turn: turn })
  render(<StoryPlayerPage sessionId="session-1" />)
  const sprite = await screen.findByRole('img', { name: 'Аканэ: С веером' })
  expect(sprite).toHaveStyle({ aspectRatio: '1 / 3', backgroundSize: '600% 100%' })
  expect(screen.getByRole('banner')).not.toHaveTextContent('gemma4-local:32k')
  expect(screen.getByText('Дождь стихает.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Уточнить' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Варианты (1)' }))
  expect(screen.getByRole('dialog', { name: 'Варианты ответа' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Уточнить' })).toBeEnabled()
  await userEvent.keyboard('{Escape}')
  await userEvent.click(screen.getByRole('button', { name: 'Показать полностью' }))
  expect(screen.getByText(turn.dialogue)).toBeInTheDocument()
})

test('показывает чередование двух персонажей в сцене и истории', async () => {
  const multi = { ...turn, segments: [
    { kind: 'narration' as const, text: 'Аканэ закрыла веер.' },
    { kind: 'dialogue' as const, character_id: 'akane', text: 'Я слышала сигнал.' },
    { kind: 'narration' as const, text: 'Марк подошёл к окну.' },
    { kind: 'dialogue' as const, character_id: 'mark', text: 'Я тоже.' },
  ] }
  apiServer.session({ ...session, state_version: 2, characters: [
    { ...session.characters[0], name: 'Аканэ Куроха', color: '#AA3344' },
    { ...session.characters[0], id: 'mark', name: 'Марк Ветров', color: '#3366AA' },
  ], latest_turn: multi })
  apiServer.dialogueHistory(session.id, [multi])
  render(<StoryPlayerPage sessionId="session-1" />)
  const scene = await screen.findByRole('region', { name: 'Игровая сцена' })
  expect(scene.textContent?.indexOf('Аканэ закрыла веер.')).toBeLessThan(scene.textContent?.indexOf('Я слышала сигнал.') ?? 0)
  expect(scene.textContent?.indexOf('Я слышала сигнал.')).toBeLessThan(scene.textContent?.indexOf('Марк подошёл к окну.') ?? 0)
  expect(scene).toHaveTextContent('Марк:')
  await userEvent.click(screen.getByRole('button', { name: 'История диалогов' }))
  const history = await screen.findByRole('dialog', { name: 'История диалогов' })
  expect(history).toHaveTextContent('Я тоже.')
  expect(within(history).queryByText('Аканэ', { exact: true })).toBeNull()
})

test('блокирует действия offline и после проверки возвращает управление', async () => {
  apiServer.providersAvailable(false)
  render(<StoryPlayerPage sessionId="session-1" />)
  expect(await screen.findByText('Нейросеть недоступна')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Ваше действие' })).toBeDisabled()
  apiServer.providersAvailable(true, ['gemma4-local:32k'])
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

test('варианты открываются иконкой внутри поля, а отправка остаётся кнопкой без текста', async () => {
  render(<StoryPlayerPage sessionId="session-1" />)
  const input = await screen.findByRole('textbox', { name: 'Ваше действие' })
  const choices = screen.getByRole('button', { name: 'Варианты (3)' })
  const send = screen.getByRole('button', { name: 'Отправить' })
  expect(choices.closest('[data-slot="input-group"]')).toContainElement(input)
  expect(choices).toHaveTextContent('')
  expect(send).toHaveTextContent('')
  await userEvent.click(choices)
  expect(screen.getByRole('dialog', { name: 'Варианты ответа' })).toBeInTheDocument()
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
  await act(async () => pending.resolve(json([{ provider_id: 'ollama', available: true, detail: 'Готово', models: ['gemma4-local:32k'] }])))
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
  expect(screen.getByRole('button', { name: 'Генерация…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Генерация…' })).toHaveTextContent('')
  expect(screen.queryByText('Генерация', { selector: '[data-slot="badge"]' })).not.toBeInTheDocument()
  await act(async () => pending.resolve(json(turn, 201)))
  expect(screen.getByRole('img')).toHaveAttribute('data-expression', 'fan')
  await userEvent.click(screen.getByRole('button', { name: 'Варианты (1)' }))
  expect(screen.getByRole('button', { name: 'Уточнить' })).toBeEnabled()
  expect(input).toHaveValue('')
})

test('отмена хода восстанавливает предыдущий снимок без обращения к модели', async () => {
  apiServer.rewind(session.id, { ...session, state_version: 3, can_rewind: false })
  render(<StoryPlayerPage sessionId="session-1" />)
  const undo = await screen.findByRole('button', { name: 'Отменить ход' })
  expect(undo).toBeDisabled()
  await userEvent.type(screen.getByRole('textbox'), 'Спросить о веере')
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  expect(undo).toBeEnabled()
  const callsBefore = vi.mocked(fetch).mock.calls.length
  await userEvent.click(undo)
  await waitFor(() => expect(undo).toBeDisabled())
  expect(screen.getByRole('img')).toHaveAttribute('data-expression', 'neutral')
  expect(screen.getByRole('textbox')).toHaveValue('')
  expect(vi.mocked(fetch).mock.calls.slice(callsBefore).map(([url]) => url)).toEqual(['/api/sessions/session-1/rewind'])
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

test('позволяет сменить отсутствующую модель в той же сессии через настройки слева от поля', async () => {
  apiServer.session({ ...session, model_id: 'missing:model' })
  apiServer.providersAvailable(true, ['gemma4-local:32k'])
  apiServer.modelSwitch('session-1', { ...session, model_id: 'gemma4-local:32k', state_version: 2 })
  render(<StoryPlayerPage sessionId="session-1" />)

  expect(await screen.findByText('Нейросеть недоступна')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Настройки прохождения' }))
  expect(screen.getByRole('dialog', { name: 'Настройки прохождения' })).toBeInTheDocument()
  expect(screen.getByText('Автосохранение')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('combobox', { name: 'Модель Ollama' }))
  await userEvent.click(screen.getByRole('option', { name: 'gemma4-local:32k' }))
  await userEvent.click(screen.getByRole('button', { name: 'Применить модель' }))

  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Сейчас: gemma4-local:32k'))
  await userEvent.keyboard('{Escape}')
  expect(screen.getByRole('textbox')).toBeEnabled()
  expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe('/api/sessions/session-1/model')
})

test.each([{ models: [] }, { models: ['other-model:latest'] }])('отсутствующая модель сессии блокирует управление: $models', async ({ models }) => {
  apiServer.providerSequence([{ provider_id: 'ollama', available: true, detail: 'Подключено', models }])
  render(<StoryPlayerPage sessionId="session-1" />)
  expect(await screen.findByText('Нейросеть недоступна')).toBeInTheDocument()
  expect(screen.getByRole('textbox')).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Варианты (3)' }))
  expect(screen.getByRole('button', { name: 'Спросить о веере' })).toBeDisabled()
  await userEvent.keyboard('{Escape}')
  expect(screen.getByRole('button', { name: 'Повторить проверку' })).toBeEnabled()
})

test('model_unavailable блокирует действие до появления нужной модели и сохраняет request ID', async () => {
  apiServer.providerSequence([{ provider_id: 'ollama', available: true, detail: 'Готово', models: ['gemma4-local:32k'] }])
  render(<StoryPlayerPage sessionId="session-1" />)
  await userEvent.type(await screen.findByRole('textbox'), 'Продолжить разговор')
  vi.mocked(fetch).mockResolvedValueOnce(error('model_unavailable', 503))
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  await screen.findByText('Нейросеть недоступна')
  const first = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string)
  expect(screen.getByRole('textbox')).toHaveValue('Продолжить разговор')
  expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
  apiServer.providerSequence([{ provider_id: 'ollama', available: true, detail: 'Подключено', models: ['other-model:latest'] }])
  await userEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }))
  await screen.findByText('Нейросеть недоступна')
  expect(screen.getByRole('textbox')).toBeDisabled()
  apiServer.providerSequence([{ provider_id: 'ollama', available: true, detail: 'Готово', models: ['gemma4-local:32k'] }])
  await userEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  const second = JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string)
  expect(second).toEqual(first)
  expect(screen.getByRole('img')).toHaveAttribute('data-expression', 'fan')
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
  await userEvent.click(await screen.findByRole('button', { name: 'Варианты (3)' }))
  const choice = await screen.findByRole('button', { name: 'Спросить о веере' })
  choice.focus()
  await userEvent.keyboard('{Enter}')
  await userEvent.click(await screen.findByRole('button', { name: 'Варианты (1)' }))
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
  await act(async () => health.resolve(json([{ provider_id: 'ollama', available: true, detail: 'Готово', models: ['gemma4-local:32k'] }])))
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
