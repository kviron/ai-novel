import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import { apiServer } from '@/test/api-server'
import { TestRouter } from '@/test/TestRouter'

const story = { id: 'story-1', slug: 'akane-neon-echo', title: 'Эхо неона', premise: 'Дождливый город', story_mode: 'hybrid' as const, recommended_provider_id: 'ollama', recommended_model_id: 'local' }
const character = { id: 'akane', name: 'Аканэ', age: 25, personality: 'Наблюдательная', appearance: 'Красное платье', visual_profile_version: 1 }

afterEach(() => { cleanup(); apiServer.reset() })

test('shows characters from all stories with their story title', async () => {
  apiServer.listStories([story])
  apiServer.storyDetail(story.id, { ...story, current_scene: 'Крыша', characters: [character] })
  render(<TestRouter initialEntries={['/characters']} />)
  expect(await screen.findByRole('heading', { name: 'Аканэ' })).toBeInTheDocument()
  expect(screen.getByText('Эхо неона')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /редактировать|создать/i })).not.toBeInTheDocument()
})

test('shows a useful empty state when stories have no characters', async () => {
  apiServer.listStories([])
  render(<TestRouter initialEntries={['/characters']} />)
  expect(await screen.findByText('Персонажей пока нет.')).toBeInTheDocument()
})

test('retains available characters when one story fails to load', async () => {
  const other = { ...story, id: 'story-2', slug: 'second', title: 'Другая история' }
  apiServer.listStories([story, other])
  apiServer.storyDetail(story.id, { ...story, current_scene: 'Крыша', characters: [character] })
  render(<TestRouter initialEntries={['/characters']} />)
  expect(await screen.findByRole('heading', { name: 'Аканэ' })).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Не все истории удалось загрузить')
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled()
})

test('offers retry after the library request fails', async () => {
  apiServer.failStoryListOnce()
  render(<TestRouter initialEntries={['/characters']} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить персонажей')
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled()
})
