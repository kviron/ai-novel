import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { apiServer } from '@/test/api-server'
import { TestRouter } from '@/test/TestRouter'

const character = {
  id: 'akane', character_id: 'akane', current_revision_id: 'akane-v1', revision_number: 1,
  name: 'Аканэ', gender: 'female', age: 25, personality: 'Наблюдательная',
  appearance: 'Красное платье', biography: '', speech: '', role: '', source_type: 'builtin', created_at: '2026-09-24',
}
const mark = { ...character, id: 'mark', character_id: 'mark', current_revision_id: 'mark-v1', name: 'Марк Ветров', gender: 'male', age: 29 }

afterEach(() => { cleanup(); apiServer.reset() })

test('loads the global catalog once and links to a canonical profile', async () => {
  apiServer.listCharacters([character, mark])
  render(<TestRouter initialEntries={['/characters']} />)
  expect(await screen.findByRole('heading', { name: 'Аканэ' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Аканэ/ })).toHaveAttribute('href', '/characters/akane')
  expect(screen.getByRole('img', { name: 'Портрет Аканэ' })).toHaveAttribute('src', expect.stringContaining('akane-avatar'))
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/characters'))).toHaveLength(1)
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/stories'))).toHaveLength(0)
})

test('opens the current revision and preserves old deep links', async () => {
  const revision = {
    ...character, id: 'akane-v1',
    personality: 'Уверенная и наблюдательная',
    appearance: JSON.stringify({ hair: 'Длинные чёрные волосы', features: ['Кошачьи ушки'] }),
  }
  apiServer.listCharacters([character])
  apiServer.characterDetail('akane', { id: 'akane', current_revision_id: 'akane-v1', source_type: 'builtin', revisions: [revision], linked_stories: [{ story_id: 'story-1', story_title: 'Эхо неона', story_slug: 'akane-neon-echo', revision_id: 'akane-v1', revision_number: 1 }] })
  render(<TestRouter initialEntries={['/characters/story-1/akane']} />)
  expect(await screen.findByRole('heading', { name: 'Аканэ' })).toBeInTheDocument()
  expect(screen.getByText('Уверенная и наблюдательная')).toBeInTheDocument()
  expect(screen.getByText('Длинные чёрные волосы')).toBeInTheDocument()
  expect(screen.getByText('Кошачьи ушки')).toBeInTheDocument()
  expect(screen.getByText(/Ревизия 1/)).toBeInTheDocument()
  expect(screen.getByText('Эхо неона')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Все персонажи' })).toHaveAttribute('href', '/characters')
})

test('does not hide unfamiliar JSON appearance fields', async () => {
  const revision = { ...character, id: 'akane-v1', appearance: JSON.stringify({ markings: 'Серебряный узор' }) }
  apiServer.characterDetail('akane', { id: 'akane', current_revision_id: 'akane-v1', source_type: 'builtin', revisions: [revision], linked_stories: [] })
  render(<TestRouter initialEntries={['/characters/akane']} />)
  expect(await screen.findByText('Серебряный узор')).toBeInTheDocument()
})

test('filters profiles by gender without duplicating a character across stories', async () => {
  apiServer.listCharacters([character, mark])
  render(<TestRouter initialEntries={['/characters']} />)
  expect(await screen.findByRole('heading', { name: 'Марк Ветров' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Портрет Марк Ветров' })).toHaveAttribute('src', expect.stringContaining('mark-avatar'))
  await userEvent.click(screen.getByRole('radio', { name: 'Мужчины' }))
  expect(screen.queryByRole('heading', { name: 'Аканэ' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: 'Женщины' }))
  expect(screen.queryByRole('heading', { name: 'Марк Ветров' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('radio', { name: 'Все' }))
  expect(screen.getByRole('heading', { name: 'Марк Ветров' })).toBeInTheDocument()
})

test('shows a useful message for an unknown character', async () => {
  render(<TestRouter initialEntries={['/characters/unknown']} />)
  expect(await screen.findByText('Персонаж не найден.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Все персонажи' })).toBeInTheDocument()
})

test('shows empty state and offers retry after a request failure', async () => {
  apiServer.failCharacterListOnce()
  render(<TestRouter initialEntries={['/characters']} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить персонажей')
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
  expect(await screen.findByText('Персонажей пока нет.')).toBeInTheDocument()
})
