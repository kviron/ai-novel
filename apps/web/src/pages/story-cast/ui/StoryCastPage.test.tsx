import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { apiServer } from '@/test/api-server'
import { TestRouter } from '@/test/TestRouter'

const story = { id: 'story-1', slug: 'test', title: 'Тестовая новелла', premise: 'Тест', description: 'Тест', cover_image_url: null, story_mode: 'free' as const, recommended_provider_id: 'ollama', recommended_model_id: 'test' }
const character = { id: 'mark', character_id: 'mark', current_revision_id: 'mark-v2', revision_number: 2, name: 'Марк Ветров', gender: 'male', age: 29, personality: 'Спокойный', appearance: 'Тёмные волосы', biography: '', speech: '', source_type: 'local', created_at: '2026-09-24' }
const revision = { ...character, id: 'mark-v2', revision_number: 2 }

afterEach(() => { cleanup(); apiServer.reset() })

test('opens a server-filtered catalog and adds selected characters in one batch', async () => {
  apiServer.storyDetail(story.id, { ...story, current_scene: 'Начало', characters: [] })
  apiServer.listCharacters([character])
  apiServer.characterDetail('mark', { id: 'mark', current_revision_id: 'mark-v2', source_type: 'local', revisions: [revision], linked_stories: [] })
  render(<TestRouter initialEntries={['/studio/stories/story-1/characters']} />)

  await userEvent.click(await screen.findByRole('button', { name: 'Добавить' }))
  expect(screen.getByRole('dialog', { name: 'Добавить персонажей' })).toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('exclude_story_id=story-1'))).toBe(true)
  await userEvent.click(screen.getByRole('checkbox', { name: 'Марк Ветров' }))
  await userEvent.click(screen.getByRole('button', { name: 'Добавить выбранных' }))
  expect(vi.mocked(fetch).mock.calls.some(([url, options]) => url === '/api/stories/story-1/characters/batch' && options?.method === 'POST')).toBe(true)
  expect(await screen.findByText('Марк Ветров')).toBeInTheDocument()
})

test('edits a story-specific role, revision and color without starting a session', async () => {
  apiServer.storyDetail(story.id, { ...story, current_scene: 'Начало', characters: [{ ...revision, id: 'mark', role: 'cast', color: '#D9A75F', visual_profile_version: 2 }] })
  apiServer.characterDetail('mark', { id: 'mark', current_revision_id: 'mark-v2', source_type: 'local', revisions: [revision, { ...revision, id: 'mark-v1', revision_number: 1 }], linked_stories: [{ story_id: 'story-1', story_title: story.title, story_slug: story.slug, revision_id: 'mark-v2', revision_number: 2, role: 'cast', color: '#D9A75F' }] })
  render(<TestRouter initialEntries={['/studio/stories/story-1/characters']} />)

  await userEvent.click(await screen.findByRole('button', { name: 'Редактировать Марк Ветров' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Роль в новелле' }), 'Союзник героини')
  await userEvent.click(screen.getByRole('button', { name: 'Сгенерировать роль' }))
  expect(await screen.findByDisplayValue('Союзник героини и хранитель секрета города.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  const update = vi.mocked(fetch).mock.calls.find(([url, options]) => url === '/api/stories/story-1/characters/mark' && options?.method === 'PUT')
  expect(JSON.parse(String(update?.[1]?.body))).toMatchObject({ role: 'Союзник героини и хранитель секрета города.', color: '#D9A75F', revision_id: 'mark-v2' })
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/sessions'))).toBe(false)
})

test('removes only the story link after confirmation', async () => {
  apiServer.storyDetail(story.id, { ...story, current_scene: 'Начало', characters: [{ ...revision, id: 'mark', role: 'cast', color: '#D9A75F', visual_profile_version: 2 }, { ...revision, id: 'akane', name: 'Аканэ', role: 'cast', visual_profile_version: 1 }] })
  render(<TestRouter initialEntries={['/studio/stories/story-1/characters']} />)

  await userEvent.click(await screen.findByRole('button', { name: 'Удалить Марк Ветров' }))
  expect(screen.getByRole('dialog', { name: 'Убрать персонажа?' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Убрать из новеллы' }))
  expect(vi.mocked(fetch).mock.calls.some(([url, options]) => url === '/api/stories/story-1/characters/mark' && options?.method === 'DELETE')).toBe(true)
})

test('does not save an invalid dialogue color', async () => {
  apiServer.storyDetail(story.id, { ...story, current_scene: 'Начало', characters: [{ ...revision, id: 'mark', role: 'cast', color: '#D9A75F', visual_profile_version: 2 }] })
  apiServer.characterDetail('mark', { id: 'mark', current_revision_id: 'mark-v2', source_type: 'local', revisions: [revision], linked_stories: [] })
  render(<TestRouter initialEntries={['/studio/stories/story-1/characters']} />)

  await userEvent.click(await screen.findByRole('button', { name: 'Редактировать Марк Ветров' }))
  await userEvent.clear(screen.getByRole('textbox', { name: 'HEX-код цвета' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'HEX-код цвета' }), '#oops')
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
})

test('filters available characters by name and gender before selection', async () => {
  apiServer.storyDetail(story.id, { ...story, current_scene: 'Начало', characters: [] })
  apiServer.listCharacters([character, { ...character, id: 'akane', character_id: 'akane', name: 'Аканэ Куроха', gender: 'female' }, { ...character, id: 'sasha', character_id: 'sasha', name: 'Саша', gender: 'небинарный' }])
  render(<TestRouter initialEntries={['/studio/stories/story-1/characters']} />)

  await userEvent.click(await screen.findByRole('button', { name: 'Добавить' }))
  await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск персонажа' }), 'Аканэ')
  expect(screen.getByRole('checkbox', { name: 'Аканэ Куроха' })).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'Марк Ветров' })).not.toBeInTheDocument()
  await userEvent.clear(screen.getByRole('searchbox', { name: 'Поиск персонажа' }))
  expect(screen.getByText('небинарный')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: 'Мужской' }))
  expect(screen.getByRole('checkbox', { name: 'Марк Ветров' })).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'Аканэ Куроха' })).not.toBeInTheDocument()
})
