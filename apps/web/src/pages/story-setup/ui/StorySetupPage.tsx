import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { api, type CatalogCharacter, type HeroChoice, type StorySetup, type StorySummary } from '@/shared/api'
import { routes } from '@/shared/config'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'

type Draft = { name: string; address: string; gender: 'female' | 'male' | 'unspecified'; appearance: string; biography: string }
const initialDraft: Draft = { name: '', address: '', gender: 'unspecified', appearance: '', biography: '' }

export function StorySetupPage() {
  const { storyId } = useParams()
  const navigate = useNavigate()
  const [story, setStory] = useState<StorySummary | null>(null)
  const [setup, setSetup] = useState<StorySetup | null>(null)
  const [catalog, setCatalog] = useState<CatalogCharacter[]>([])
  const [source, setSource] = useState<'fixed' | 'catalog' | 'draft'>('draft')
  const [selected, setSelected] = useState<CatalogCharacter | null>(null)
  const [draft, setDraft] = useState<Draft>(initialDraft)
  const [reviewing, setReviewing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!storyId) return
    const controller = new AbortController()
    async function load() {
      try {
        const [stories, details] = await Promise.all([
          api.listStories(controller.signal), api.getStorySetup(storyId!, controller.signal),
        ])
        if (controller.signal.aborted) return
        setStory(stories.find((item) => item.id === storyId) ?? null)
        setSetup(details)
        const initialSource = details.policy === 'fixed' ? 'fixed' : details.allowed_sources.includes('draft') ? 'draft' : 'catalog'
        setSource(initialSource)
        if (details.allowed_sources.includes('catalog')) {
          const [characters, storyDetail] = await Promise.all([api.listCharacters(controller.signal), api.getStory(storyId!, controller.signal)])
          const castIds = new Set(storyDetail.characters.map((item) => item.id))
          if (!controller.signal.aborted) setCatalog(characters.filter((item) => !castIds.has(item.character_id) || details.playable_character_ids.includes(item.character_id)))
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить настройки истории.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [storyId])

  if (loading) return <div className="mx-auto max-w-3xl px-4 py-10" role="status">Загружаем настройки героя…</div>
  if (!storyId || !setup || !story) return <div className="mx-auto max-w-3xl px-4 py-10" role="alert">{error || 'История не найдена.'}</div>

  const name = source === 'fixed' ? setup.fixed_hero?.name : source === 'catalog' ? selected?.name : draft.name.trim()
  const biography = source === 'catalog' ? selected?.biography : source === 'draft' ? draft.biography.trim() : setup.fixed_hero?.biography
  const canContinue = source === 'fixed' ? Boolean(setup.fixed_hero) : source === 'catalog' ? Boolean(selected) : Boolean(draft.name.trim())

  function chooseSource(next: 'catalog' | 'draft') {
    setSource(next)
    setReviewing(false)
    setError('')
  }

  async function start() {
    if (!canContinue || submitting) return
    let hero: HeroChoice
    if (source === 'fixed') hero = { source_kind: 'fixed' }
    else if (source === 'catalog' && selected) hero = { source_kind: 'catalog', character_id: selected.character_id, revision_id: selected.current_revision_id }
    else hero = { source_kind: 'draft', name: draft.name.trim(), address: draft.address.trim() || null, gender: draft.gender, appearance: draft.appearance.trim(), biography: draft.biography.trim() }
    setSubmitting(true)
    setError('')
    try {
      const session = await api.startSession(storyId!, { provider_id: story!.recommended_provider_id, kind: 'player', hero })
      navigate(routes.storyPlayer(session.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось начать историю.')
      setSubmitting(false)
    }
  }

  return <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8 sm:px-6">
    <header className="flex flex-col gap-2">
      <Button variant="ghost" size="sm" className="w-fit px-0" onClick={() => navigate(routes.novelLibrary)}>← Библиотека</Button>
      <p className="text-xs text-muted-foreground">{story.title} · Новое прохождение</p>
      <h1 className="text-xl font-semibold tracking-tight">Ваш герой</h1>
      <p className="text-sm text-muted-foreground">Вы управляете героем. История и другие персонажи реагируют на ваши решения.</p>
    </header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Card>
      <CardHeader><CardTitle>{reviewing ? 'Проверьте героя' : 'Кем вы будете играть?'}</CardTitle><CardDescription>Выбор закрепится за этим прохождением.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!reviewing && <>
          {setup.policy === 'choice' && setup.allowed_sources.length > 1 && <div className="flex gap-2">
            {setup.allowed_sources.includes('draft') && <Button variant={source === 'draft' ? 'default' : 'outline'} onClick={() => chooseSource('draft')}>Создать героя</Button>}
            {setup.allowed_sources.includes('catalog') && <Button variant={source === 'catalog' ? 'default' : 'outline'} onClick={() => chooseSource('catalog')}>Из каталога</Button>}
          </div>}
          {source === 'draft' && <FieldGroup>
            <Field><FieldLabel htmlFor="hero-name">Имя</FieldLabel><Input id="hero-name" maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
            <Field><FieldLabel htmlFor="hero-address">Как к вам обращаться</FieldLabel><Input id="hero-address" maxLength={120} value={draft.address} placeholder="По умолчанию — имя" onChange={(event) => setDraft({ ...draft, address: event.target.value })} /><FieldDescription>Можно оставить пустым.</FieldDescription></Field>
            <Field><FieldLabel htmlFor="hero-gender">Пол и грамматическое обращение</FieldLabel><Select value={draft.gender} onValueChange={(value) => setDraft({ ...draft, gender: value as Draft['gender'] })}><SelectTrigger id="hero-gender" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unspecified">Не указывать</SelectItem><SelectItem value="female">Женский</SelectItem><SelectItem value="male">Мужской</SelectItem></SelectContent></Select></Field>
            <Field><FieldLabel htmlFor="hero-appearance">Внешность</FieldLabel><Textarea id="hero-appearance" maxLength={6000} value={draft.appearance} onChange={(event) => setDraft({ ...draft, appearance: event.target.value })} /></Field>
            <Field><FieldLabel htmlFor="hero-biography">Предыстория</FieldLabel><Textarea id="hero-biography" maxLength={6000} value={draft.biography} onChange={(event) => setDraft({ ...draft, biography: event.target.value })} /></Field>
          </FieldGroup>}
          {source === 'catalog' && <div className="flex flex-col gap-2" aria-label="Выберите персонажа">
            {catalog.length === 0 ? <p className="text-sm text-muted-foreground">Нет доступных персонажей. Создайте персонажа в каталоге.</p> : catalog.map((item) => <Button key={item.character_id} variant={selected?.character_id === item.character_id ? 'secondary' : 'outline'} className="h-auto justify-start gap-3 py-2 text-left" onClick={() => setSelected(item)}>{item.avatar?.url && <img src={item.avatar.url} alt="" className="size-9 rounded-md object-cover" />}<span>{item.name}</span></Button>)}
          </div>}
          {source === 'fixed' && <p className="text-sm">Автор закрепил героя: <strong>{setup.fixed_hero?.name}</strong></p>}
        </>}
        {reviewing && <div className="space-y-3 text-sm">
          <p><span className="text-muted-foreground">Имя: </span><strong>{name}</strong></p>
          {source === 'draft' && <><p><span className="text-muted-foreground">Обращение: </span>{draft.address.trim() || draft.name.trim()}</p>{draft.appearance.trim() && <p><span className="text-muted-foreground">Внешность: </span>{draft.appearance.trim()}</p>}</>}
          {biography && <p><span className="text-muted-foreground">Предыстория: </span>{biography}</p>}
          <p className="text-muted-foreground">Модель будет управлять миром и другими персонажами, но не вашим героем.</p>
        </div>}
      </CardContent>
      <CardFooter className="gap-2">
        {reviewing ? <><Button variant="outline" onClick={() => setReviewing(false)}>{source === 'draft' ? 'Изменить анкету' : 'Изменить выбор'}</Button><Button disabled={submitting} onClick={() => void start()}>{submitting ? 'Начинаем…' : 'Начать историю'}</Button></> : <Button disabled={!canContinue} onClick={() => setReviewing(true)}>Проверить героя</Button>}
      </CardFooter>
    </Card>
  </main>
}
