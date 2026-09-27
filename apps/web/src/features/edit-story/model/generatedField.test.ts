import { expect, test } from 'vitest'

import type { StoryCanonSection, StoryRulesSection } from '@/shared/api'
import { applyGeneratedField } from './generatedField'

test('генерация вложенного события меняет только выбранное поле', () => {
  const canon: StoryCanonSection = {
    creative_goals: 'Свобода выбора', facts: [],
    beats: [
      { id: 'a', order_index: 0, title: 'Первое', description: 'Было', activation_condition: { kind: 'always' }, completion_evidence: '', required: true, ending_gate: false },
      { id: 'b', order_index: 1, title: 'Второе', description: 'Сохранить', activation_condition: { kind: 'always' }, completion_evidence: '', required: true, ending_gate: false },
    ],
  }
  const result = applyGeneratedField(canon, 'canon.beat.description', 'Стало', 'a') as StoryCanonSection
  expect(result.beats[0].description).toBe('Стало')
  expect(result.beats[1].description).toBe('Сохранить')
  expect(result.creative_goals).toBe('Свобода выбора')
})

test('генерация списка тем не меняет остальные правила', () => {
  const rules: StoryRulesSection = {
    themes_allowed: ['мистика'], themes_blocked: [], ending_policy: 'open_ended',
    recommended_provider_id: 'ollama', recommended_model_id: 'qwen3:14b-q4_K_M',
    generation_policy: {
      narration_perspective: 'second_person', prose_density: 'balanced', choice_policy: 'choices_and_free_input',
      min_choices: 2, max_choices: 4, allow_romance: true, allow_violence: true, allow_horror: true,
      allow_sexual_themes: false, desired_themes: 'Поиск', forbidden_outcomes: '',
    },
  }
  const result = applyGeneratedField(rules, 'rules.themes_allowed', 'мистика, память, мистика') as StoryRulesSection
  expect(result.themes_allowed).toEqual(['мистика', 'память'])
  expect(result.generation_policy.desired_themes).toBe('Поиск')
})
