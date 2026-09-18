import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import { apiServer } from '@/test/api-server'
import { TestRouter } from '@/test/TestRouter'

afterEach(() => {
  cleanup()
  apiServer.reset()
})

test('показывает встроенную историю и запускает прохождение', async () => {
  apiServer.listStories([{
    id: 'story-1',
    slug: 'akane-neon-echo',
    title: 'Эхо неона',
    premise: 'Курьер находит чужое воспоминание в дождливом мегаполисе.',
    story_mode: 'hybrid',
    recommended_provider_id: 'ollama',
    recommended_model_id: 'qwen3:14b-q4_K_M',
  }])
  apiServer.startSession({ id: 'session-1', state_version: 1 })

  render(<TestRouter initialEntries={['/']} />)

  expect(await screen.findByRole('heading', { name: 'Эхо неона' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Начать историю' }))
  expect(await screen.findByTestId('story-player-route')).toHaveAttribute('data-session-id', 'session-1')
})
