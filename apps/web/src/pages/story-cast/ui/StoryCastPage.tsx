import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'

import { api, type CatalogCharacter, type Character, type CharacterHistory, type StoryDetail } from '@/shared/api'
import { routes } from '@/shared/config'
import { akaneAvatar, markAvatar } from '@/shared/ui/characters'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'

const defaultColor = '#D9A75F'

function portrait(id: string) { return id === 'akane' ? akaneAvatar : id === 'mark' ? markAvatar : null }

function CastPortrait({ character }: { character: Pick<Character, 'id' | 'name'> }) {
  const image = portrait(character.id)
  return image
    ? <img src={image} alt="" className="size-10 shrink-0 rounded-md object-cover" />
    : <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted font-semibold">{character.name.slice(0, 1)}</span>
}

export function StoryCastPage() {
  const { storyId } = useParams()
  const [story, setStory] = useState<StoryDetail | null>(null)
  const [catalog, setCatalog] = useState<CatalogCharacter[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<CharacterHistory | null>(null)
  const [removing, setRemoving] = useState<Character | null>(null)
  const [revisionId, setRevisionId] = useState('')
  const [role, setRole] = useState('')
  const [color, setColor] = useState(defaultColor)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!storyId) return
    const controller = new AbortController()
    void api.getStory(storyId, controller.signal)
      .then((next) => { if (!controller.signal.aborted) setStory(next) })
      .catch(() => { if (!controller.signal.aborted) setError('Не удалось загрузить состав новеллы.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [storyId])

  async function openCatalog() {
    if (!storyId) return
    setError(null)
    setSelectedIds([])
    setAddOpen(true)
    try { setCatalog(await api.listCharacters(undefined, storyId)) }
    catch { setError('Не удалось загрузить каталог персонажей.') }
  }

  async function addSelected() {
    if (!storyId || selectedIds.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await api.addStoryCharacters(storyId, selectedIds)
      setStory(await api.getStory(storyId))
      setAddOpen(false)
    } catch { setError('Не удалось добавить персонажей. Состав не изменён.') }
    finally { setBusy(false) }
  }

  async function openEditor(character: Character) {
    setBusy(true)
    setError(null)
    try {
      const history = await api.getCharacter(character.id)
      const link = history.linked_stories.find((item) => item.story_id === storyId)
      setEditing(history)
      setRevisionId(link?.revision_id ?? history.current_revision_id)
      setRole(link?.role === 'cast' ? '' : link?.role ?? '')
      setColor(link?.color ?? character.color ?? defaultColor)
    } catch { setError('Не удалось загрузить настройки персонажа.') }
    finally { setBusy(false) }
  }

  async function save() {
    if (!storyId || !editing || !revisionId) return
    setBusy(true)
    setError(null)
    try {
      await api.updateStoryCharacter(storyId, editing.id, revisionId, role.trim() || 'cast', color)
      setStory(await api.getStory(storyId))
      setEditing(null)
    } catch { setError('Не удалось сохранить настройки персонажа.') }
    finally { setBusy(false) }
  }

  async function generateRole() {
    if (!storyId || !editing || !revisionId) return
    setBusy(true)
    try { setRole((await api.generateStoryRole(storyId, editing.id, revisionId, role)).text) }
    catch { setError('Не удалось сгенерировать роль. Проверьте Ollama.') }
    finally { setBusy(false) }
  }

  async function remove() {
    if (!storyId || !removing) return
    setBusy(true)
    setError(null)
    try {
      await api.removeStoryCharacter(storyId, removing.id)
      setStory(await api.getStory(storyId))
      setRemoving(null)
    } catch { setError('Не удалось убрать персонажа из новеллы.') }
    finally { setBusy(false) }
  }

  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-8 pt-16 sm:px-6">
    <Link className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground" to={routes.studio}><ArrowLeft className="size-4" />Студия</Link>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm text-muted-foreground">Режим автора</p><h1 className="text-2xl font-semibold">Состав новеллы{story ? ` · ${story.title}` : ''}</h1><p className="mt-2 text-sm text-muted-foreground">Изменения применяются только к новым прохождениям.</p></div>
      <Button onClick={() => void openCatalog()} disabled={!story || busy}><Plus data-icon="inline-start" />Добавить персонажа</Button>
    </header>
    {loading && <p role="status">Загружаем состав…</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {story && <div className="overflow-hidden rounded-xl border bg-card">
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] gap-3 border-b px-4 py-3 text-xs text-muted-foreground sm:grid"><span>Персонаж</span><span>Роль</span><span>Ревизия</span><span>Действия</span></div>
      {story.characters.map((character) => <div key={character.id} className="group flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-b-0 sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto]" style={{ borderLeft: `3px solid ${character.color ?? defaultColor}`, boxShadow: `inset 0 0 0 1px ${character.color ?? defaultColor}` }}>
        <div className="flex min-w-0 items-center gap-3"><CastPortrait character={character} /><span className="truncate font-medium">{character.name}</span></div>
        <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground sm:flex-none">{character.role === 'cast' ? 'Роль не указана' : character.role}</p>
        <span className="text-xs text-muted-foreground">v{character.visual_profile_version}</span>
        <div className="ml-auto flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <Button variant="ghost" size="icon-sm" aria-label={`Редактировать ${character.name}`} onClick={() => void openEditor(character)}><Pencil /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Удалить ${character.name}`} disabled={story.characters.length <= 1} onClick={() => setRemoving(character)}><Trash2 /></Button>
        </div>
      </div>)}
      {story.characters.length === 0 && <p className="p-8 text-center text-muted-foreground">В новелле пока нет персонажей.</p>}
    </div>}

    <Dialog open={addOpen} onOpenChange={setAddOpen}><DialogContent className="flex max-h-[80dvh] flex-col sm:max-w-2xl"><DialogHeader><DialogTitle>Добавить персонажей</DialogTitle><DialogDescription>Показаны только персонажи, которых ещё нет в этой новелле.</DialogDescription></DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="min-h-0 overflow-y-auto">{catalog.map((character) => <label key={character.id} className="flex cursor-pointer items-center gap-3 border-b p-3"><input type="checkbox" aria-label={character.name} checked={selectedIds.includes(character.id)} onChange={(event) => setSelectedIds((previous) => event.target.checked ? [...previous, character.id] : previous.filter((id) => id !== character.id))} /><CastPortrait character={character} /><span>{character.name}</span></label>)}{catalog.length === 0 && <p className="p-6 text-center text-muted-foreground">Доступных персонажей нет.</p>}</div>
      <DialogFooter><Button disabled={busy || selectedIds.length === 0} onClick={() => void addSelected()}>Добавить выбранных</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null) }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Настроить персонажа</DialogTitle><DialogDescription>{editing?.revisions.find((revision) => revision.id === revisionId)?.name} · только для этой новеллы</DialogDescription></DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <FieldGroup><Field><FieldLabel htmlFor="cast-revision">Ревизия</FieldLabel><Select value={revisionId} onValueChange={setRevisionId}><SelectTrigger id="cast-revision" className="w-full"><SelectValue placeholder="Выберите ревизию" /></SelectTrigger><SelectContent><SelectGroup>{editing?.revisions.map((revision) => <SelectItem key={revision.id} value={revision.id}>v{revision.revision_number} · {revision.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        <Field><FieldLabel htmlFor="cast-role">Роль в новелле</FieldLabel><Textarea id="cast-role" rows={5} maxLength={2000} value={role} onChange={(event) => setRole(event.target.value)} /><FieldDescription>Описание участия героя в этой истории.</FieldDescription><Button variant="outline" size="sm" className="w-fit" disabled={busy} onClick={() => void generateRole()}><Sparkles data-icon="inline-start" />Сгенерировать роль</Button></Field>
        <Field><FieldLabel htmlFor="cast-color">Цвет реплик</FieldLabel><div className="flex items-center gap-3"><Input id="cast-color" type="color" className="w-16 p-1" value={color} onChange={(event) => setColor(event.target.value.toUpperCase())} /><span className="text-sm text-muted-foreground">{color}</span></div></Field></FieldGroup>
      <DialogFooter><Button disabled={busy || !revisionId} onClick={() => void save()}>Сохранить</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null) }}><DialogContent><DialogHeader><DialogTitle>Убрать персонажа?</DialogTitle><DialogDescription>{removing?.name} исчезнет из состава новеллы, но останется в каталоге и начатых прохождениях.</DialogDescription></DialogHeader>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<DialogFooter><Button variant="outline" onClick={() => setRemoving(null)}>Отмена</Button><Button variant="destructive" disabled={busy} onClick={() => void remove()}>Убрать из новеллы</Button></DialogFooter></DialogContent></Dialog>
  </main>
}
