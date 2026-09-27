import { useCallback, useEffect, useState } from 'react'
import { useBlocker, useNavigate } from 'react-router-dom'

import { api, ApiRequestError, type CatalogCharacter, type DraftDiagnostic, type StoryDraft, type StoryDraftSectionName } from '@/shared/api'
import { routes } from '@/shared/config'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Skeleton } from '@/shared/ui/skeleton'
import { useStoryDraft } from '../model/useStoryDraft'
import { focusDraftDiagnostic } from '../model/diagnosticFocus'
import { CastStep } from './CastStep'
import { HeroStep } from './HeroStep'
import { IdentityStep } from './IdentityStep'
import { ModeStep } from './ModeStep'
import { RulesStep } from './RulesStep'
import { CanonStep } from './CanonStep'
import { ReviewStep } from './ReviewStep'
import { DraftStatusPanel } from './DraftStatusPanel'

type EditorStep = StoryDraftSectionName | 'review'
const steps: { id: EditorStep; label: string }[] = [
  { id: 'identity', label: 'Основа' }, { id: 'mode', label: 'Режим' }, { id: 'hero', label: 'Герой' }, { id: 'cast', label: 'Состав' },
  { id: 'rules', label: 'Правила' }, { id: 'canon', label: 'Канон' }, { id: 'review', label: 'Проверка' },
]

function DirtyNavigationGuard() {
  const blocker = useBlocker(true)
  if (blocker.state !== 'blocked') return null
  return <Alert variant="destructive"><AlertTitle>Есть несохранённые изменения</AlertTitle><AlertDescription><p>Сохраните раздел или подтвердите выход: локальные правки будут потеряны.</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => blocker.reset()}>Остаться в редакторе</Button><Button type="button" variant="destructive" onClick={() => blocker.proceed()}>Выйти без сохранения</Button></div></AlertDescription></Alert>
}

