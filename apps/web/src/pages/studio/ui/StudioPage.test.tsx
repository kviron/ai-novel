import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { StorySession, TurnResult } from '@/shared/api'
import { apiServer } from '@/test/api-server'
import { TestRouter } from '@/test/TestRouter'

const story: StorySession['story'] = {
  id: 'story-1', slug: 'akane-neon-echo', title: 'Эхо неона', premise: 'Дождливый город', description: 'Дождливый город', cover_image_url: null, story_mode: 'hybrid',
  recommended_provider_id: 'ollama', recommended_model_id: 'gemma4-local:32k',
}
const session: StorySession = {
  id: 'session-1', story, state_version: 1, can_rewind: false, current_scene: 'Крыша', provider_id: 'ollama', model_id: 'gemma4-local:32k',
  characters: [{ id: 'akane', name: 'Аканэ', gender: 'female', age: 25, personality: 'Наблюдательная', appearance: 'Красное платье', visual_profile_version: 1 }],
  latest_turn: null, visual_state: { emotion: 'neutral', pose: 'standing', outfit: 'red_dress', background: 'neon_crossroads' },
}
const turn: TurnResult = {
  id: 'turn-1', session_id: 'session-1', request_id: 'request-1', state_version: 2, action: 'Спросить о веере', speaker: 'Аканэ',
  narration: 'Дождь стихает.', dialogue: 'Я знаю путь.', choices: ['Идти дальше'],
  visual_directive: { mode: 'sprite_scene', character_id: 'akane', emotion: 'fan', pose: 'fan_open', outfit: 'red_dress', background: 'neon_crossroads' },
  provider_id: 'ollama', model_id: 'gemma4-local:32k', prompt_version: 'v1', created_at: '2026-09-24T00:00:00Z',
}

beforeEach(() => {
  apiServer.listStories([story])
  apiServer.startSession(session)
  apiServer.session(session)
  apiServer.providersAvailable(true, ['gemma4-local:32k'])
  apiServer.turn(session.id, turn)
})
afterEach(() => { cleanup(); apiServer.reset(); vi.restoreAllMocks() })

test('создаёт отдельную тестовую сессию с настроенной моделью сервера', async () => {
  render(<TestRouter initialEntries={['/studio']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Новая тестовая сессия' }))
  expect(await screen.findByText('Крыша')).toBeInTheDocument()
  expect(apiServer.lastStartSessionRequest()).toEqual({ provider_id: 'ollama', kind: 'author' })
  expect(screen.getByRole('link', { name: 'Открыть как игрок' })).toHaveAttribute('href', '/play/session-1')
})

test('показывает подтверждённое состояние и обновляет инспектор после хода', async () => {
  render(<TestRouter initialEntries={['/studio/session-1']} />)
  expect(await screen.findByText('Крыша')).toBeInTheDocument()
  expect(screen.getByText('v1')).toBeInTheDocument()
  expect(screen.getByText(/gemma4-local:32k/)).toBeInTheDocument()
  expect(screen.getByText('Ходов пока нет')).toBeInTheDocument()
  expect(screen.getByText('neon_crossroads')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Варианты (3)' }))
  await userEvent.click(screen.getByRole('button', { name: 'Спросить о веере' }))
  await waitFor(() => expect(screen.getByText('v2')).toBeInTheDocument())
  expect(screen.getByText('v1', { selector: '[data-field="prompt-version"]' })).toBeInTheDocument()
  expect(screen.getByText('Спросить о веере', { selector: '[data-field="last-action"]' })).toBeInTheDocument()
})

test('открывает существующую сессию по ID', async () => {
  render(<TestRouter initialEntries={['/studio']} />)
  await userEvent.type(await screen.findByRole('textbox', { name: 'ID сессии' }), 'session-1')
  await userEvent.click(screen.getByRole('button', { name: 'Открыть сессию' }))
  expect(await screen.findByText('Крыша')).toBeInTheDocument()
})
