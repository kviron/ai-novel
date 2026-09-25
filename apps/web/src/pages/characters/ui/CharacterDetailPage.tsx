import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { api, ApiRequestError, type CharacterHistory } from '@/shared/api'
import { routes } from '@/shared/config'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Field, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group'
import { CharacterArtwork } from './CharacterArtwork'

function appearanceDetails(value: string): { label: string; value: string }[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const fields = parsed as Record<string, unknown>
      const labels: Record<string, string> = { style: 'Стиль', hair: 'Волосы', eyes: 'Глаза', features: 'Особенности', outfit: 'Одежда', accessory: 'Аксессуар' }
      const known = Object.entries(labels).flatMap(([key, label]) => {
        const raw = fields[key]
        const values = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : typeof raw === 'string' ? [raw] : []
        return values.map((value) => ({ label, value }))
      })
      if (known.length > 0) return known
      const unknown = Object.entries(fields).map(([label, raw]) => ({ label, value: typeof raw === 'string' ? raw : JSON.stringify(raw) }))
      return unknown.length > 0 ? unknown : [{ label: 'Внешность', value }]
    }
  } catch { /* Older profiles store a plain-text appearance. */ }
  return value ? [{ label: 'Внешность', value }] : []
}

export function CharacterDetailPage() {
  const { characterId } = useParams()
  const [history, setHistory] = useState<CharacterHistory | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [file, setFile] = useState<File | null>(null)
  const [materialKind, setMaterialKind] = useState<'avatar' | 'cover'>('avatar')
  const [creator, setCreator] = useState('')
  const [license, setLicense] = useState('')
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [materialError, setMaterialError] = useState<string | null>(null)

  useEffect(() => {
    if (!characterId) { setStatus('missing'); return }
    const controller = new AbortController()
    void api.getCharacter(characterId, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setHistory(result)
      setStatus('ready')
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setStatus(error instanceof ApiRequestError && error.status === 404 ? 'missing' : 'error')
    })
    return () => controller.abort()
  }, [characterId])

  const current = history?.revisions.find((revision) => revision.id === history.current_revision_id)

  async function uploadAvatar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!characterId || !file) return
    setBusy(true)
    setMaterialError(null)
    try {
      await api.uploadCharacterMaterial(characterId, materialKind, file, { creator, license, source })
      setHistory(await api.getCharacter(characterId))
      setFile(null)
    } catch (error) {
      setMaterialError(error instanceof ApiRequestError ? error.message : 'Не удалось загрузить изображение.')
    } finally {
      setBusy(false)
    }
  }

  async function downloadArchive() {
    if (!characterId) return
    setBusy(true)
    setMaterialError(null)
    try {
      const blob = await api.exportCharacter(characterId)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `character-${characterId}.zip`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) {
      setMaterialError(error instanceof ApiRequestError ? error.message : 'Не удалось экспортировать персонажа.')
    } finally {
      setBusy(false)
    }
  }

  return <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-8 pt-16 sm:px-6">
    <Link to={routes.characters} className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Все персонажи</Link>
    {status === 'loading' && <p role="status" className="text-muted-foreground">Загружаем персонажа…</p>}
    {status === 'missing' && <p>Персонаж не найден.</p>}
    {status === 'error' && <p role="alert">Не удалось загрузить персонажа.</p>}
    {status === 'ready' && history && current && <div className="grid gap-6 md:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.2fr)]">
      <CharacterArtwork characterId={history.id} name={current.name} avatarUrl={current.avatar?.url} className="h-[360px] rounded-xl ring-1 ring-border sm:h-[480px] md:h-[min(70vh,650px)]" />
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-2"><p className="text-sm text-muted-foreground">Ревизия {current.revision_number} · {history.source_type === 'builtin' ? 'Встроенный персонаж' : history.source_type === 'imported' ? 'Импортированный персонаж' : 'Локальный персонаж'}</p><h1 className="text-3xl font-semibold tracking-tight">{current.name}</h1><Badge variant="secondary" className="w-fit">{current.age} лет</Badge><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to={routes.characterEdit(history.id)}>Создать новую ревизию</Link></Button><Button type="button" variant="outline" disabled={busy} onClick={() => void downloadArchive()}>Экспортировать ZIP</Button></div></header>
        {materialError && <Alert variant="destructive"><AlertDescription>{materialError}</AlertDescription></Alert>}
        {current.cover && <Card><CardHeader><CardTitle>Обложка</CardTitle></CardHeader><CardContent className="flex flex-col gap-2"><img src={current.cover.url} alt={`Обложка ${current.name}`} className="max-h-48 w-full rounded-md object-cover" /><p className="text-sm text-muted-foreground">{current.cover.creator} · {current.cover.license}</p><p className="text-xs text-muted-foreground">{current.cover.source}</p></CardContent></Card>}
        <Card><CardHeader><CardTitle>Аватар</CardTitle></CardHeader><CardContent className="flex flex-col gap-4">
          {current.avatar && <dl className="text-sm text-muted-foreground"><dt>Автор и лицензия</dt><dd>{current.avatar.creator} · {current.avatar.license}</dd><dt>Источник</dt><dd>{current.avatar.source}</dd></dl>}
          <form className="flex flex-col gap-3" onSubmit={(event) => void uploadAvatar(event)}><FieldGroup>
            <Field><FieldLabel>Вид материала</FieldLabel><ToggleGroup type="single" value={materialKind} onValueChange={(value) => { if (value === 'avatar' || value === 'cover') setMaterialKind(value) }} variant="outline" aria-label="Вид материала"><ToggleGroupItem value="avatar">Аватар</ToggleGroupItem><ToggleGroupItem value="cover">Обложка</ToggleGroupItem></ToggleGroup></Field>
            <Field><FieldLabel htmlFor="avatar-file">Изображение PNG, JPEG или WebP</FieldLabel><Input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Field>
            <Field><FieldLabel htmlFor="avatar-creator">Автор изображения</FieldLabel><Input id="avatar-creator" required value={creator} onChange={(event) => setCreator(event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="avatar-license">Лицензия или разрешение</FieldLabel><Input id="avatar-license" required value={license} onChange={(event) => setLicense(event.target.value)} placeholder="Например, собственная работа" /></Field>
            <Field><FieldLabel htmlFor="avatar-source">Источник</FieldLabel><Input id="avatar-source" required value={source} onChange={(event) => setSource(event.target.value)} placeholder="Откуда получено изображение" /></Field>
          </FieldGroup><Button type="submit" disabled={busy || !file}>Сохранить {materialKind === 'avatar' ? 'аватар' : 'обложку'} новой ревизией</Button></form>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Характер</CardTitle></CardHeader><CardContent className="text-sm leading-relaxed">{current.personality}</CardContent></Card>
        {appearanceDetails(current.appearance).length > 0 && <Card><CardHeader><CardTitle>Внешность</CardTitle></CardHeader><CardContent><dl className="grid gap-4 text-sm">{appearanceDetails(current.appearance).map(({ label, value }, index) => <div key={`${label}:${index}`}><dt className="mb-1 text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}</dl></CardContent></Card>}
        {current.biography && <Card><CardHeader><CardTitle>История</CardTitle></CardHeader><CardContent className="text-sm leading-relaxed">{current.biography}</CardContent></Card>}
        {history.linked_stories.length > 0 && <Card><CardHeader><CardTitle>В новеллах</CardTitle></CardHeader><CardContent><ul className="flex flex-col gap-2 text-sm">{history.linked_stories.map((link) => <li key={link.story_id}>{link.story_title}<span className="text-muted-foreground"> · ревизия {link.revision_number}</span></li>)}</ul></CardContent></Card>}
      </div>
    </div>}
  </main>
}
