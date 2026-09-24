import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import { apiServer } from '@/test/api-server'
import { TestRouter } from '@/test/TestRouter'

afterEach(() => { cleanup(); apiServer.reset() })

test('меню открывается поверх активной новеллы без потери сессии', async () => {
  apiServer.session({
    id: 'session-1', state_version: 1, current_scene: 'Крыша', provider_id: 'ollama', model_id: 'local', latest_turn: null,
    story: { id: 'story-1', slug: 'akane-neon-echo', title: 'Эхо неона', premise: 'Дождливый город', story_mode: 'hybrid', recommended_provider_id: 'ollama', recommended_model_id: 'local' },
    characters: [], visual_state: { emotion: 'neutral', pose: 'standing', outfit: 'red_dress' },
  })
  apiServer.providersAvailable()
  render(<TestRouter initialEntries={['/play/session-1']} />)

  const scene = await screen.findByTestId('story-player-route')
  expect(scene).toHaveAttribute('data-session-id', 'session-1')
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(document.querySelector('[data-slot="sidebar"]')).toHaveAttribute('data-collapsible', 'offcanvas')
  await userEvent.click(screen.getByRole('button', { name: 'Открыть навигацию' }))
  expect(screen.getByRole('link', { name: 'Библиотека' })).toBeInTheDocument()
  expect(screen.getByTestId('story-player-route')).toBe(scene)
})
