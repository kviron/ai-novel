import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import { SceneBackground } from './SceneBackground'

afterEach(cleanup)

test('uses the saved archive location after a turn', () => {
  render(<SceneBackground storySlug="akane-neon-echo" background="signal_archive" />)
  expect(screen.getByTestId('scene-background')).toHaveAttribute('data-background', 'signal_archive')
})

test('falls back to the crossroads for old saves and unknown locations', () => {
  const { rerender } = render(<SceneBackground storySlug="akane-neon-echo" />)
  expect(screen.getByTestId('scene-background')).toHaveAttribute('data-background', 'neon_crossroads')
  rerender(<SceneBackground storySlug="akane-neon-echo" background="../../bad" />)
  expect(screen.getByTestId('scene-background')).toHaveAttribute('data-background', 'neon_crossroads')
})
