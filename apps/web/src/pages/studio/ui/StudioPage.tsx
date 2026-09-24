import { useEffect, useState, type FormEvent } from 'react'
import { PanelRight } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { StoryScene, useStoryPlayer } from '@/features/play-story'
import { api, type StorySession, type StorySummary } from '@/shared/api'
import { resolveStoryTheme, routes } from '@/shared/config'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Field, FieldLabel } from '@/shared/ui/field'
import { Input } from '@/shared/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet'

function StudioEntry() {
  const navigate = useNavigate()
  const [stories, setStories] = useState<StorySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [sessionId, setSessionId] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void api.listStories(controller.signal).then(setStories).catch(() => {
      if (!controller.signal.aborted) setError('Не удалось загрузить истории.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  async function start(story: StorySummary) {
    setPending(true)
    setError(null)
    try {
      const session = await api.startSession(story.id, { provider_id: story.recommended_provider_id, kind: 'author' })
      navigate(routes.studioSession(session.id))
    } catch {
      setError('Не удалось создать тестовую сессию. Проверьте сервер и повторите попытку.')
      setPending(false)
    }
  }

  function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = sessionId.trim()
    if (value) navigate(routes.studioSession(value))
  }

  return <div className="studio-entry">
    <header className="studio-entry-header"><Badge variant="secondary">Режим автора</Badge></header>
    <div className="studio-entry-content">
      <div><p className="eyebrow">Студия</p><h1>Проверка сцен</h1><p className="muted-copy">Запустите отдельное прохождение, чтобы проверить историю, решения и состояние генерации.</p></div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {loading && <p role="status" className="muted-copy">Загружаем истории…</p>}
      {!loading && !error && stories.length === 0 && <p className="muted-copy">Историй для тестирования пока нет.</p>}
      {stories.map((story) => <Card key={story.id} className="studio-story-card"><CardHeader><CardTitle>{story.title}</CardTitle><CardDescription>{story.premise}</CardDescription></CardHeader><CardContent className="studio-story-action"><span className="muted-copy">{story.recommended_provider_id} · модель из настроек сервера</span><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to={routes.studioStoryCharacters(story.id)}>Состав новеллы</Link></Button><Button disabled={pending} onClick={() => void start(story)}>{pending ? 'Создаём…' : 'Новая тестовая сессия'}</Button></div></CardContent></Card>)}
      <Card><CardHeader><CardTitle>Продолжить тест</CardTitle><CardDescription>Откройте уже созданную сессию по её ID.</CardDescription></CardHeader><CardContent><form className="studio-open-form" onSubmit={open}><Field><FieldLabel htmlFor="studio-session-id">ID сессии</FieldLabel><Input id="studio-session-id" value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="ID сессии" /></Field><Button type="submit" disabled={!sessionId.trim()}>Открыть сессию</Button></form></CardContent></Card>
    </div>
  </div>
}

function Inspector({ session, phase, inSheet = false }: { session: StorySession | null; phase: ReturnType<typeof useStoryPlayer>['phase']; inSheet?: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copyId() {
    if (!session) return
    try {
      await navigator.clipboard.writeText(session.id)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return <aside className={inSheet ? 'studio-inspector studio-inspector-sheet' : 'studio-inspector'} aria-label="Инспектор сессии"><Card><CardHeader><CardTitle>Состояние сессии</CardTitle><CardDescription>Только подтверждённые сервером данные</CardDescription></CardHeader><CardContent className="inspector-fields">
    <div><span>Статус</span><Badge variant={phase === 'error' || phase === 'provider_unavailable' ? 'destructive' : phase === 'submitting' || phase === 'loading' ? 'secondary' : 'outline'}>{phase === 'submitting' ? 'Генерация' : phase === 'loading' ? 'Загрузка' : phase === 'provider_unavailable' ? 'Провайдер недоступен' : phase === 'error' ? 'Ошибка' : 'Готово'}</Badge></div>
    {session ? <><div><span>История</span><strong>{session.story.title}</strong></div><div><span>Сцена</span><strong>{session.current_scene}</strong></div><div><span>Версия состояния</span><strong>v{session.state_version}</strong></div><div><span>Провайдер</span><strong>{session.provider_id}</strong></div><div><span>Модель</span><strong>{session.model_id}</strong></div><div><span>Промпт</span><strong data-field="prompt-version">{session.latest_turn?.prompt_version ?? '—'}</strong></div><div><span>Визуальное состояние</span><strong>{session.visual_state.emotion} · {session.visual_state.pose} · {session.visual_state.outfit}</strong></div><div><span>Фон</span><strong>{session.visual_state.background}</strong></div><div><span>Последнее действие</span><strong data-field="last-action">{session.latest_turn?.action ?? 'Ходов пока нет'}</strong></div><div><span>ID сессии</span><code>{session.id}</code><Button size="sm" variant="ghost" onClick={() => void copyId()}>{copied ? 'Скопировано' : 'Копировать ID'}</Button></div></> : <p className="muted-copy">Загружаем состояние…</p>}
  </CardContent></Card>{session && <Button asChild variant="outline" className="w-full"><Link to={routes.storyPlayer(session.id)}>Открыть как игрок</Link></Button>}</aside>
}

function StudioSession({ sessionId }: { sessionId: string }) {
  const player = useStoryPlayer(sessionId)
  const theme = resolveStoryTheme(player.session?.story.slug)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  return <div className="studio-shell" data-story-theme={theme.id} style={theme.variables}>
    <header className="game-header">
      <div className="studio-header-title"><Badge variant="secondary">Режим автора</Badge><h1>{player.session?.story.title ?? 'Тестовая сессия'}</h1></div>
      <div className="studio-header-actions">
        <Button className="studio-inspector-trigger" type="button" size="icon-sm" variant="ghost" aria-label="Открыть инспектор" title="Открыть инспектор" onClick={() => setInspectorOpen(true)}><PanelRight aria-hidden="true" /></Button>
        <Link className="mode-link" to={routes.studio}>Все тесты</Link>
      </div>
    </header>
    <div className="studio-workspace"><StoryScene player={player} /><Inspector session={player.session} phase={player.phase} /></div>
    <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
      <SheetContent style={theme.variables} aria-label="Инспектор автора">
        <SheetHeader><SheetTitle>Инспектор сессии</SheetTitle><SheetDescription>Только подтверждённые сервером данные</SheetDescription></SheetHeader>
        <Inspector session={player.session} phase={player.phase} inSheet />
      </SheetContent>
    </Sheet>
  </div>
}

export function StudioPage({ sessionId }: { sessionId?: string }) {
  return sessionId ? <StudioSession sessionId={sessionId} /> : <StudioEntry />
}
