import { useEffect, useState } from 'react'

import { api, type Character } from '@/shared/api'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'

type ListedCharacter = { character: Character; storyId: string; storyTitle: string }
type LoadState = { characters: ListedCharacter[]; loading: boolean; error: string | null; partial: boolean }

export function CharactersPage() {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState>({ characters: [], loading: true, error: null, partial: false })

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const stories = await api.listStories(controller.signal)
        const details = await Promise.allSettled(stories.map((story) => api.getStory(story.id, controller.signal)))
        if (controller.signal.aborted) return
        const successful = details.filter((result) => result.status === 'fulfilled').map((result) => result.value)
        if (stories.length && successful.length === 0) throw new Error('all stories failed')
        setState({
          characters: successful.flatMap((story) => story.characters.map((character) => ({ character, storyId: story.id, storyTitle: story.title }))),
          loading: false,
          error: null,
          partial: successful.length < stories.length,
        })
      } catch {
        if (!controller.signal.aborted) setState({ characters: [], loading: false, error: 'Не удалось загрузить персонажей. Повторите попытку.', partial: false })
      }
    })()
    return () => controller.abort()
  }, [attempt])

  function retry() {
    setState({ characters: [], loading: true, error: null, partial: false })
    setAttempt((value) => value + 1)
  }

  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pb-6 pt-16">
    <header><p className="text-sm text-muted-foreground">Все истории</p><h1 className="text-2xl font-semibold tracking-tight">Персонажи</h1></header>
    {state.loading && <p role="status" className="text-muted-foreground">Загружаем персонажей…</p>}
    {(state.error || state.partial) && <Alert variant={state.error ? 'destructive' : 'default'}><AlertDescription>
      {state.error ?? 'Не все истории удалось загрузить.'} <Button size="sm" variant="outline" onClick={retry}>Повторить</Button>
    </AlertDescription></Alert>}
    {!state.loading && !state.error && state.characters.length === 0 && <p className="text-muted-foreground">Персонажей пока нет.</p>}
    <section aria-label="Каталог персонажей" className="grid gap-4 md:grid-cols-2">
      {state.characters.map(({ character, storyId, storyTitle }) => <Card key={`${storyId}:${character.id}`}>
        <CardHeader><CardTitle role="heading" aria-level={2}>{character.name}</CardTitle><CardDescription>{storyTitle}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm"><p>{character.appearance}</p><p className="text-muted-foreground">{character.personality}</p></CardContent>
      </Card>)}
    </section>
  </div>
}
