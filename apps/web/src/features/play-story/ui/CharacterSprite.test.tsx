import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import type { StorySession } from '@/shared/api'
import '@/styles.css'
import { CharacterSprite } from './CharacterSprite'

afterEach(cleanup)

const protagonist: StorySession['protagonist'] = { session_id: 'session-1', source_kind: 'legacy', source_character_id: null, source_revision_id: null, policy_version: 1, name: 'Игрок', address: 'Игрок', gender: 'unspecified', appearance: '', biography: '', personality: '', age: null }

test('shows Mark rather than Akane when Mark speaks', () => {
  const session: StorySession = {
    id: 'session-1', state_version: 2, can_rewind: true, current_scene: 'Архив', provider_id: 'ollama', model_id: 'local',
    protagonist,
    story: { id: 'story-1', slug: 'akane-neon-echo', title: 'Эхо неона', premise: '', description: '', cover_image_url: null, story_mode: 'hybrid', recommended_provider_id: 'ollama', recommended_model_id: 'local' },
    characters: [
      { id: 'akane', revision_id: 'akane-r1', name: 'Аканэ', gender: 'female', age: 25, personality: '', appearance: '', visual_profile_version: 1 },
      { id: 'mark', revision_id: 'mark-r1', name: 'Марк Ветров', gender: 'male', age: 29, personality: '', appearance: '', visual_profile_version: 1, sprites: { neutral: [{ variant: 'default', material: { id: 'mark-sprite', kind: 'sprite:neutral:default', sha256: 'hash', mime_type: 'image/png', filename: 'mark.png', creator: 'Project', license: 'own', source: 'bundled', url: '/mark-sprite.png' } }] } },
    ],
    latest_turn: { id: 'turn-1', state_version: 2, action: 'Спросить Марка', prompt_version: 'v1', speaker: 'Марк Ветров', narration: '', dialogue: 'Я нашёл запись.', choices: [], visual_directive: { character_id: 'mark', emotion: 'neutral', pose: 'default', outfit: 'dark_coat', background: 'signal_archive' } },
    visual_state: { emotion: 'neutral', pose: 'default', outfit: 'dark_coat', background: 'signal_archive' },
  }

  render(<CharacterSprite session={session} />)
  expect(screen.getByRole('img', { name: /Марк Ветров/ })).toHaveAttribute('src', expect.stringContaining('mark-sprite'))
  expect(screen.queryByRole('img', { name: /Аканэ/ })).not.toBeInTheDocument()
})

test('shows a silent character who remains present in the scene', () => {
  const session: StorySession = {
    id: 'session-3', state_version: 2, can_rewind: true, current_scene: 'Перекрёсток', provider_id: 'ollama', model_id: 'local',
    protagonist,
    story: { id: 'story-1', slug: 'akane-neon-echo', title: 'Эхо неона', premise: '', description: '', cover_image_url: null, story_mode: 'hybrid', recommended_provider_id: 'ollama', recommended_model_id: 'local' },
    characters: [
      { id: 'akane', revision_id: 'akane-r1', name: 'Аканэ', gender: 'female', age: 25, personality: '', appearance: '', visual_profile_version: 1 },
      { id: 'mark', revision_id: 'mark-r1', name: 'Марк Ветров', gender: 'male', age: 29, personality: '', appearance: '', visual_profile_version: 1 },
    ],
    latest_turn: { id: 'turn-3', state_version: 2, action: 'Спросить Аканэ', prompt_version: 'v1', speaker: 'Аканэ', narration: '', dialogue: 'Марк рядом.', choices: [], visual_directive: { character_id: 'akane', emotion: 'neutral', pose: 'default', outfit: 'red_dress', background: 'neon_crossroads', present_character_ids: ['akane', 'mark'] } },
    visual_state: { emotion: 'neutral', pose: 'default', outfit: 'red_dress', background: 'neon_crossroads' },
  }

  render(<CharacterSprite session={session} />)
  expect(screen.getByRole('img', { name: /Аканэ/ })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: /Марк Ветров/ })).toBeInTheDocument()
})

