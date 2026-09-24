import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Sparkles } from 'lucide-react'

import { api, type CatalogCharacter, type CharacterHistory, type StoryDetail } from '@/shared/api'
import { routes } from '@/shared/config'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Textarea } from '@/shared/ui/textarea'

export function StoryCastPage() {
  const { storyId } = useParams()
  const [story, setStory] = useState<StoryDetail | null>(null)
  const [catalog, setCatalog] = useState<CatalogCharacter[]>([])
  const [selected, setSelected] = useState<CharacterHistory | null>(null)
  const [revisionId, setRevisionId] = useState('')
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!storyId) return
    const controller = new AbortController()
    void Promise.all([api.getStory(storyId, controller.signal), api.listCharacters(controller.signal)])
      .then(([nextStory, nextCatalog]) => { if (!controller.signal.aborted) { setStory(nextStory); setCatalog(nextCatalog) } })
      .catch(() => { if (!controller.signal.aborted) setError('Не удалось загрузить состав новеллы.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [storyId])

  async function choose(characterId: string) {
    setBusy(true)
    setError(null)
    try {
      const history = await api.getCharacter(characterId)
      setSelected(history)
      const link = history.linked_stories.find((item) => item.story_id === storyId)
      setRevisionId(link?.revision_id ?? history.current_revision_id)
      setRole(link?.role === 'cast' ? '' : link?.role ?? '')
    } catch {
      setError('Не удалось загрузить ревизии персонажа.')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!storyId || !selected || !revisionId || !role.trim()) return
    setBusy(true)
    setError(null)
    try {
      const attached = selected.linked_stories.some((link) => link.story_id === storyId)
      if (attached) await api.pinCharacterRevision(storyId, selected.id, revisionId, role.trim())
      else await api.attachCharacter(storyId, selected.id, revisionId, role.trim())
      const [nextStory, nextHistory] = await Promise.all([api.getStory(storyId), api.getCharacter(selected.id)])
      setStory(nextStory)
      setSelected(nextHistory)
    } catch {
      setError('Не удалось закрепить ревизию. Повторите попытку.')
    } finally {
      setBusy(false)
    }
  }

  async function generateRole() {
    if (!storyId || !selected || !revisionId) return
    setBusy(true)
    setError(null)
    try {
      const generated = await api.generateStoryRole(storyId, selected.id, revisionId, role)
      setRole(generated.text)
    } catch {
      setError('Не удалось сгенерировать роль. Проверьте Ollama и повторите.')
    } finally {
      setBusy(false)
    }
  }

  const linked = selected?.linked_stories.find((link) => link.story_id === storyId)
  const selectedName = selected?.revisions.find((revision) => revision.id === selected.current_revision_id)?.name

  return <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-8 pt-16 sm:px-6">
    <Link className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground" to={routes.studio}><ArrowLeft className="size-4" />Студия</Link>
    <header><p className="text-sm text-muted-foreground">Режим автора</p><h1 className="text-2xl font-semibold">Состав новеллы{story ? ` · ${story.title}` : ''}</h1><p className="mt-2 text-sm text-muted-foreground">Выбранные ревизии используются в новых сессиях. Существующие прохождения не изменятся.</p></header>
    {loading && <p role="status">Загружаем состав…</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {story && <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
      <Card><CardHeader><CardTitle>Каталог</CardTitle><CardDescription>Выберите персонажа для добавления или смены ревизии.</CardDescription></CardHeader><CardContent className="grid gap-2">{catalog.map((character) => <Button key={character.character_id} variant={selected?.id === character.character_id ? 'secondary' : 'outline'} className="justify-between" onClick={() => void choose(character.character_id)} disabled={busy}><span>{character.name}</span><span className="text-muted-foreground">{story.characters.some((item) => item.id === character.character_id) ? 'В составе' : 'Не добавлен'}</span></Button>)}{catalog.length === 0 && <p className="text-sm text-muted-foreground">Каталог пуст.</p>}<Button asChild variant="link" className="justify-start px-0"><Link to={routes.characters}>Открыть каталог персонажей</Link></Button></CardContent></Card>
      <Card><CardHeader><CardTitle>{selectedName ?? 'Ревизия персонажа'}</CardTitle><CardDescription>{selected ? 'Настройте участие персонажа именно в этой новелле.' : 'Выберите персонажа слева.'}</CardDescription></CardHeader><CardContent className="grid gap-4">{selected && <><FieldGroup><Field><FieldLabel htmlFor="cast-revision">Ревизия</FieldLabel><select id="cast-revision" className="h-8 rounded-md border border-input bg-input/20 px-2 text-xs" value={revisionId} onChange={(event) => setRevisionId(event.target.value)}>{selected.revisions.map((revision) => <option key={revision.id} value={revision.id}>v{revision.revision_number} · {revision.name}</option>)}</select></Field><Field><FieldLabel htmlFor="cast-role">Роль в новелле</FieldLabel><Textarea id="cast-role" rows={4} maxLength={2000} placeholder="Например: союзник героини, который скрывает связь с антагонистом" value={role} onChange={(event) => setRole(event.target.value)} disabled={busy} /><FieldDescription>Отношения и функция героя в этой истории. В другой новелле роль может быть иной.</FieldDescription><Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void generateRole()} disabled={busy}><Sparkles className="size-4" />{busy ? 'Генерируем…' : 'Сгенерировать роль'}</Button></Field></FieldGroup><p className="text-xs text-muted-foreground">{linked ? `Сейчас закреплена ревизия v${linked.revision_number}.` : 'Персонаж пока не входит в состав.'}</p><Button disabled={busy || !role.trim() || (linked?.revision_id === revisionId && linked.role === role.trim())} onClick={() => void save()}>{busy ? 'Сохраняем…' : linked ? 'Сохранить роль и ревизию' : 'Добавить в новеллу'}</Button><Button asChild variant="link" className="justify-start px-0"><Link to={routes.characterDetail(selected.id)}>Открыть профиль</Link></Button></>}</CardContent></Card>
    </div>}
  </main>
}
