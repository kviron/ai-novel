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

test('shows a revision avatar from the API instead of the bundled portrait', async () => {
  apiServer.listCharacters([{ ...character, avatar: { id: 'material-1', url: '/api/character-materials/material-1', kind: 'avatar', sha256: 'hash', mime_type: 'image/png', filename: 'avatar.png', creator: 'Author', license: 'CC-BY-4.0', source: 'manual' } }])
  render(<TestRouter initialEntries={['/characters']} />)
  expect(await screen.findByRole('img', { name: 'Портрет Аканэ' })).toHaveAttribute('src', '/api/character-materials/material-1')
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

test('displays the current revision cover and its provenance', async () => {
  const material = { id: 'cover-1', url: '/api/character-materials/cover-1', kind: 'cover', sha256: 'hash', mime_type: 'image/png', filename: 'cover.png', creator: 'Author', license: 'CC-BY-4.0', source: 'original art' }
  apiServer.characterDetail('akane', {
    id: 'akane', current_revision_id: 'akane-v1', source_type: 'builtin',
    revisions: [{ ...character, id: 'akane-v1', cover: material }], linked_stories: [],
  })
  render(<TestRouter initialEntries={['/characters/akane']} />)
  expect(await screen.findByRole('img', { name: 'Обложка Аканэ' })).toHaveAttribute('src', material.url)
  expect(screen.getByText(/Author.*CC-BY-4.0/)).toBeInTheDocument()
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

test('opens a full-page character editor from the catalog', async () => {
  render(<TestRouter initialEntries={['/characters']} />)
  await userEvent.click(await screen.findByRole('link', { name: 'Создать персонажа' }))
  expect(await screen.findByRole('heading', { name: 'Новый персонаж' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Внешность и образ' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Сгенерировать характер' })).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Роль' })).not.toBeInTheDocument()
  await userEvent.type(screen.getByRole('textbox', { name: 'Имя' }), 'Леон')
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Возраст' }), '2')
  await userEvent.type(screen.getByRole('textbox', { name: 'Характер' }), 'Решительный')
  await userEvent.type(screen.getByRole('textbox', { name: 'Внешность' }), 'Тёмные волосы')
  await userEvent.click(screen.getByRole('button', { name: 'Создать персонажа' }))
  expect(await screen.findByRole('heading', { name: 'Леон' })).toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([url, options]) => url === '/api/characters' && options?.method === 'POST')).toBe(true)
})

test('generates one field using the unsaved draft and leaves it editable', async () => {
  render(<TestRouter initialEntries={['/characters/new']} />)
  await userEvent.type(await screen.findByRole('textbox', { name: 'Имя' }), 'Леон')
  await userEvent.type(screen.getByRole('textbox', { name: 'Характер' }), 'Любит дождь')
  await userEvent.click(screen.getByRole('button', { name: 'Сгенерировать характер' }))
  expect(await screen.findByRole('textbox', { name: 'Характер' })).toHaveValue('Любит дождь и исследует ночной город.')
  const call = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/characters/generate-field')
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ field: 'personality', draft: { name: 'Леон', personality: 'Любит дождь' } })
})
