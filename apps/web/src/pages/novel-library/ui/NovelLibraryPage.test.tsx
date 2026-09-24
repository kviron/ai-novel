import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import { apiServer } from '@/test/api-server'
import { TestRouter } from '@/test/TestRouter'

afterEach(() => {
  cleanup()
  apiServer.reset()
})

test('запускает историю с моделью, настроенной на сервере, даже если рекомендация истории другая', async () => {
  apiServer.listStories([{
    id: 'story-1',
    slug: 'akane-neon-echo',
    title: 'Эхо неона',
    premise: 'Курьер находит чужое воспоминание в дождливом мегаполисе.',
    story_mode: 'hybrid',
    recommended_provider_id: 'ollama',
    recommended_model_id: 'qwen3:14b-q4_K_M',
  }])
  apiServer.startSession({ id: 'session-1', state_version: 1, model_id: 'gemma4-local:32k' })

  render(<TestRouter initialEntries={['/']} />)

  expect(await screen.findByRole('heading', { name: 'Эхо неона' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Начать новую игру' }))
  expect(apiServer.lastStartSessionRequest()).toEqual({
    provider_id: 'ollama',
    kind: 'player',
  })
  expect(await screen.findByTestId('story-player-route')).toHaveAttribute('data-session-id', 'session-1')
})

test('показывает сохранённое прохождение и продолжает ту же сессию', async () => {
  const story = {
    id: 'story-1', slug: 'akane-neon-echo', title: 'Эхо неона', premise: 'Курьер находит воспоминание.',
    description: 'История о чужих воспоминаниях в дождливом городе.', cover_image_url: '/covers/akane-neon-echo.webp',
    story_mode: 'hybrid' as const, recommended_provider_id: 'ollama', recommended_model_id: 'qwen3:14b-q4_K_M',
  }
  apiServer.listStories([story])
  apiServer.savedSessions([{ id: 'save-1', story, state_version: 4, current_scene: 'На крыше', created_at: '2026-09-24T11:00:00', updated_at: '2026-09-24T12:00:00', kind: 'player' }])
  apiServer.session({ id: 'save-1', story, state_version: 4, current_scene: 'На крыше', characters: [], provider_id: 'ollama', model_id: 'qwen3:14b-q4_K_M', latest_turn: null, visual_state: { emotion: 'neutral', pose: 'default', outfit: 'red_dress' } })
  render(<TestRouter initialEntries={['/']} />)

  expect(await screen.findByText(story.description)).toBeInTheDocument()
  expect(screen.getByRole('img', { name: /Обложка.*Эхо неона/ })).toHaveAttribute('src', story.cover_image_url)
  fireEvent.error(screen.getByRole('img', { name: /Обложка.*Эхо неона/ }))
  expect(screen.getByRole('img', { name: /Обложка.*Эхо неона/ })).toHaveTextContent('Эхо неона')
  await userEvent.click(screen.getByRole('tab', { name: /Начатые/ }))
  expect(await screen.findByText('Сцена: На крыше')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Продолжить' }))
  expect(await screen.findByTestId('story-player-route')).toHaveAttribute('data-session-id', 'save-1')
  expect(apiServer.lastStartSessionRequest()).toBeNull()
})

test('позволяет повторить загрузку сохранений независимо от каталога', async () => {
  apiServer.listStories([{ id: 'story-1', slug: 'akane-neon-echo', title: 'Эхо неона', premise: 'Дождливый город', story_mode: 'hybrid', recommended_provider_id: 'ollama', recommended_model_id: 'qwen3:14b-q4_K_M' }])
  apiServer.failSaveListOnce()
  render(<TestRouter initialEntries={['/']} />)

  expect(await screen.findByRole('heading', { name: 'Эхо неона' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Начатые' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить сохранения.')
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  expect(await screen.findByText('Вы ещё не начали ни одной новеллы.')).toBeInTheDocument()
})
