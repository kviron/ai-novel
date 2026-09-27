import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { api, ApiRequestError, type StoryDraft } from '@/shared/api'
import { routes } from '@/shared/config'

let createDraftInFlight: Promise<StoryDraft> | null = null

function createDraftOnce(): Promise<StoryDraft> {
  if (createDraftInFlight) return createDraftInFlight
  const request = api.createStoryDraft()
  createDraftInFlight = request
  const clear = () => {
    if (createDraftInFlight === request) createDraftInFlight = null
  }
  void request.then(clear, clear)
  return request
}

export function StoryEditorRoute() {
  const { storyId } = useParams()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<StoryDraft | null>(null)
  const [error, setError] = useState('')
  const loadedStoryId = useRef<string | null>(null)
  const creating = !storyId

  useEffect(() => {
    if (storyId && loadedStoryId.current === storyId) return
    const controller = new AbortController()
    let active = true
    setError('')

    const load = creating
      ? createDraftOnce()
      : api.getStoryDraft(storyId, controller.signal)

    load.then((nextDraft) => {
      if (!active) return
      loadedStoryId.current = nextDraft.story_id
      setDraft(nextDraft)
      if (creating) navigate(routes.studioStoryEdit(nextDraft.story_id), { replace: true })
    }).catch((cause: unknown) => {
      if (!active) return
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError(cause instanceof ApiRequestError ? cause.message : 'Не удалось открыть редактор новеллы.')
    })

    return () => {
      active = false
      if (!creating) controller.abort()
    }
  }, [creating, navigate, storyId])

  if (error) return <main><h1>Редактор новеллы</h1><p role="alert">{error}</p></main>

  return (
    <main>
      <h1>{draft ? draft.identity.title || 'Новая новелла' : creating ? 'Новая новелла' : 'Редактор новеллы'}</h1>
      {!draft && <p>Загружаем черновик…</p>}
    </main>
  )
}
