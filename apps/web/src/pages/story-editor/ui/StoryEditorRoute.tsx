import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { api, ApiRequestError, type StoryDraft } from '@/shared/api'
import { routes } from '@/shared/config'

export function StoryEditorRoute() {
  const { storyId } = useParams()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<StoryDraft | null>(null)
  const [error, setError] = useState('')
  const creating = !storyId

  useEffect(() => {
    if (draft && (creating || draft.story_id === storyId)) return
    const controller = new AbortController()
    setError('')

    const load = creating
      ? api.createStoryDraft(undefined, controller.signal)
      : api.getStoryDraft(storyId, controller.signal)

    load.then((nextDraft) => {
      setDraft(nextDraft)
      if (creating) navigate(routes.studioStoryEdit(nextDraft.story_id), { replace: true })
    }).catch((cause: unknown) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError(cause instanceof ApiRequestError ? cause.message : 'Не удалось открыть редактор новеллы.')
    })

    return () => controller.abort()
  }, [creating, draft?.story_id, navigate, storyId])

  if (error) return <main><h1>Редактор новеллы</h1><p role="alert">{error}</p></main>

  return (
    <main>
      <h1>{draft ? draft.identity.title || 'Новая новелла' : creating ? 'Новая новелла' : 'Редактор новеллы'}</h1>
      {!draft && <p>Загружаем черновик…</p>}
    </main>
  )
}