export function StoryEditorShell({ storyId, initialDraft }: { storyId: string; initialDraft?: StoryDraft }) {
  const editor = useStoryDraft(storyId, initialDraft)
  const navigate = useNavigate()
  const [viewStep, setViewStep] = useState<EditorStep>('identity')
  const [validationResult, setValidationResult] = useState<{ revision: number; diagnostics: DraftDiagnostic[] } | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [characters, setCharacters] = useState<CatalogCharacter[]>([])
  const [catalogError, setCatalogError] = useState('')
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setCatalogError('')
    void api.listCharacters(controller.signal).then(setCharacters).catch((cause) => {
      if (!controller.signal.aborted) setCatalogError(cause instanceof ApiRequestError ? cause.message : 'Не удалось загрузить персонажей.')
    })
    return () => controller.abort()
  }, [catalogAttempt])
  const retryCatalog = useCallback(() => setCatalogAttempt((attempt) => attempt + 1), [])
  if (editor.phase === 'loading' && !editor.draft) return <main className="flex w-full min-w-0 flex-col gap-4 p-4 md:p-6" aria-busy="true"><h1>Редактор новеллы</h1><p role="status">Загружаем черновик…</p><Skeleton className="h-40 w-full" /></main>
  if (!editor.draft || !editor.localSection) return <main className="flex w-full min-w-0 flex-col gap-4 p-4 md:p-6"><h1>Редактор новеллы</h1><Alert variant="destructive"><AlertTitle>Не удалось открыть черновик</AlertTitle><AlertDescription>{editor.error || 'История или версия не найдена.'}</AlertDescription></Alert><Button type="button" onClick={() => void editor.reloadAfterConflict()}>Повторить</Button></main>

  const currentDraft = editor.draft
  const visibleDiagnostics = validationResult?.revision === currentDraft.draft_revision ? validationResult.diagnostics : currentDraft.diagnostics
  const common = { saving: editor.phase === 'saving', onSave: editor.saveSection }
  const pinnedCanonCharacterIds = new Set([
    ...(currentDraft.hero.fixed_hero_revision_id
      ? currentDraft.character_revisions.filter(({ id }) => id === currentDraft.hero.fixed_hero_revision_id).map(({ character_id }) => character_id)
      : []),
    ...currentDraft.cast.characters.map(({ character_id }) => character_id),
  ])
  const canonCharacters = [...pinnedCanonCharacterIds].map((character_id) => ({
    character_id,
    name: currentDraft.character_revisions.find((revision) => revision.character_id === character_id)?.name ?? character_id,
  }))
  const selectStep = (step: EditorStep) => {
    if (editor.dirtyStep) return
    setViewStep(step)
    if (step !== 'review') editor.setActiveStep(step)
  }
  const validate = async () => {
    setActionBusy(true); setActionError('')
    try {
      const result = await api.validateStoryDraft(storyId)
      setValidationResult({ revision: currentDraft.draft_revision, diagnostics: result.diagnostics })
      return result
    } catch (cause) {
      setActionError(cause instanceof ApiRequestError ? cause.message : 'Не удалось проверить черновик.')
      return null
    } finally { setActionBusy(false) }
  }
  const runValidated = async (action: 'test' | 'publish') => {
    setActionBusy(true); setActionError('')
    try {
      const result = await api.validateStoryDraft(storyId)
      setValidationResult({ revision: currentDraft.draft_revision, diagnostics: result.diagnostics })
      if (result.diagnostics.some(({ severity }) => severity === 'error')) return
      if (action === 'test') {
        const session = await api.startDraftTest(storyId)
        navigate(routes.studioSession(session.id))
      } else {
        editor.acceptDraft(await api.publishStoryDraft(storyId))
      }
    } catch (cause) {
      setActionError(cause instanceof ApiRequestError ? cause.message : `Не удалось ${action === 'test' ? 'запустить тест' : 'опубликовать историю'}.`)
    } finally { setActionBusy(false) }
  }
  const clone = async () => {
    if (!editor.draft) return
    setActionBusy(true); setActionError('')
    try { editor.acceptDraft(await api.createDraftFromVersion(storyId, editor.draft.version_id)); setValidationResult(null) }
    catch (cause) { setActionError(cause instanceof ApiRequestError ? cause.message : 'Не удалось создать новую редакцию.') }
    finally { setActionBusy(false) }
  }
  const focusDiagnostic = (diagnostic: DraftDiagnostic) => {
    const step = diagnostic.step === 'review' ? 'review' : diagnostic.step
    selectStep(step)
    window.setTimeout(() => focusDraftDiagnostic(diagnostic))
  }
  return <main className="flex w-full min-w-0 flex-col gap-6 p-4 md:p-6 xl:p-8">
    <header className="flex flex-wrap items-end justify-between gap-3"><div className="flex flex-col gap-2"><Badge className="w-fit" variant={editor.draft.status === 'published' ? 'default' : 'secondary'}>{editor.draft.status === 'published' ? `Опубликовано · версия ${editor.draft.version_number}` : `Черновик · v${editor.draft.draft_revision}`}</Badge><h1>{editor.draft.identity.title || 'Новая новелла'}</h1><p className="text-muted-foreground">Пошаговая настройка свободной или гибридной истории.</p></div></header>
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(250px,300px)] xl:grid-cols-[170px_minmax(0,1fr)_minmax(270px,320px)]">
    <nav aria-label="Разделы редактора" className="flex min-w-0 flex-wrap gap-1 rounded-lg border bg-card p-2 lg:col-span-2 xl:sticky xl:top-6 xl:col-span-1 xl:flex-col"><p className="hidden px-2 py-1 text-xs font-medium text-muted-foreground xl:block">Разделы</p>{steps.map((step, index) => <Button key={step.id} type="button" variant={viewStep === step.id ? 'secondary' : 'ghost'} size="sm" className="justify-start" aria-current={viewStep === step.id ? 'step' : undefined} disabled={Boolean(editor.dirtyStep && viewStep !== step.id)} onClick={() => selectStep(step.id)}><span aria-hidden="true">{index + 1}.</span>{step.label}</Button>)}</nav>
    <div className="flex min-w-0 flex-col gap-4">
    {editor.dirtyStep && <p role="status" className="text-muted-foreground">Есть несохранённые изменения. Сохраните раздел перед переходом.</p>}
    {editor.dirtyStep && <DirtyNavigationGuard />}
    {editor.error && <Alert variant="destructive"><AlertTitle>{editor.phase === 'conflict' ? 'Конфликт версий' : 'Ошибка сохранения'}</AlertTitle><AlertDescription>{editor.error}{editor.phase === 'conflict' && <Button type="button" variant="outline" size="sm" onClick={() => void editor.reloadAfterConflict()}>Загрузить версию сервера</Button>}</AlertDescription></Alert>}
    {viewStep === 'identity' && <IdentityStep storyId={storyId} value={editor.localSection as StoryDraft['identity']} onChange={editor.setLocalSection} {...common} />}
    {viewStep === 'mode' && <ModeStep value={editor.localSection as StoryDraft['mode']} savedValue={editor.draft.mode} hasIncompatibleCanon={Boolean(editor.draft.canon.creative_goals || editor.draft.canon.facts.length || editor.draft.canon.beats.length)} onChange={editor.setLocalSection} {...common} />}
    {viewStep === 'hero' && <HeroStep value={editor.localSection as StoryDraft['hero']} revisions={editor.draft.character_revisions} characters={characters} catalogError={catalogError} onRetryCatalog={retryCatalog} onChange={editor.setLocalSection} {...common} />}
    {viewStep === 'cast' && <CastStep value={editor.localSection as StoryDraft['cast']} fixedHeroRevisionId={editor.draft.hero.fixed_hero_revision_id} revisions={editor.draft.character_revisions} characters={characters} catalogError={catalogError} onRetryCatalog={retryCatalog} onChange={editor.setLocalSection} {...common} />}
    {viewStep === 'rules' && <RulesStep value={editor.localSection as StoryDraft['rules']} onChange={editor.setLocalSection} {...common} />}
    {viewStep === 'canon' && <CanonStep mode={editor.draft.mode.mode} characters={canonCharacters} value={editor.localSection as StoryDraft['canon']} onChange={editor.setLocalSection} {...common} />}
    {viewStep === 'review' && <ReviewStep draft={editor.draft} />}
    </div>
    <DraftStatusPanel draft={currentDraft} diagnostics={visibleDiagnostics} busy={actionBusy} dirty={Boolean(editor.dirtyStep)} actionError={actionError} onValidate={async () => { await validate() }} onTest={async () => { await runValidated('test') }} onPublish={async () => { await runValidated('publish') }} onClone={clone} onDiagnostic={focusDiagnostic} />
    </div>
  </main>
}
