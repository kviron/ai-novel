import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, Sparkles, Trash2, Search } from 'lucide-react'

import { api, type CatalogCharacter, type Character, type CharacterHistory, type StoryDetail } from '@/shared/api'
import { routes } from '@/shared/config'
import { akaneAvatar, markAvatar } from '@/shared/ui/characters'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar'
import { Checkbox } from '@/shared/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/shared/ui/toggle-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'

const defaultColor = '#D9A75F'

function portrait(id: string) { return id === 'akane' ? akaneAvatar : id === 'mark' ? markAvatar : null }

function CastPortrait({ character }: { character: Pick<Character, 'id' | 'name'> }) {
  const image = portrait(character.id)
  return <Avatar>{image && <AvatarImage src={image} alt="" />}<AvatarFallback>{character.name.slice(0, 1)}</AvatarFallback></Avatar>
}

const palette = ['#D9A75F', '#E57779', '#A587DF', '#68B8C5', '#7FB997', '#DA9A75']

export function StoryCastPage() {
  const { storyId } = useParams()
  const [story, setStory] = useState<StoryDetail | null>(null)
  const [catalog, setCatalog] = useState<CatalogCharacter[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [gender, setGender] = useState('all')
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
    setSearch('')
    setGender('all')
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
    if (!storyId || !editing || !revisionId || !/^#[0-9A-Fa-f]{6}$/.test(color)) return
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

  const visibleCatalog = catalog.filter((character) =>
    character.name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')) &&
    (gender === 'all' || character.gender === gender)
  )

  function toggleSelected(id: string) {
    setSelectedIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id])
  }

  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-8 pt-16 sm:px-6">
    <Link className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground" to={routes.studio}><ArrowLeft className="size-4" />Студия</Link>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm text-muted-foreground">Режим автора</p><h1 className="text-2xl font-semibold">Состав новеллы{story ? ` · ${story.title}` : ''}</h1><p className="mt-2 text-sm text-muted-foreground">Изменения применяются только к новым прохождениям.</p></div>
      <Button onClick={() => void openCatalog()} disabled={!story || busy}><Plus data-icon="inline-start" />Добавить</Button>
    </header>
    {loading && <p role="status">Загружаем состав…</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {story && <div className="overflow-hidden rounded-xl border bg-card"><Table className="min-w-[680px]"><TableHeader><TableRow><TableHead className="w-[35%]">Персонаж</TableHead><TableHead>Роль</TableHead><TableHead className="w-24">Ревизия</TableHead><TableHead className="sticky right-0 w-24 bg-card text-right">Действия</TableHead></TableRow></TableHeader><TableBody>
      {story.characters.map((character) => <TableRow key={character.id} className="group">
        <TableCell><div className="flex min-w-0 items-center gap-3"><span aria-hidden="true" className="h-10 w-1 shrink-0 rounded-full" style={{ backgroundColor: character.color ?? defaultColor }} /><CastPortrait character={character} /><span className="truncate font-medium">{character.name}</span></div></TableCell>
        <TableCell><span className="block max-w-[28rem] truncate text-muted-foreground" title={character.role}>{character.role === 'cast' ? 'Роль не указана' : character.role}</span></TableCell>
        <TableCell className="text-xs text-muted-foreground">v{character.visual_profile_version}</TableCell>
        <TableCell className="sticky right-0 bg-card"><div className="flex justify-end gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <Button variant="ghost" size="icon-sm" aria-label={`Редактировать ${character.name}`} onClick={() => void openEditor(character)}><Pencil /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Удалить ${character.name}`} disabled={story.characters.length <= 1} onClick={() => setRemoving(character)}><Trash2 /></Button>
        </div></TableCell>
      </TableRow>)}
      {story.characters.length === 0 && <TableRow><TableCell colSpan={4} className="p-8 text-center text-muted-foreground">В новелле пока нет персонажей.</TableCell></TableRow>}
    </TableBody></Table></div>}

    <Dialog open={addOpen} onOpenChange={setAddOpen}><DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl"><DialogHeader><DialogTitle>Добавить персонажей</DialogTitle><DialogDescription>Показаны только персонажи, которых ещё нет в этой новелле.</DialogDescription></DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex flex-wrap gap-3"><div className="relative min-w-40 flex-1"><Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1.5 size-4 text-muted-foreground" /><Input type="search" aria-label="Поиск персонажа" placeholder="Поиск персонажа" className="pl-8" value={search} onChange={(event) => setSearch(event.target.value)} /></div><ToggleGroup type="single" value={gender} onValueChange={(value) => { if (value) setGender(value) }} variant="outline" size="sm" aria-label="Фильтр по полу"><ToggleGroupItem value="all">Все</ToggleGroupItem><ToggleGroupItem value="female">Женский</ToggleGroupItem><ToggleGroupItem value="male">Мужской</ToggleGroupItem></ToggleGroup></div>
      <div className="min-h-0 overflow-y-auto rounded-md border"><Table><TableHeader><TableRow><TableHead className="w-10"><span className="sr-only">Выбор</span></TableHead><TableHead>Персонаж</TableHead><TableHead className="w-28">Пол</TableHead></TableRow></TableHeader><TableBody>{visibleCatalog.map((character) => <TableRow key={character.id} data-state={selectedIds.includes(character.id) ? 'selected' : undefined} className="cursor-pointer" onClick={() => toggleSelected(character.id)}><TableCell><Checkbox aria-label={character.name} checked={selectedIds.includes(character.id)} onCheckedChange={() => toggleSelected(character.id)} onClick={(event) => event.stopPropagation()} /></TableCell><TableCell><div className="flex items-center gap-3"><CastPortrait character={character} /><span className="font-medium">{character.name}</span></div></TableCell><TableCell className="text-muted-foreground">{character.gender === 'female' ? 'Женский' : character.gender === 'male' ? 'Мужской' : character.gender || 'Не указан'}</TableCell></TableRow>)}{visibleCatalog.length === 0 && <TableRow><TableCell colSpan={3} className="p-6 text-center text-muted-foreground">{catalog.length === 0 ? 'Доступных персонажей нет.' : 'По запросу персонажи не найдены.'}</TableCell></TableRow>}</TableBody></Table></div>
      <DialogFooter><span className="mr-auto text-xs text-muted-foreground">Выбрано: {selectedIds.length}</span><Button disabled={busy || selectedIds.length === 0} onClick={() => void addSelected()}>Добавить выбранных</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null) }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Настроить персонажа</DialogTitle><DialogDescription>{editing?.revisions.find((revision) => revision.id === revisionId)?.name} · только для этой новеллы</DialogDescription></DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <FieldGroup><Field><FieldLabel htmlFor="cast-revision">Ревизия</FieldLabel><Select value={revisionId} onValueChange={setRevisionId}><SelectTrigger id="cast-revision" className="w-full"><SelectValue placeholder="Выберите ревизию" /></SelectTrigger><SelectContent><SelectGroup>{editing?.revisions.map((revision) => <SelectItem key={revision.id} value={revision.id}>v{revision.revision_number} · {revision.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
        <Field><FieldLabel htmlFor="cast-role">Роль в новелле</FieldLabel><Textarea id="cast-role" rows={5} maxLength={2000} value={role} onChange={(event) => setRole(event.target.value)} /><FieldDescription>Описание участия героя в этой истории.</FieldDescription><Button variant="outline" size="sm" className="w-fit" disabled={busy} onClick={() => void generateRole()}><Sparkles data-icon="inline-start" />Сгенерировать роль</Button></Field>
        <Field data-invalid={!/^#[0-9A-Fa-f]{6}$/.test(color) || undefined}><FieldLabel htmlFor="cast-color">Цвет реплик</FieldLabel><div className="flex items-center gap-3"><Popover><PopoverTrigger asChild><Button variant="outline" aria-label="Выбрать цвет" className="gap-2"><span aria-hidden="true" className="size-4 rounded-sm border" style={{ backgroundColor: /^#[0-9A-Fa-f]{6}$/.test(color) ? color : defaultColor }} />Палитра</Button></PopoverTrigger><PopoverContent align="start" className="flex flex-wrap gap-2">{palette.map((shade) => <Button key={shade} type="button" variant="outline" size="icon-sm" aria-label={`Цвет ${shade}`} aria-pressed={color === shade} onClick={() => setColor(shade)}><span aria-hidden="true" className="size-5 rounded-sm" style={{ backgroundColor: shade }} /></Button>)}</PopoverContent></Popover><Input id="cast-color" aria-label="HEX-код цвета" aria-invalid={!/^#[0-9A-Fa-f]{6}$/.test(color)} className="w-28 font-mono" maxLength={7} value={color} onChange={(event) => setColor(event.target.value.toUpperCase())} /></div><FieldDescription>Выберите оттенок или введите HEX-код.</FieldDescription></Field></FieldGroup>
      <DialogFooter><Button disabled={busy || !revisionId || !/^#[0-9A-Fa-f]{6}$/.test(color)} onClick={() => void save()}>Сохранить</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null) }}><DialogContent><DialogHeader><DialogTitle>Убрать персонажа?</DialogTitle><DialogDescription>{removing?.name} исчезнет из состава новеллы, но останется в каталоге и начатых прохождениях.</DialogDescription></DialogHeader>{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<DialogFooter><Button variant="outline" onClick={() => setRemoving(null)}>Отмена</Button><Button variant="destructive" disabled={busy} onClick={() => void remove()}>Убрать из новеллы</Button></DialogFooter></DialogContent></Dialog>
  </main>
}
