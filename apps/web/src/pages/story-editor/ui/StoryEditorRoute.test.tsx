import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { apiServer } from '@/test/api-server'
import { TestRouter } from '@/test/TestRouter'
import { StoryEditorRoute } from './StoryEditorRoute'

afterEach(() => apiServer.reset())

test('creates a new draft and replaces the temporary URL with its stable editor URL', async () => {
  const router = createMemoryRouter([
    { path: '/studio/stories/new', element: <StoryEditorRoute /> },
    { path: '/studio/stories/:storyId/edit', element: <StoryEditorRoute /> },
  ], { initialEntries: ['/studio/stories/new'] })
  render(<RouterProvider router={router} />)

  await waitFor(() => expect(router.state.location.pathname).toBe('/studio/stories/story-1/edit'))
  expect(screen.getByRole('heading', { name: 'Новая новелла' })).toBeInTheDocument()
  expect(apiServer.authoringRequests()).toEqual([{ method: 'POST', path: '/api/author/stories', body: undefined }])
})

test('loads an existing draft by the encoded route id', async () => {
  apiServer.storyDraft({ story_id: 'story/1', identity: { title: 'Эхо неона' } })

  render(<TestRouter initialEntries={['/studio/stories/story%2F1/edit']} />)

  expect(await screen.findByRole('heading', { name: 'Эхо неона' })).toBeInTheDocument()
  expect(apiServer.authoringRequests()).toEqual([{ method: 'GET', path: '/api/author/stories/story%2F1/draft', body: undefined }])
})

test('mock authoring server increments revisions and rejects stale saves without overwriting data', async () => {
  apiServer.storyDraft({ story_id: 'story-1', draft_revision: 4, identity: { title: 'До сохранения' } })

  const first = await fetch('/api/author/stories/story-1/draft/identity', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_revision: 4, data: { title: 'После сохранения' } }),
  })
  const conflict = await fetch('/api/author/stories/story-1/draft/identity', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected_revision: 4, data: { title: 'Устаревшее значение' } }),
  })

  expect(first.status).toBe(200)
  expect(await first.json()).toMatchObject({ draft_revision: 5, identity: { title: 'После сохранения' } })
  expect(conflict.status).toBe(409)
  expect(await conflict.json()).toEqual({
    code: 'draft_conflict', detail: 'Черновик был изменён. Обновите его и повторите сохранение.',
    retryable: false, latest_revision: 5,
  })
  expect(apiServer.lastAuthoringSectionRequest()).toEqual({
    storyId: 'story-1', section: 'identity', expected_revision: 4, data: { title: 'Устаревшее значение' },
  })
})
