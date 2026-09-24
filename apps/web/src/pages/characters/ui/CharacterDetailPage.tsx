import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { api, ApiRequestError, type CharacterHistory } from '@/shared/api'
import { routes } from '@/shared/config'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
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

  return <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-8 pt-16 sm:px-6">
    <Link to={routes.characters} className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Все персонажи</Link>
    {status === 'loading' && <p role="status" className="text-muted-foreground">Загружаем персонажа…</p>}
    {status === 'missing' && <p>Персонаж не найден.</p>}
    {status === 'error' && <p role="alert">Не удалось загрузить персонажа.</p>}
    {status === 'ready' && history && current && <div className="grid gap-6 md:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.2fr)]">
      <CharacterArtwork characterId={history.id} name={current.name} className="h-[360px] rounded-xl ring-1 ring-border sm:h-[480px] md:h-[min(70vh,650px)]" />
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-2"><p className="text-sm text-muted-foreground">Ревизия {current.revision_number} · {history.source_type === 'builtin' ? 'Встроенный персонаж' : 'Локальный персонаж'}</p><h1 className="text-3xl font-semibold tracking-tight">{current.name}</h1><Badge variant="secondary" className="w-fit">{current.age} лет</Badge><Button asChild className="w-fit" variant="outline"><Link to={routes.characterEdit(history.id)}>Создать новую ревизию</Link></Button></header>
        <Card><CardHeader><CardTitle>Характер</CardTitle></CardHeader><CardContent className="text-sm leading-relaxed">{current.personality}</CardContent></Card>
        {appearanceDetails(current.appearance).length > 0 && <Card><CardHeader><CardTitle>Внешность</CardTitle></CardHeader><CardContent><dl className="grid gap-4 text-sm">{appearanceDetails(current.appearance).map(({ label, value }, index) => <div key={`${label}:${index}`}><dt className="mb-1 text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}</dl></CardContent></Card>}
        {current.biography && <Card><CardHeader><CardTitle>История</CardTitle></CardHeader><CardContent className="text-sm leading-relaxed">{current.biography}</CardContent></Card>}
        {history.linked_stories.length > 0 && <Card><CardHeader><CardTitle>В новеллах</CardTitle></CardHeader><CardContent><ul className="flex flex-col gap-2 text-sm">{history.linked_stories.map((link) => <li key={link.story_id}>{link.story_title}<span className="text-muted-foreground"> · ревизия {link.revision_number}</span></li>)}</ul></CardContent></Card>}
      </div>
    </div>}
  </main>
}
