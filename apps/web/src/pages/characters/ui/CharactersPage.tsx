import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, type Character } from '@/shared/api'
import { routes } from '@/shared/config'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group'
import { CharacterArtwork } from './CharacterArtwork'

type ListedCharacter = { character: Character; storyId: string; storyTitle: string; storySlug: string; coverImageUrl: string | null }
type LoadState = { characters: ListedCharacter[]; loading: boolean; error: string | null; partial: boolean }
type GenderFilter = 'all' | 'female' | 'male'

export function CharactersPage() {
  const [attempt, setAttempt] = useState(0)
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all')
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
          characters: successful.flatMap((story) => story.characters.map((character) => ({ character, storyId: story.id, storyTitle: story.title, storySlug: story.slug, coverImageUrl: story.cover_image_url }))),
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

  const visibleCharacters = state.characters.filter(({ character }) => genderFilter === 'all' || character.gender === genderFilter)

  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pb-6 pt-16">
    <header><p className="text-sm text-muted-foreground">Все истории</p><h1 className="text-2xl font-semibold tracking-tight">Персонажи</h1></header>
    <ToggleGroup type="single" variant="outline" size="sm" value={genderFilter} onValueChange={(value) => { if (value) setGenderFilter(value as GenderFilter) }} aria-label="Фильтр по полу">
      <ToggleGroupItem value="all">Все</ToggleGroupItem>
      <ToggleGroupItem value="female">Женщины</ToggleGroupItem>
      <ToggleGroupItem value="male">Мужчины</ToggleGroupItem>
    </ToggleGroup>
    {state.loading && <p role="status" className="text-muted-foreground">Загружаем персонажей…</p>}
    {(state.error || state.partial) && <Alert variant={state.error ? 'destructive' : 'default'}><AlertDescription>
      {state.error ?? 'Не все истории удалось загрузить.'} <Button size="sm" variant="outline" onClick={retry}>Повторить</Button>
    </AlertDescription></Alert>}
    {!state.loading && !state.error && state.characters.length === 0 && <p className="text-muted-foreground">Персонажей пока нет.</p>}
    {!state.loading && !state.error && state.characters.length > 0 && visibleCharacters.length === 0 && <p className="text-muted-foreground">Нет персонажей с выбранным фильтром.</p>}
    <section aria-label="Каталог персонажей" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {visibleCharacters.map(({ character, storyId, storyTitle, storySlug, coverImageUrl }) => <Link key={`${storyId}:${character.id}`} to={routes.characterDetail(storyId, character.id)} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Card className="relative h-full gap-0 p-0 transition-colors hover:ring-primary/50">
          <CardContent className="p-0"><CharacterArtwork characterId={character.id} name={character.name} storySlug={storySlug} coverImageUrl={coverImageUrl} className="aspect-[3/4] w-full rounded-lg" /></CardContent>
          <CardHeader className="absolute inset-x-0 bottom-0 z-10 rounded-b-lg bg-gradient-to-t from-black/90 via-black/65 to-transparent pt-12 pb-3 text-white"><CardTitle role="heading" aria-level={2} className="text-sm sm:text-base">{character.name}</CardTitle><CardDescription className="text-white/75">{storyTitle}</CardDescription></CardHeader>
        </Card>
      </Link>)}
    </section>
  </div>
}
