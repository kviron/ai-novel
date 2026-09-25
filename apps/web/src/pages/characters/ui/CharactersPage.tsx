import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, ApiRequestError, type CatalogCharacter } from '@/shared/api'
import { routes } from '@/shared/config'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group'
import { Input } from '@/shared/ui/input'
import { CharacterArtwork } from './CharacterArtwork'

type LoadState = { characters: CatalogCharacter[]; loading: boolean; error: string | null }
type GenderFilter = 'all' | 'female' | 'male'

export function CharactersPage() {
  const [attempt, setAttempt] = useState(0)
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('all')
  const [state, setState] = useState<LoadState>({ characters: [], loading: true, error: null })
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void api.listCharacters(controller.signal).then((characters) => {
      if (!controller.signal.aborted) setState({ characters, loading: false, error: null })
    }).catch(() => {
      if (!controller.signal.aborted) setState({ characters: [], loading: false, error: 'Не удалось загрузить персонажей. Повторите попытку.' })
    })
    return () => controller.abort()
  }, [attempt])

  function retry() {
    setState({ characters: [], loading: true, error: null })
    setAttempt((value) => value + 1)
  }

  const visibleCharacters = state.characters.filter((character) => genderFilter === 'all' || character.gender === genderFilter)

  async function importArchive(file: File | null) {
    if (!file) return
    setImporting(true)
    setImportError(null)
    try {
      await api.importCharacter(file)
      retry()
    } catch (error) {
      setImportError(error instanceof ApiRequestError ? error.message : 'Не удалось импортировать архив.')
    } finally {
      setImporting(false)
    }
  }

  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pb-6 pt-16">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm text-muted-foreground">Глобальный каталог</p><h1 className="text-2xl font-semibold tracking-tight">Персонажи</h1></div><div className="flex flex-wrap items-center gap-2"><Input aria-label="Импортировать ZIP персонажа" type="file" accept=".zip,application/zip" disabled={importing} className="w-48" onChange={(event) => { void importArchive(event.target.files?.[0] ?? null); event.target.value = '' }} /><Button asChild><Link to={routes.characterNew}>Создать персонажа</Link></Button></div></header>
    {importError && <Alert variant="destructive"><AlertDescription>{importError}</AlertDescription></Alert>}
    <ToggleGroup type="single" variant="outline" size="sm" value={genderFilter} onValueChange={(value) => { if (value) setGenderFilter(value as GenderFilter) }} aria-label="Фильтр по полу">
      <ToggleGroupItem value="all">Все</ToggleGroupItem>
      <ToggleGroupItem value="female">Женщины</ToggleGroupItem>
      <ToggleGroupItem value="male">Мужчины</ToggleGroupItem>
    </ToggleGroup>
    {state.loading && <p role="status" className="text-muted-foreground">Загружаем персонажей…</p>}
    {state.error && <Alert variant="destructive"><AlertDescription>{state.error} <Button size="sm" variant="outline" onClick={retry}>Повторить</Button></AlertDescription></Alert>}
    {!state.loading && !state.error && state.characters.length === 0 && <p className="text-muted-foreground">Персонажей пока нет.</p>}
    {!state.loading && !state.error && state.characters.length > 0 && visibleCharacters.length === 0 && <p className="text-muted-foreground">Нет персонажей с выбранным фильтром.</p>}
    <section aria-label="Каталог персонажей" className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {visibleCharacters.map((character) => <Link key={character.id} to={routes.characterDetail(character.id)} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Card className="relative h-full gap-0 p-0 transition-colors hover:ring-primary/50">
          <CardContent className="p-0"><CharacterArtwork characterId={character.id} name={character.name} avatarUrl={character.avatar?.url} className="aspect-[3/4] w-full rounded-lg" /></CardContent>
          <CardHeader className="absolute inset-x-0 bottom-0 z-10 rounded-b-lg bg-gradient-to-t from-black/90 via-black/65 to-transparent pt-12 pb-3 text-white"><CardTitle role="heading" aria-level={2} className="text-sm sm:text-base">{character.name}</CardTitle><CardDescription className="text-white/75">Ревизия {character.revision_number}</CardDescription></CardHeader>
        </Card>
      </Link>)}
    </section>
  </div>
}
