import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { apiServer } from '@/test/api-server'
import { TestRouter } from '@/test/TestRouter'

const story = { id: 'story-1', slug: 'test', title: 'Тестовая новелла', premise: 'Тест', description: 'Тест', cover_image_url: null, story_mode: 'free' as const, recommended_provider_id: 'ollama', recommended_model_id: 'test' }
const character = { id: 'mark', character_id: 'mark', current_revision_id: 'mark-v2', revision_number: 2, name: 'Марк', gender: 'male', age: 29, personality: 'Спокойный', appearance: 'Тёмные волосы', biography: '', speech: '', role: '', source_type: 'local', created_at: '2026-09-24' }
const revision = { id: 'mark-v2', revision_number: 2, name: 'Марк', gender: 'male', age: 29, personality: 'Спокойный', appearance: 'Тёмные волосы', biography: '', speech: '', role: '', created_at: '2026-09-24' }

afterEach(() => { cleanup(); apiServer.reset() })

test('attaches a selected character revision to a story', async () => {
  apiServer.storyDetail(story.id, { ...story, current_scene: 'Начало', characters: [] })
  apiServer.listCharacters([character])
  apiServer.characterDetail('mark', { id: 'mark', current_revision_id: 'mark-v2', source_type: 'local', revisions: [revision], linked_stories: [] })
  render(<TestRouter initialEntries={['/studio/stories/story-1/characters']} />)

  await userEvent.click(await screen.findByRole('button', { name: /Марк.*Не добавлен/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Добавить в новеллу' }))

  expect(await screen.findByText('Сейчас закреплена ревизия v2.')).toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([url, options]) => url === '/api/stories/story-1/characters' && options?.method === 'POST')).toBe(true)
})

test('repins an attached character without starting a session', async () => {
  apiServer.storyDetail(story.id, { ...story, current_scene: 'Начало', characters: [{ ...revision, id: 'mark', visual_profile_version: 1 }] })
  apiServer.listCharacters([character])
  apiServer.characterDetail('mark', { id: 'mark', current_revision_id: 'mark-v2', source_type: 'local', revisions: [revision, { ...revision, id: 'mark-v1', revision_number: 1 }], linked_stories: [{ story_id: 'story-1', story_title: story.title, story_slug: story.slug, revision_id: 'mark-v1', revision_number: 1 }] })
  render(<TestRouter initialEntries={['/studio/stories/story-1/characters']} />)

  await userEvent.click(await screen.findByRole('button', { name: /Марк.*В составе/ }))
  await userEvent.selectOptions(screen.getByLabelText('Ревизия'), 'mark-v2')
  await userEvent.click(screen.getByRole('button', { name: 'Обновить ревизию' }))

  expect(await screen.findByText('Сейчас закреплена ревизия v2.')).toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([url, options]) => url === '/api/stories/story-1/characters/mark' && options?.method === 'PUT')).toBe(true)
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/sessions'))).toBe(false)
})
