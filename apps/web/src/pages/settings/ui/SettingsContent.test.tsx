import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import { apiServer } from '@/test/api-server'
import { TestRouter } from '@/test/TestRouter'

const story = { id: 'story-1', slug: 'akane-neon-echo', title: 'Эхо неона', premise: 'Дождливый город', story_mode: 'hybrid' as const, recommended_provider_id: 'ollama', recommended_model_id: 'local' }

afterEach(() => { cleanup(); apiServer.reset(); localStorage.clear() })

test('opens settings over the current novel and returns focus without losing the scene', async () => {
  apiServer.session({ id: 'session-1', state_version: 1, current_scene: 'Крыша', provider_id: 'ollama', model_id: 'local', latest_turn: null, story, characters: [], visual_state: { emotion: 'neutral', pose: 'standing', outfit: 'red_dress' } })
  apiServer.providersAvailable(true, ['local'])
  render(<TestRouter initialEntries={['/play/session-1']} />)
  const scene = await screen.findByTestId('story-player-route')
  await userEvent.click(screen.getByRole('button', { name: 'Открыть навигацию' }))
  const settingsButton = screen.getByRole('button', { name: 'Настройки' })
  await userEvent.click(settingsButton)
  expect(screen.getByRole('dialog', { name: 'Настройки' })).toBeInTheDocument()
  expect(screen.getByTestId('story-player-route')).toBe(scene)
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(settingsButton).toHaveFocus()
})

test('uses a page outside the novel and persists the collapse style', async () => {
  apiServer.listStories([])
  apiServer.providersAvailable(true, ['local'])
  render(<TestRouter initialEntries={['/characters']} />)
  await userEvent.click(screen.getByRole('link', { name: 'Настройки' }))
  expect(await screen.findByRole('heading', { name: 'Настройки' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('switch', { name: 'Показывать иконки при сворачивании' }))
  expect(localStorage.getItem('mnemosyne.sidebar.show-icons-when-collapsed')).toBe('true')
  expect(await screen.findByText('local')).toBeInTheDocument()
})

test('shows unavailable provider without pretending a model can be selected', async () => {
  apiServer.providersAvailable(false)
  render(<TestRouter initialEntries={['/settings']} />)
  expect(await screen.findByText('Недоступно')).toBeInTheDocument()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
})
