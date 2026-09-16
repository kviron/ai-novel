import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import App from './App'

afterEach(() => cleanup())

const story = {
  id: 'story-1', title: 'Эхо неона', premise: 'Дождь и воспоминания',
  state_version: 1, current_scene: 'Прибытие', theme_labels: ['детектив'],
  characters: [{ id: 'akane', name: 'Аканэ Куроха', age: 25, personality: 'уверенная', appearance: 'чёрные волосы и красное платье' }],
  latest_turn: null,
}

test('creates a story and opens the visual novel stage', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/health/providers')) return new Response(JSON.stringify({ ollama: { available: false }, comfyui: { available: false } }))
    if (url.endsWith('/jobs')) return new Response(JSON.stringify([{ id: 'job-1', kind: 'character_sheet', status: 'queued', stage: 'Ожидает генератор изображений' }]))
    return new Response(JSON.stringify(story), { status: 201 })
  }))
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: /начать историю/i }))
  expect(await screen.findByRole('heading', { name: 'Эхо неона' })).toBeInTheDocument()
  expect(screen.getByText('Аканэ Куроха')).toBeInTheDocument()
  expect(screen.getByText(/Ожидает генератор изображений/i)).toBeInTheDocument()
})

test('changes Akane sprite when an expression is selected', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/health/providers')) return new Response(JSON.stringify({ ollama: { available: false }, comfyui: { available: false } }))
    if (url.endsWith('/jobs')) return new Response(JSON.stringify([]))
    return new Response(JSON.stringify(story), { status: 201 })
  }))

  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: /начать историю/i }))

  const sprite = await screen.findByRole('img', { name: 'Аканэ: Нейтральная' })
  expect(sprite).toHaveAttribute('data-expression', 'neutral')
  expect(sprite).toHaveStyle({ aspectRatio: '1 / 3' })
  await userEvent.click(screen.getByRole('radio', { name: 'С веером' }))
  expect(screen.getByRole('img', { name: 'Аканэ: С веером' })).toHaveAttribute('data-expression', 'fan')
})