test('keeps full sprite scale when two characters share the scene', () => {
  const sprite = (id: string) => ({ neutral: [{ variant: 'default', material: { id, kind: 'sprite:neutral:default', sha256: id, mime_type: 'image/png', filename: `${id}.png`, creator: 'Project', license: 'own', source: 'test', url: `/${id}.png` } }] })
  const session: StorySession = {
    id: 'session-pair', state_version: 2, can_rewind: false, current_scene: 'Улица', provider_id: 'ollama', model_id: 'local', protagonist,
    story: { id: 'story-1', slug: 'pair', title: 'Пара', premise: '', description: '', cover_image_url: null, story_mode: 'hybrid', recommended_provider_id: 'ollama', recommended_model_id: 'local' },
    characters: [
      { id: 'akane', revision_id: 'akane-r1', name: 'Аканэ', gender: 'female', age: 25, personality: '', appearance: '', visual_profile_version: 1, sprites: sprite('akane') },
      { id: 'mark', revision_id: 'mark-r1', name: 'Марк', gender: 'male', age: 29, personality: '', appearance: '', visual_profile_version: 1, sprites: sprite('mark') },
    ],
    latest_turn: { id: 'turn-pair', state_version: 2, action: '', prompt_version: 'v1', speaker: 'Аканэ', narration: '', dialogue: '', choices: [], visual_directive: { character_id: 'akane', emotion: 'neutral', pose: 'default', outfit: 'red_dress', background: 'neon_crossroads', present_character_ids: ['akane', 'mark'] } },
    visual_state: { emotion: 'neutral', pose: 'default', outfit: 'red_dress', background: 'neon_crossroads' },
  }
  render(<CharacterSprite session={session} />)
  expect(screen.getByTestId('character-cast')).toHaveAttribute('data-sprite-scale', 'full')
})

test('shows a named placeholder for a playable character without visual assets', () => {
  const session: StorySession = {
    id: 'session-2', state_version: 2, can_rewind: true, current_scene: 'Архив', provider_id: 'ollama', model_id: 'local',
    protagonist: { ...protagonist, session_id: 'session-2' },
    story: { id: 'story-1', slug: 'akane-neon-echo', title: 'Эхо неона', premise: '', description: '', cover_image_url: null, story_mode: 'hybrid', recommended_provider_id: 'ollama', recommended_model_id: 'local' },
    characters: [{ id: 'mira', revision_id: 'mira-r1', name: 'Мира', gender: 'female', age: 27, personality: '', appearance: '', visual_profile_version: 1 }],
    latest_turn: { id: 'turn-2', state_version: 2, action: 'Спросить Миру', prompt_version: 'v1', speaker: 'Мира', narration: '', dialogue: 'Я видела сигнал.', choices: [], visual_directive: { character_id: 'mira', emotion: 'neutral', pose: 'default', outfit: 'none', background: 'signal_archive' } },
    visual_state: { emotion: 'neutral', pose: 'default', outfit: 'none', background: 'signal_archive' },
  }

  render(<CharacterSprite session={session} />)
  expect(screen.getByRole('img', { name: 'Мира: иллюстрация пока недоступна' })).toBeInTheDocument()
  expect(screen.queryByRole('img', { name: /Аканэ/ })).not.toBeInTheDocument()
})

test('uses a separate revision sprite for a catalog character emotion', () => {
  const ashley = {
    id: 'ashley', revision_id: 'ashley-r2', name: 'Эшли', gender: 'female' as const, age: 30, personality: '', appearance: '', visual_profile_version: 2,
    sprites: { angry: [{ variant: 'default', material: { id: 'angry-1', kind: 'sprite:angry:default', sha256: 'hash', mime_type: 'image/png', filename: 'ashley-angry.png', creator: 'Project', license: 'own', source: 'ai-assisted', url: '/api/character-materials/angry-1' } }] },
  }
  const session: StorySession = {
    id: 'session-ashley', state_version: 2, can_rewind: true, current_scene: 'Лес', provider_id: 'ollama', model_id: 'local', protagonist,
    story: { id: 'story-2', slug: 'forest', title: 'Лес', premise: '', description: '', cover_image_url: null, story_mode: 'hybrid', recommended_provider_id: 'ollama', recommended_model_id: 'local' },
    characters: [ashley],
    latest_turn: { id: 'turn-a', state_version: 2, action: 'Ответить', prompt_version: 'v1', speaker: 'Эшли', narration: '', dialogue: 'Стой.', choices: [], visual_directive: { character_id: 'ashley', emotion: 'angry', pose: 'default', outfit: 'emerald', background: 'neon_crossroads' } },
    visual_state: { emotion: 'angry', pose: 'default', outfit: 'emerald', background: 'neon_crossroads' },
  }

  render(<CharacterSprite session={session} />)
  expect(screen.getByRole('img', { name: 'Эшли: Злость' })).toHaveAttribute('src', '/api/character-materials/angry-1')
})
