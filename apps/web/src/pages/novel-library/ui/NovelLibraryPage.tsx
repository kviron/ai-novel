import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, type StorySummary } from '@/shared/api'
import { routes } from '@/shared/config'
import { Button } from '@/shared/ui/button'

export function NovelLibraryPage() {
  const navigate = useNavigate()
  const [stories, setStories] = useState<StorySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void api.listStories(controller.signal)
      .then(setStories)
      .catch(() => {
        if (!controller.signal.aborted) setError('Не удалось загрузить библиотеку. Повторите попытку.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  async function startStory(story: StorySummary) {
    setStartingId(story.id)
    setError(null)
    try {
      const session = await api.startSession(story.id, {
        provider_id: story.recommended_provider_id,
      })
      navigate(routes.storyPlayer(session.id))
    } catch {
      setError('Не удалось начать историю. Повторите попытку.')
      setStartingId(null)
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 pb-6 pt-16">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Локальная визуальная новелла</p>
        <h1 className="text-2xl font-semibold tracking-tight">Библиотека историй</h1>
      </header>
      {loading && <p role="status" className="text-muted-foreground">Загружаем истории…</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {!loading && !error && stories.length === 0 && <p className="text-muted-foreground">Доступных историй пока нет.</p>}
      <section aria-label="Доступные истории" className="flex flex-col gap-4">
        {stories.map((story) => (
          <article key={story.id} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-medium">{story.title}</h2>
              <p className="max-w-xl text-muted-foreground">{story.premise}</p>
            </div>
            <Button disabled={startingId !== null} onClick={() => void startStory(story)}>
              {startingId === story.id ? 'Начинаем…' : 'Начать историю'}
            </Button>
          </article>
        ))}
      </section>
    </div>
  )
}
