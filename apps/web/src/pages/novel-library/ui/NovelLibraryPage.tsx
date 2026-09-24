import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, type SessionSummary, type StorySummary } from '@/shared/api'
import { routes } from '@/shared/config'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'

function Cover({ story }: { story: StorySummary }) {
  const [failed, setFailed] = useState(false)
  return story.cover_image_url && !failed ? (
    <img src={story.cover_image_url} alt={`Обложка новеллы «${story.title}»`} className="aspect-[3/4] w-full shrink-0 object-cover sm:w-40" onError={() => setFailed(true)} />
  ) : (
    <div aria-label={`Обложка новеллы «${story.title}»`} role="img" className="flex aspect-[3/4] w-full shrink-0 items-center justify-center bg-muted px-4 text-center text-sm text-muted-foreground sm:w-40">{story.title}</div>
  )
}

function StoryCard({ story, pending, onStart }: { story: StorySummary; pending: boolean; onStart: () => void }) {
  return <Card className="gap-0 p-0 sm:flex-row">
    <Cover story={story} />
    <div className="flex min-w-0 flex-1 flex-col gap-3 py-4">
      <CardHeader><CardTitle><h2>{story.title}</h2></CardTitle><CardDescription>{story.description || story.premise}</CardDescription></CardHeader>
      <CardFooter className="mt-auto"><Button disabled={pending} onClick={onStart}>{pending ? 'Начинаем…' : 'Начать новую игру'}</Button></CardFooter>
    </div>
  </Card>
}

function SaveCard({ save, onContinue }: { save: SessionSummary; onContinue: () => void }) {
  const updated = new Date(save.updated_at)
  return <Card data-session-id={save.id} className="gap-0 p-0 sm:flex-row">
    <Cover story={save.story} />
    <div className="flex min-w-0 flex-1 flex-col gap-3 py-4">
      <CardHeader><CardTitle><h2>{save.story.title}</h2></CardTitle><CardDescription>Сцена: {save.current_scene}</CardDescription></CardHeader>
      <CardContent className="text-muted-foreground">Обновлено: {Number.isNaN(updated.getTime()) ? save.updated_at : updated.toLocaleString('ru-RU')}</CardContent>
      <CardFooter className="mt-auto"><Button onClick={onContinue}>Продолжить</Button></CardFooter>
    </div>
  </Card>
}

export function NovelLibraryPage() {
  const navigate = useNavigate()
  const [stories, setStories] = useState<StorySummary[]>([])
  const [saves, setSaves] = useState<SessionSummary[]>([])
  const [storiesLoading, setStoriesLoading] = useState(true)
  const [savesLoading, setSavesLoading] = useState(true)
  const [storiesError, setStoriesError] = useState(false)
  const [savesError, setSavesError] = useState(false)
  const [startError, setStartError] = useState(false)
  const [startingId, setStartingId] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void api.listStories(controller.signal)
      .then(setStories)
      .catch(() => { if (!controller.signal.aborted) setStoriesError(true) })
      .finally(() => { if (!controller.signal.aborted) setStoriesLoading(false) })
    void api.listSessions('player', controller.signal)
      .then(setSaves)
      .catch(() => { if (!controller.signal.aborted) setSavesError(true) })
      .finally(() => { if (!controller.signal.aborted) setSavesLoading(false) })
    return () => controller.abort()
  }, [retryCount])

  function retryLoading() {
    setStoriesLoading(true)
    setSavesLoading(true)
    setStoriesError(false)
    setSavesError(false)
    setRetryCount((value) => value + 1)
  }

  async function startStory(story: StorySummary) {
    setStartingId(story.id)
    setStartError(false)
    try {
      const session = await api.startSession(story.id, { provider_id: story.recommended_provider_id, kind: 'player' })
      navigate(routes.storyPlayer(session.id))
    } catch {
      setStartError(true)
      setStartingId(null)
    }
  }

  return <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pb-8 pt-8 sm:px-6">
    <header className="flex flex-col gap-2"><p className="text-xs text-muted-foreground">Библиотека</p><h1 className="text-xl font-semibold tracking-tight">Визуальные новеллы</h1></header>
    {startError && <p role="alert" className="text-destructive">Не удалось начать историю. Повторите попытку.</p>}
    <Tabs defaultValue="all" className="gap-4">
      <TabsList><TabsTrigger value="all">Все новеллы</TabsTrigger><TabsTrigger value="started">Начатые{saves.length > 0 ? ` (${saves.length})` : ''}</TabsTrigger></TabsList>
      <TabsContent value="all">
        {storiesLoading ? <p role="status">Загружаем истории…</p> : storiesError ? <div className="flex flex-col items-start gap-2"><p role="alert" className="text-destructive">Не удалось загрузить библиотеку.</p><Button variant="outline" onClick={retryLoading}>Повторить</Button></div> : stories.length === 0 ? <p className="text-muted-foreground">Доступных историй пока нет.</p> : <section aria-label="Доступные истории" className="flex flex-col gap-4">{stories.map((story) => <StoryCard key={story.id} story={story} pending={startingId !== null} onStart={() => void startStory(story)} />)}</section>}
      </TabsContent>
      <TabsContent value="started">
        {savesLoading ? <p role="status">Загружаем сохранения…</p> : savesError ? <div className="flex flex-col items-start gap-2"><p role="alert" className="text-destructive">Не удалось загрузить сохранения.</p><Button variant="outline" onClick={retryLoading}>Повторить</Button></div> : saves.length === 0 ? <p className="text-muted-foreground">Вы ещё не начали ни одной новеллы.</p> : <section aria-label="Начатые истории" className="flex flex-col gap-4">{saves.map((save) => <SaveCard key={save.id} save={save} onContinue={() => navigate(routes.storyPlayer(save.id))} />)}</section>}
      </TabsContent>
    </Tabs>
  </div>
}
