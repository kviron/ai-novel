import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import { apiServer } from '@/test/api-server'
import { TestRouter } from '@/test/TestRouter'

const story = {
  id: 'story-1', slug: 'echo', title: 'Эхо неона', premise: 'Ночной город', description: 'История', cover_image_url: null,
  story_mode: 'hybrid' as const, recommended_provider_id: 'ollama', recommended_model_id: 'gemma4-local:32k',
}

afterEach(() => { cleanup(); apiServer.reset() })

test('анкета героя подтверждается перед созданием сессии', async () => {
  apiServer.listStories([story])
  apiServer.storySetup(story.id, { story_id: story.id, policy: 'choice', policy_version: 1, allowed_sources: ['draft'], playable_character_ids: [], fixed_hero: null })
  apiServer.startSession({ id: 'session-draft', state_version: 1 })
  render(<TestRouter initialEntries={['/stories/story-1/setup']} />)

  await userEvent.type(await screen.findByRole('textbox', { name: 'Имя' }), 'Лена')
  await userEvent.type(screen.getByRole('textbox', { name: 'Предыстория' }), 'Ищет сестру.')
  await userEvent.click(screen.getByRole('button', { name: 'Проверить героя' }))
  expect(screen.getByText('Ищет сестру.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Изменить анкету' }))
  expect(screen.getByRole('textbox', { name: 'Имя' })).toHaveValue('Лена')
  await userEvent.click(screen.getByRole('button', { name: 'Проверить героя' }))
  await userEvent.click(screen.getByRole('button', { name: 'Начать историю' }))
  expect(apiServer.lastStartSessionRequest()).toEqual({ provider_id: 'ollama', kind: 'player', hero: {
    source_kind: 'draft', name: 'Лена', address: null, gender: 'unspecified', appearance: '', biography: 'Ищет сестру.',
  } })
  expect(await screen.findByTestId('story-player-route')).toHaveAttribute('data-session-id', 'session-draft')
})

test('каталог исключает сюжетных NPC и фиксирует выбранную ревизию', async () => {
  apiServer.listStories([story])
  apiServer.storyDetail(story.id, { ...story, current_scene: 'Улица', characters: [{ id: 'npc', name: 'Аканэ' }] })
  apiServer.storySetup(story.id, { story_id: story.id, policy: 'choice', policy_version: 2, allowed_sources: ['catalog'], playable_character_ids: [], fixed_hero: null })
  apiServer.listCharacters([
    { character_id: 'npc', id: 'npc-rev', current_revision_id: 'npc-rev', name: 'Аканэ', gender: 'female', age: 23, personality: '', appearance: '', biography: '', speech: '', revision_number: 1 },
    { character_id: 'hero', id: 'hero-rev', current_revision_id: 'hero-rev', name: 'Марк', gender: 'male', age: 26, personality: '', appearance: '', biography: '', speech: '', revision_number: 1 },
  ])
  apiServer.startSession({ id: 'session-catalog', state_version: 1 })
  render(<TestRouter initialEntries={['/stories/story-1/setup']} />)
  expect(await screen.findByText('Марк')).toBeInTheDocument()
  expect(screen.queryByText('Аканэ')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Марк/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Проверить героя' }))
  await userEvent.click(screen.getByRole('button', { name: 'Начать историю' }))
  expect(apiServer.lastStartSessionRequest()?.hero).toEqual({ source_kind: 'catalog', character_id: 'hero', revision_id: 'hero-rev' })
})

test('закреплённый автором герой показывается без смены источника', async () => {
  apiServer.listStories([story])
  apiServer.storySetup(story.id, { story_id: story.id, policy: 'fixed', policy_version: 3, allowed_sources: [], playable_character_ids: [], fixed_hero: {
    id: 'akane', name: 'Аканэ Куроха', gender: 'female', age: 25, personality: '', appearance: '', biography: 'Знает тайну города.', role: 'hero', visual_profile_version: 1,
  } })
  apiServer.startSession({ id: 'session-fixed', state_version: 1 })
  render(<TestRouter initialEntries={['/stories/story-1/setup']} />)
  expect(await screen.findByText(/Автор закрепил героя/)).toHaveTextContent('Аканэ Куроха')
  expect(screen.queryByRole('button', { name: 'Из каталога' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Проверить героя' }))
  expect(screen.getByText('Знает тайну города.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Начать историю' }))
  expect(apiServer.lastStartSessionRequest()?.hero).toEqual({ source_kind: 'fixed' })
})
