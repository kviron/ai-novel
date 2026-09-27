import { useCallback, useEffect, useState } from 'react'
import { useBlocker } from 'react-router-dom'

import { api, ApiRequestError, type CatalogCharacter, type StoryDraft, type StoryDraftSectionName } from '@/shared/api'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/ui/card'
import { Skeleton } from '@/shared/ui/skeleton'
import { useStoryDraft } from '../model/useStoryDraft'
import { CastStep } from './CastStep'
import { HeroStep } from './HeroStep'
import { IdentityStep } from './IdentityStep'
import { ModeStep } from './ModeStep'

const steps: { id: StoryDraftSectionName; label: string }[] = [
  { id: 'identity', label: 'Основа' }, { id: 'mode', label: 'Режим' }, { id: 'hero', label: 'Герой' }, { id: 'cast', label: 'Состав' },
]

function DirtyNavigationGuard() {
  const blocker = useBlocker(true)
  if (blocker.state !== 'blocked') return null
  return <Alert variant="destructive"><AlertTitle>Есть несохранённые изменения</AlertTitle><AlertDescription><p>Сохраните раздел или подтвердите выход: локальные правки будут потеряны.</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => blocker.reset()}>Остаться в редакторе</Button><Button type="button" variant="destructive" onClick={() => blocker.proceed()}>Выйти без сохранения</Button></div></AlertDescription></Alert>
}

export function StoryEditorShell({ storyId, initialDraft }: { storyId: string; initialDraft?: StoryDraft }) {
  const editor = useStoryDraft(storyId, initialDraft)
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
  if (editor.phase === 'loading' && !editor.draft) return <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6" aria-busy="true"><h1>Редактор новеллы</h1><p role="status">Загружаем черновик…</p><Skeleton className="h-40 w-full" /></main>
  if (!editor.draft || !editor.localSection) return <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-6"><h1>Редактор новеллы</h1><Alert variant="destructive"><AlertTitle>Не удалось открыть черновик</AlertTitle><AlertDescription>{editor.error || 'История или версия не найдена.'}</AlertDescription></Alert><Button type="button" onClick={() => void editor.reloadAfterConflict()}>Повторить</Button></main>

  const diagnostics = editor.diagnosticsFor(editor.activeStep)
  const common = { saving: editor.phase === 'saving', onSave: editor.saveSection }
  return <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><Badge variant="secondary">Черновик · v{editor.draft.draft_revision}</Badge><h1>{editor.draft.identity.title || 'Новая новелла'}</h1><p className="text-muted-foreground">Пошаговая настройка свободной или гибридной истории.</p></div></header>
    <nav aria-label="Разделы редактора" className="flex flex-wrap gap-2">{steps.map((step) => <Button key={step.id} type="button" variant={editor.activeStep === step.id ? 'default' : 'outline'} aria-current={editor.activeStep === step.id ? 'step' : undefined} disabled={Boolean(editor.dirtyStep && editor.activeStep !== step.id)} onClick={() => editor.setActiveStep(step.id)}>{step.label}</Button>)}</nav>
    {editor.dirtyStep && <p role="status" className="text-muted-foreground">Есть несохранённые изменения. Сохраните раздел перед переходом.</p>}
    {editor.dirtyStep && <DirtyNavigationGuard />}
    {editor.error && <Alert variant="destructive"><AlertTitle>{editor.phase === 'conflict' ? 'Конфликт версий' : 'Ошибка сохранения'}</AlertTitle><AlertDescription>{editor.error}{editor.phase === 'conflict' && <Button type="button" variant="outline" size="sm" onClick={() => void editor.reloadAfterConflict()}>Загрузить версию сервера</Button>}</AlertDescription></Alert>}
    {diagnostics.length > 0 && <Alert><AlertTitle>Проверка раздела</AlertTitle><AlertDescription>{diagnostics.map((diagnostic) => <p key={`${diagnostic.code}-${diagnostic.field}`}>{diagnostic.message}</p>)}</AlertDescription></Alert>}
    {editor.activeStep === 'identity' && <IdentityStep storyId={storyId} value={editor.localSection as StoryDraft['identity']} onChange={editor.setLocalSection} {...common} />}
    {editor.activeStep === 'mode' && <ModeStep value={editor.localSection as StoryDraft['mode']} onChange={editor.setLocalSection} {...common} />}
    {editor.activeStep === 'hero' && <HeroStep value={editor.localSection as StoryDraft['hero']} revisions={editor.draft.character_revisions} characters={characters} catalogError={catalogError} onRetryCatalog={retryCatalog} onChange={editor.setLocalSection} {...common} />}
    {editor.activeStep === 'cast' && <CastStep value={editor.localSection as StoryDraft['cast']} fixedHeroRevisionId={editor.draft.hero.fixed_hero_revision_id} revisions={editor.draft.character_revisions} characters={characters} catalogError={catalogError} onRetryCatalog={retryCatalog} onChange={editor.setLocalSection} {...common} />}
    {editor.activeStep !== 'identity' && editor.activeStep !== 'mode' && editor.activeStep !== 'hero' && editor.activeStep !== 'cast' && <Card><CardHeader><CardTitle>Раздел появится следующим</CardTitle><CardDescription>Основные настройки уже доступны.</CardDescription></CardHeader><CardContent /><CardFooter /></Card>}
  </main>
}
