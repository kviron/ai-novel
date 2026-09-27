import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { apiServer } from '@/test/api-server'
import { TestRouter } from '@/test/TestRouter'
import { api } from '@/shared/api'
import { StoryEditorRoute } from './StoryEditorRoute'

afterEach(() => apiServer.reset())

test('creates exactly one draft through a StrictMode remount and replaces the temporary URL', async () => {
  const router = createMemoryRouter([
    { path: '/studio/stories/new', element: <StoryEditorRoute /> },
    { path: '/studio/stories/:storyId/edit', element: <StoryEditorRoute /> },
  ], { initialEntries: ['/studio/stories/new'] })
  render(<StrictMode><RouterProvider router={router} /></StrictMode>)

  await waitFor(() => expect(router.state.location.pathname).toBe('/studio/stories/story-1/edit'))
  expect(screen.getByRole('heading', { name: 'Новая новелла' })).toBeInTheDocument()
  expect(apiServer.authoringRequests()).toEqual([{ method: 'POST', path: '/api/author/stories', body: undefined }])
})

test('a later deliberate visit to the new route creates a fresh draft', async () => {
  const router = createMemoryRouter([
    { path: '/studio/stories/new', element: <StoryEditorRoute /> },
    { path: '/studio/stories/:storyId/edit', element: <StoryEditorRoute /> },
  ], { initialEntries: ['/studio/stories/new'] })
  render(<StrictMode><RouterProvider router={router} /></StrictMode>)
  await waitFor(() => expect(router.state.location.pathname).toBe('/studio/stories/story-1/edit'))

  await router.navigate('/studio/stories/new')

  await waitFor(() => expect(router.state.location.pathname).toBe('/studio/stories/story-2/edit'))
  expect(apiServer.authoringRequests().filter(({ method, path }) => method === 'POST' && path === '/api/author/stories')).toHaveLength(2)
})

test('independent simultaneous new routes create independent drafts', async () => {
  const routeConfig = [
    { path: '/studio/stories/new', element: <StoryEditorRoute /> },
    { path: '/studio/stories/:storyId/edit', element: <StoryEditorRoute /> },
  ]
  const firstRouter = createMemoryRouter(routeConfig, { initialEntries: ['/studio/stories/new'] })
  const secondRouter = createMemoryRouter(routeConfig, { initialEntries: ['/studio/stories/new'] })

  render(<div data-testid="first-editor"><RouterProvider router={firstRouter} /></div>)
  render(<div data-testid="second-editor"><RouterProvider router={secondRouter} /></div>)

  await waitFor(() => expect(firstRouter.state.location.pathname).toBe('/studio/stories/story-1/edit'))
  await waitFor(() => expect(secondRouter.state.location.pathname).toBe('/studio/stories/story-2/edit'))
  expect(apiServer.authoringRequests().filter(({ method, path }) => method === 'POST' && path === '/api/author/stories')).toHaveLength(2)
})

test('a rejected draft creation can be deliberately retried with a fresh request', async () => {
  apiServer.failDraftCreationOnce()
  const router = createMemoryRouter([
    { path: '/studio/stories/new', element: <StoryEditorRoute /> },
    { path: '/studio/stories/:storyId/edit', element: <StoryEditorRoute /> },
  ], { initialEntries: ['/studio/stories/new'] })
  render(<RouterProvider router={router} />)

  const alert = await screen.findByRole('alert')
  fireEvent.click(within(alert.parentElement!).getByRole('button', { name: 'Повторить' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/studio/stories/story-1/edit'))
  expect(apiServer.authoringRequests().filter(({ method, path }) => method === 'POST' && path === '/api/author/stories')).toHaveLength(2)
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

test('mock publication removes the active draft and exposes only the immutable published version', async () => {
  apiServer.storyDraft({ story_id: 'story-1', version_id: 'version-1', draft_revision: 6 })

  const published = await api.publishStoryDraft('story-1')

  expect(published).toMatchObject({ status: 'published', version_id: 'version-1' })
  await expect(api.getStoryDraft('story-1')).rejects.toMatchObject({ status: 404, code: 'story_not_found' })
  await expect(api.saveStoryDraftSection('story-1', 'mode', { mode: 'hybrid' }, 6)).rejects.toMatchObject({ status: 404 })
  const version = await fetch('/api/stories/story-1/versions/version-1')
  expect(version.status).toBe(200)
  expect(await version.json()).toMatchObject({ status: 'published' })
})

test('mock clone requires a published version and rejects a second active draft', async () => {
  apiServer.storyDraft({ story_id: 'story-1', version_id: 'version-1', draft_revision: 4 })

  await expect(api.createDraftFromVersion('story-1', 'missing')).rejects.toMatchObject({
    status: 404, code: 'version_not_found',
  })
  await api.publishStoryDraft('story-1')
  apiServer.storyDraft({ story_id: 'story-1', version_id: 'version-2', version_number: 2, draft_revision: 4 })
  await expect(api.createDraftFromVersion('story-1', 'version-1')).rejects.toMatchObject({
    status: 409, code: 'draft_conflict', latestRevision: 4,
  })
})

test('mock clone creates the next mutable version from a published version', async () => {
  apiServer.storyDraft({ story_id: 'story-1', version_id: 'version-1', version_number: 1, draft_revision: 3 })
  await api.publishStoryDraft('story-1')

  const clone = await api.createDraftFromVersion('story-1', 'version-1')

  expect(clone).toMatchObject({
    story_id: 'story-1', version_number: 2, status: 'draft', draft_revision: 1,
    based_on_version_id: 'version-1', published_at: null,
  })
  expect(clone.version_id).not.toBe('version-1')
  await expect(api.getStoryDraft('story-1')).resolves.toMatchObject({ version_id: clone.version_id })
})

test('mock draft test session is immediately readable through the session endpoint', async () => {
  apiServer.storyDraft({ story_id: 'story-1' })
  apiServer.startSession({ id: 'author-session-1', state_version: 1, current_scene: 'Начало' })

  await api.startDraftTest('story-1')

  await expect(api.getSession('author-session-1')).resolves.toMatchObject({ id: 'author-session-1', state_version: 1 })
})

test('mock cover upload captures the real blob metadata and provenance', async () => {
  apiServer.storyDraft({ story_id: 'story-1' })
  const file = new File(['png bytes'], 'cover.png', { type: 'image/png' })

  await api.uploadStoryCover('story-1', file, { creator: 'Рома', license: 'CC BY', source: 'original' })

  expect(apiServer.lastCoverUploadRequest()).toEqual({
    storyId: 'story-1', mimeType: 'image/png', size: 9, filename: 'cover.png',
    creator: 'Рома', license: 'CC BY', source: 'original',
  })
})
