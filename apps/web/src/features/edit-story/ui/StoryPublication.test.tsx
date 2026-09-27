import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import type { DraftDiagnostic } from '@/shared/api'
import { apiServer } from '@/test/api-server'
import { TestRouter, type TestRouterInstance } from '@/test/TestRouter'

afterEach(() => { cleanup(); apiServer.reset() })

const diagnostic = (value: Partial<DraftDiagnostic>): DraftDiagnostic => ({
  code: 'invalid', severity: 'error', step: 'identity', field: 'identity.premise', item_id: null,
  message: 'Добавьте завязку', ...value,
})

test('groups diagnostics and focuses the exact field or stable item', async () => {
  apiServer.storyDraft({ story_id: 'story-1', mode: { mode: 'hybrid' }, canon: { creative_goals: '', facts: [{ id: 'fact-7', order_index: 0, title: '', statement: '', severity: 'hard', scope: 'world', referenced_character_ids: [] }], beats: [] } })
  apiServer.draftDiagnostics([
    diagnostic({ step: 'identity', field: 'identity.premise' }),
    diagnostic({ step: 'canon', field: 'canon.facts.statement', item_id: 'fact-7', message: 'Опишите факт' }),
  ])
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Проверка' }))
  await userEvent.click(screen.getByRole('button', { name: 'Проверить черновик' }))
  expect(await screen.findByRole('heading', { name: 'Основа' })).toBeInTheDocument()
  expect(screen.getAllByRole('heading', { name: 'Канон' })).toHaveLength(2)

  await userEvent.click(screen.getByRole('button', { name: /Добавьте завязку/ }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Завязка' })).toHaveFocus())
  await userEvent.click(screen.getByRole('button', { name: 'Проверка' }))
  await userEvent.click(screen.getByRole('button', { name: /Опишите факт/ }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Описание факта 1' })).toHaveFocus())
})

test('errors block publication, warnings do not, and validation always precedes test and publish', async () => {
  apiServer.storyDraft({ story_id: 'story-1' })
  apiServer.draftDiagnostics([diagnostic({ severity: 'error' })])
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Проверка' }))
  await userEvent.click(screen.getByRole('button', { name: 'Проверить черновик' }))
  expect(await screen.findByRole('button', { name: 'Опубликовать' })).toBeDisabled()

  apiServer.draftDiagnostics([diagnostic({ severity: 'warning', message: 'Можно уточнить завязку' })])
  await userEvent.click(screen.getByRole('button', { name: 'Проверить черновик' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Опубликовать' }))
  await screen.findByRole('button', { name: 'Создать новую редакцию' })
  const requests = apiServer.authoringRequests().filter(({ method }) => method === 'POST')
  expect(requests.slice(-2).map(({ path }) => path)).toEqual(['/api/author/stories/story-1/validate', '/api/author/stories/story-1/publish'])
})

test('successful draft test navigates to studio session, while unavailable Ollama blocks testing only', async () => {
  apiServer.storyDraft({ story_id: 'story-1' })
  apiServer.startSession({ id: 'author-test-9', state_version: 1 })
  let router: TestRouterInstance | undefined
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} onRouter={(value) => { router = value }} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Проверка' }))
  await userEvent.click(screen.getByRole('button', { name: 'Запустить тест' }))
  await waitFor(() => expect(router!.state.location.pathname).toBe('/studio/author-test-9'))
  expect(apiServer.authoringRequests().filter(({ method }) => method === 'POST').slice(-2).map(({ path }) => path)).toEqual(['/api/author/stories/story-1/validate', '/api/author/stories/story-1/test-sessions'])

  cleanup(); apiServer.reset(); apiServer.storyDraft({ story_id: 'story-2' }); apiServer.failDraftTestOnce()
  render(<TestRouter initialEntries={['/studio/stories/story-2/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Проверка' }))
  await userEvent.click(screen.getByRole('button', { name: 'Запустить тест' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Ollama недоступна')
  expect(screen.getByRole('button', { name: 'Опубликовать' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: 'Основа' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Название' }), 'Локальная правка')
  expect(screen.getByRole('button', { name: 'Сохранить раздел' })).toBeEnabled()
})

test('published story exposes new revision action and clone conflict keeps local published state', async () => {
  apiServer.storyDraft({ story_id: 'story-1', identity: { title: 'Опубликованная история' } })
  render(<TestRouter initialEntries={['/studio/stories/story-1/edit']} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Проверка' }))
  await userEvent.click(screen.getByRole('button', { name: 'Проверить черновик' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Опубликовать' }))
  expect(await screen.findByRole('button', { name: 'Создать новую редакцию' })).toBeInTheDocument()
  const revision = screen.getByRole('button', { name: 'Создать новую редакцию' })

  apiServer.storyDraft({ story_id: 'story-1', identity: { title: 'Чужой черновик' } })
  await userEvent.click(revision)
  await waitFor(() => expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('Черновик был изменён'))).toBe(true))
  expect(screen.getByRole('heading', { level: 1, name: 'Опубликованная история' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Создать новую редакцию' })).toBeInTheDocument()
})
