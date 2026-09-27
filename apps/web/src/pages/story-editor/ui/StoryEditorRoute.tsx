import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { StoryEditorShell } from '@/features/edit-story'
import { api, ApiRequestError, type StoryDraft } from '@/shared/api'
import { routes } from '@/shared/config'

export function StoryEditorRoute() {
  const { storyId } = useParams()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<StoryDraft | null>(null)
  const [error, setError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const loadedStoryId = useRef<string | null>(null)
  const createDraftRequest = useRef<Promise<StoryDraft> | null>(null)
  const creating = !storyId

  useEffect(() => {
    if (storyId && loadedStoryId.current === storyId) return
    const controller = new AbortController()
    let active = true
    setError('')

    let load: Promise<StoryDraft>
    if (creating) {
      if (!createDraftRequest.current) {
        const request = api.createStoryDraft()
        createDraftRequest.current = request
        const clear = () => {
          if (createDraftRequest.current === request) createDraftRequest.current = null
        }
        void request.then(clear, clear)
      }
      load = createDraftRequest.current
    } else {
      load = api.getStoryDraft(storyId, controller.signal)
    }

    load.then((nextDraft) => {
      if (!active) return
      loadedStoryId.current = nextDraft.story_id
      setDraft(nextDraft)
      if (creating) {
        createDraftRequest.current = null
        navigate(routes.studioStoryEdit(nextDraft.story_id), { replace: true })
      }
    }).catch((cause: unknown) => {
      if (!active) return
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError(cause instanceof ApiRequestError ? cause.message : 'Не удалось открыть редактор новеллы.')
    })

    return () => {
      active = false
      if (!creating) controller.abort()
    }
  }, [creating, loadAttempt, navigate, storyId])

  if (error) return (
    <main>
      <h1>Редактор новеллы</h1>
      <p role="alert">{error}</p>
      <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Повторить</button>
    </main>
  )

  if (!draft) return <main><h1>{creating ? 'Новая новелла' : 'Редактор новеллы'}</h1><p role="status">Загружаем черновик…</p></main>
  return <StoryEditorShell key={draft.version_id} storyId={draft.story_id} initialDraft={draft} />
}
