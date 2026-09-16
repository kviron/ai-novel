import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import App from './App'

const story = {
  id: 'story-1', title: 'Echoes of Neon', premise: 'Rain and memories',
  state_version: 1, current_scene: 'Arrival', theme_labels: ['mystery'],
  characters: [{ id: 'mira', name: 'Mira', age: 24, personality: 'guarded', appearance: 'silver hair' }],
  latest_turn: null,
}

test('creates a story and opens the visual novel stage', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/health/providers')) return new Response(JSON.stringify({ ollama: { available: false }, comfyui: { available: false } }))
    if (url.endsWith('/jobs')) return new Response(JSON.stringify([{ id: 'job-1', kind: 'character_sheet', status: 'queued', stage: 'Waiting for image worker' }]))
    return new Response(JSON.stringify(story), { status: 201 })
  }))
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: /begin story/i }))
  expect(await screen.findByRole('heading', { name: 'Echoes of Neon' })).toBeInTheDocument()
  expect(screen.getByText('Mira')).toBeInTheDocument()
  expect(screen.getByText(/Waiting for image worker/i)).toBeInTheDocument()
})
