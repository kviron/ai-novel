import { expect, test } from 'vitest'

import type { StorySession } from './contracts'

const restoredSession = {
  id: 'session-1',
  story: {
    id: 'story-1',
    slug: 'akane-neon-echo',
    title: 'Эхо неона',
    premise: 'Курьер находит чужое воспоминание в дождливом мегаполисе.',
    story_mode: 'hybrid',
    recommended_provider_id: 'ollama',
    recommended_model_id: 'qwen3:14b-q4_K_M',
  },
  characters: [],
  state_version: 2,
  current_scene: 'Прибытие',
  provider_id: 'ollama',
  model_id: 'qwen3:14b-q4_K_M',
  latest_turn: {
    id: 'turn-1',
    state_version: 2,
    action: 'Посмотреть на Аканэ',
    prompt_version: 'v1',
    speaker: 'Аканэ Куроха',
    narration: 'Неон отражается в лужах.',
    dialogue: 'Я ждала вас.',
    choices: ['Спросить о сигнале', 'Осмотреть комнату'],
    visual_directive: { character_id: 'akane', emotion: 'neutral', pose: 'default', outfit: 'red_dress' },
  },
  visual_state: { emotion: 'neutral', pose: 'default', outfit: 'red_dress' },
} satisfies StorySession

test('models a restored session with the persisted turn DTO only', () => {
  expect(restoredSession.latest_turn).toEqual({
    id: 'turn-1',
    state_version: 2,
    action: 'Посмотреть на Аканэ',
    prompt_version: 'v1',
    speaker: 'Аканэ Куроха',
    narration: 'Неон отражается в лужах.',
    dialogue: 'Я ждала вас.',
    choices: ['Спросить о сигнале', 'Осмотреть комнату'],
    visual_directive: { character_id: 'akane', emotion: 'neutral', pose: 'default', outfit: 'red_dress' },
  })
  expect(restoredSession.latest_turn).not.toHaveProperty('request_id')
  expect(restoredSession.latest_turn).not.toHaveProperty('provider_id')
})
