import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import { apiServer } from '@/test/api-server'
import { TestRouter } from '@/test/TestRouter'

const story = { id: 'story-1', slug: 'akane-neon-echo', title: 'Эхо неона', premise: 'Дождливый город', story_mode: 'hybrid' as const, recommended_provider_id: 'ollama', recommended_model_id: 'local' }
const character = { id: 'akane', name: 'Аканэ', gender: 'female' as const, age: 25, personality: 'Наблюдательная', appearance: 'Красное платье', visual_profile_version: 1 }
const mark = { id: 'mark', name: 'Марк Ветров', gender: 'male' as const, age: 29, personality: 'Архивист', appearance: 'Тёмное пальто', visual_profile_version: 1 }

afterEach(() => { cleanup(); apiServer.reset() })

test('shows characters from all stories with their story title', async () => {
  apiServer.listStories([story])
  apiServer.storyDetail(story.id, { ...story, current_scene: 'Крыша', characters: [character] })
  render(<TestRouter initialEntries={['/characters']} />)
  expect(await screen.findByRole('heading', { name: 'Аканэ' })).toBeInTheDocument()
  expect(screen.getByText('Эхо неона')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Аканэ/ })).toHaveAttribute('href', '/characters/story-1/akane')
  expect(screen.getByRole('img', { name: 'Портрет Аканэ' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Портрет Аканэ' }).tagName).toBe('IMG')
  expect(screen.getByRole('img', { name: 'Портрет Аканэ' })).toHaveAttribute('src', expect.stringContaining('akane-avatar'))
  expect(screen.queryByRole('button', { name: /редактировать|создать/i })).not.toBeInTheDocument()
})

test('opens a character profile with the existing story details', async () => {
  const detailed = {
    ...character,
    personality: 'Уверенная и наблюдательная',
    appearance: JSON.stringify({ hair: 'Длинные чёрные волосы', eyes: 'Красные', outfit: 'Красное платье', features: ['Кошачьи ушки', 'Веер'] }),
  }
  apiServer.listStories([story])
  apiServer.storyDetail(story.id, { ...story, current_scene: 'Крыша', characters: [detailed] })
  render(<TestRouter initialEntries={['/characters']} />)
  await userEvent.click(await screen.findByRole('link', { name: /Аканэ/ }))
  expect(await screen.findByRole('heading', { name: 'Аканэ' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Портрет Аканэ' })).toBeInTheDocument()
  expect(screen.getByText('Уверенная и наблюдательная')).toBeInTheDocument()
  expect(screen.getByText('Длинные чёрные волосы')).toBeInTheDocument()
  expect(screen.getByText('Кошачьи ушки')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Все персонажи' })).toHaveAttribute('href', '/characters')
})

test('filters the catalog by gender and keeps portraits linked to each character', async () => {
  apiServer.listStories([story])
  apiServer.storyDetail(story.id, { ...story, current_scene: 'Крыша', characters: [character, mark] })
  render(<TestRouter initialEntries={['/characters']} />)
  expect(await screen.findByRole('heading', { name: 'Марк Ветров' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Портрет Марк Ветров' })).toHaveAttribute('src', expect.stringContaining('mark-avatar'))

  await userEvent.click(screen.getByRole('radio', { name: 'Мужчины' }))
  expect(screen.getByRole('heading', { name: 'Марк Ветров' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Аканэ' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: 'Женщины' }))
  expect(screen.getByRole('heading', { name: 'Аканэ' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Марк Ветров' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: 'Все' }))
  expect(screen.getByRole('heading', { name: 'Марк Ветров' })).toBeInTheDocument()
})

test('shows a useful message for a missing character', async () => {
  apiServer.storyDetail(story.id, { ...story, current_scene: 'Крыша', characters: [character] })
  render(<TestRouter initialEntries={['/characters/story-1/unknown']} />)
  expect(await screen.findByText('Персонаж не найден.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Все персонажи' })).toBeInTheDocument()
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
