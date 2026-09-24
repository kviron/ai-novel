import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { api, type Character, type StoryDetail } from '@/shared/api'
import { routes } from '@/shared/config'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { CharacterArtwork } from './CharacterArtwork'

type Profile = { story: StoryDetail; character: Character }

function appearanceDetails(value: string): { label: string; value: string }[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const fields = parsed as Record<string, unknown>
      const labels: Record<string, string> = { style: 'Стиль', hair: 'Волосы', eyes: 'Глаза', features: 'Особенности', outfit: 'Одежда', accessory: 'Аксессуар' }
      return Object.entries(labels).flatMap(([key, label]) => {
        const raw = fields[key]
        const values = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : typeof raw === 'string' ? [raw] : []
        return values.map((value) => ({ label, value }))
      })
    }
  } catch { /* Older stories store a plain-text appearance. */ }
  return value ? [{ label: 'Внешность', value }] : []
}

export function CharacterDetailPage() {
  const { storyId, characterId } = useParams()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')

  useEffect(() => {
    if (!storyId || !characterId) { setStatus('missing'); return }
    const controller = new AbortController()
    void api.getStory(storyId, controller.signal).then((story) => {
      if (controller.signal.aborted) return
      const character = story.characters.find((item) => item.id === characterId)
      if (character) { setProfile({ story, character }); setStatus('ready') }
      else setStatus('missing')
    }).catch(() => { if (!controller.signal.aborted) setStatus('error') })
    return () => controller.abort()
  }, [storyId, characterId])

  return <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-8 pt-16 sm:px-6">
    <Link to={routes.characters} className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Все персонажи</Link>
    {status === 'loading' && <p role="status" className="text-muted-foreground">Загружаем персонажа…</p>}
    {status === 'missing' && <p>Персонаж не найден.</p>}
    {status === 'error' && <p role="alert">Не удалось загрузить персонажа.</p>}
    {status === 'ready' && profile && <div className="grid gap-6 md:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.2fr)]">
      <CharacterArtwork characterId={profile.character.id} name={profile.character.name} storySlug={profile.story.slug} coverImageUrl={profile.story.cover_image_url} className="h-[360px] rounded-xl ring-1 ring-border sm:h-[480px] md:h-[min(70vh,650px)]" />
      <div className="flex flex-col gap-5">
        <header className="space-y-2"><p className="text-sm text-muted-foreground">{profile.story.title}</p><h1 className="text-3xl font-semibold tracking-tight">{profile.character.name}</h1><Badge variant="secondary">{profile.character.age} лет</Badge></header>
        <Card><CardHeader><CardTitle>Характер</CardTitle></CardHeader><CardContent className="text-sm leading-relaxed">{profile.character.personality}</CardContent></Card>
        {appearanceDetails(profile.character.appearance).length > 0 && <Card><CardHeader><CardTitle>Внешность</CardTitle></CardHeader><CardContent><dl className="grid gap-4 text-sm">{appearanceDetails(profile.character.appearance).map(({ label, value }, index) => <div key={`${label}:${index}`}><dt className="mb-1 text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}</dl></CardContent></Card>}
      </div>
    </div>}
  </main>
}
