import { expect, test } from 'vitest'

import { resolveStoryTheme } from './story-themes'

test('назначает «Эху неона» отдельную тему с системным fallback', () => {
  expect(resolveStoryTheme('akane-neon-echo').id).toBe('akane-neon-echo')
  expect(resolveStoryTheme('akane-neon-echo').variables['--primary']).toBeTruthy()
  expect(resolveStoryTheme('unknown-story')).toEqual({ id: 'system', variables: {} })
})
