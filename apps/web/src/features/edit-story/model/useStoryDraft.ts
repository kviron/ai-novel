import { useCallback, useEffect, useMemo, useState } from 'react'

import { api, ApiRequestError, type DraftDiagnostic, type StoryDraft, type StoryDraftSectionMap, type StoryDraftSectionName } from '@/shared/api'

export type StoryDraftPhase = 'loading' | 'ready' | 'saving' | 'conflict' | 'error'

export function useStoryDraft(storyId: string, initialDraft?: StoryDraft) {
  const [draft, setDraft] = useState<StoryDraft | null>(initialDraft ?? null)
  const [activeStep, setActiveStepState] = useState<StoryDraftSectionName>('identity')
  const [localSection, setLocalSectionState] = useState<StoryDraftSectionMap[StoryDraftSectionName] | null>(initialDraft?.identity ?? null)
  const [dirtyStep, setDirtyStep] = useState<StoryDraftSectionName | null>(null)
  const [phase, setPhase] = useState<StoryDraftPhase>(initialDraft ? 'ready' : 'loading')
  const [error, setError] = useState('')

  const load = useCallback(async (replaceLocal: boolean) => {
    setPhase('loading')
    setError('')
    try {
      const next = await api.getStoryDraft(storyId)
      setDraft(next)
      if (replaceLocal) {
        setLocalSectionState(next[activeStep])
        setDirtyStep(null)
      }
      setPhase('ready')
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Не удалось открыть редактор новеллы.')
      setPhase('error')
    }
  }, [activeStep, storyId])

  useEffect(() => {
    if (!initialDraft) void load(true)
  }, [initialDraft, load])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirtyStep) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirtyStep])

  const setActiveStep = useCallback((step: StoryDraftSectionName) => {
    if (!draft || dirtyStep) return
    setActiveStepState(step)
    setLocalSectionState(draft[step])
    setError('')
  }, [draft, dirtyStep])

  const setLocalSection = useCallback((section: StoryDraftSectionMap[StoryDraftSectionName]) => {
    setLocalSectionState(section)
    setDirtyStep(activeStep)
  }, [activeStep])

  const saveSection = useCallback(async (
    override?: StoryDraftSectionMap[StoryDraftSectionName],
    options: { confirmClearIncompatible?: boolean } = {},
  ) => {
    const sectionToSave = override ?? localSection
    if (!draft || !sectionToSave) return false
    setPhase('saving')
    setError('')
    try {
      const next = await api.saveStoryDraftSection(storyId, activeStep, sectionToSave as never, draft.draft_revision, {
        confirmModeChange: options.confirmClearIncompatible,
        confirmClearIncompatible: options.confirmClearIncompatible,
      })
      setDraft(next)
      setLocalSectionState(next[activeStep])
      setDirtyStep(null)
      setPhase('ready')
      return true
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 409) {
        setError(cause.message)
        setPhase('conflict')
        return false
      }
      setError(cause instanceof ApiRequestError ? cause.message : 'Не удалось сохранить раздел. Повторите попытку.')
      setPhase('error')
      return false
    }
  }, [activeStep, draft, localSection, storyId])

  const reloadAfterConflict = useCallback(() => load(true), [load])
  const diagnosticsFor = useCallback((step: StoryDraftSectionName): DraftDiagnostic[] => (
    draft?.diagnostics.filter((diagnostic) => diagnostic.step === step) ?? []
  ), [draft])
  const acceptDraft = useCallback((next: StoryDraft) => {
    setDraft(next)
    setLocalSectionState(next[activeStep])
    setDirtyStep(null)
    setError('')
    setPhase('ready')
  }, [activeStep])
  return useMemo(() => ({
    draft, phase, error, activeStep, localSection, dirtyStep, setActiveStep, setLocalSection,
    saveSection, reloadAfterConflict, diagnosticsFor, acceptDraft,
  }), [acceptDraft, activeStep, diagnosticsFor, dirtyStep, draft, error, localSection, phase, reloadAfterConflict, saveSection, setActiveStep, setLocalSection])
}
