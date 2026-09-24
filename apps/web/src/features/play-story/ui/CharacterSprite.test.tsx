import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import type { StorySession } from '@/shared/api'
import { CharacterSprite } from './CharacterSprite'

test('shows Mark rather than Akane when Mark speaks', () => {
  const session: StorySession = {
    id: 'session-1', state_version: 2, can_rewind: true, current_scene: 'Архив', provider_id: 'ollama', model_id: 'local',
    story: { id: 'story-1', slug: 'akane-neon-echo', title: 'Эхо неона', premise: '', description: '', cover_image_url: null, story_mode: 'hybrid', recommended_provider_id: 'ollama', recommended_model_id: 'local' },
    characters: [
      { id: 'akane', name: 'Аканэ', gender: 'female', age: 25, personality: '', appearance: '', visual_profile_version: 1 },
      { id: 'mark', name: 'Марк Ветров', gender: 'male', age: 29, personality: '', appearance: '', visual_profile_version: 1 },
    ],
    latest_turn: { id: 'turn-1', state_version: 2, action: 'Спросить Марка', prompt_version: 'v1', speaker: 'Марк Ветров', narration: '', dialogue: 'Я нашёл запись.', choices: [], visual_directive: { character_id: 'mark', emotion: 'neutral', pose: 'default', outfit: 'dark_coat', background: 'signal_archive' } },
    visual_state: { emotion: 'neutral', pose: 'default', outfit: 'dark_coat', background: 'signal_archive' },
  }

  render(<CharacterSprite session={session} />)
  expect(screen.getByRole('img', { name: /Марк Ветров/ })).toHaveAttribute('src', expect.stringContaining('mark-avatar'))
  expect(screen.queryByRole('img', { name: /Аканэ/ })).not.toBeInTheDocument()
})
