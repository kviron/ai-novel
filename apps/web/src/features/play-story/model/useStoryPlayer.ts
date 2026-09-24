import { useEffect, useRef, useState } from 'react'
import { ApiRequestError, api, type CreateTurnRequest, type StorySession } from '@/shared/api'

type Phase = 'loading' | 'ready' | 'submitting' | 'rewinding' | 'switching_model' | 'provider_unavailable' | 'error'
type PlayerState = {
  session: StorySession | null
  phase: Phase
  message: string
  error: string | null
  checking: boolean
  reloadRequired: boolean
  models: string[]
}
const initial: PlayerState = { session: null, phase: 'loading', message: 'Восстанавливаем прохождение…', error: null, checking: false, reloadRequired: false, models: [] }
const isAbort = (cause: unknown) => typeof cause === 'object' && cause !== null && (cause as { name?: unknown }).name === 'AbortError'
const errorText = (cause: unknown) => cause instanceof ApiRequestError ? cause.message : 'Не удалось продолжить историю. Повторите попытку.'

export function useStoryPlayer(sessionId: string) {
  const [state, setState] = useState<PlayerState>(initial)
  const [action, setAction] = useState('')
  const lifetime = useRef<AbortController | null>(null)
  const busy = useRef(false)
  const attempt = useRef<CreateTurnRequest | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    busy.current = true
    attempt.current = null
    setAction('')
    setState(initial)
    void (async () => {
      try {
        const session = await api.getSession(sessionId, controller.signal)
        if (controller.signal.aborted) return
        setState((previous) => ({ ...previous, session, message: 'Проверяем нейросеть…' }))
        const providers = await api.providers(controller.signal)
        if (controller.signal.aborted) return
        const available = providers.some((provider) => provider.provider_id === session.provider_id && provider.available && provider.models.includes(session.model_id))
        setState({ ...initial, session, models: providers.find((provider) => provider.provider_id === session.provider_id)?.models ?? [], phase: available ? 'ready' : 'provider_unavailable', message: available ? 'Готово к следующему ходу.' : 'Нейросеть недоступна' })
      } catch (cause) {
        if (!controller.signal.aborted && !isAbort(cause)) {
          setState((previous) => ({ ...previous, phase: previous.session ? 'provider_unavailable' : 'error', error: errorText(cause), message: previous.session ? 'Нейросеть недоступна' : 'Не удалось восстановить прохождение.' }))
        }
      } finally {
        if (!controller.signal.aborted) busy.current = false
      }
    })()
    return () => controller.abort()
  }, [sessionId])

  async function reloadAfterConflict(controller: AbortController, successMessage: string) {
    // Version conflicts mean another request already changed this save. Never replay a
    // local action against an unknown version; refresh first and let the player decide.
    attempt.current = null
    setState((previous) => ({ ...previous, reloadRequired: true, message: 'Обновляем состояние прохождения…' }))
    try {
      const updated = await api.getSession(sessionId, controller.signal)
      if (!controller.signal.aborted) setState((previous) => ({ ...previous, session: updated, phase: 'ready', message: successMessage, error: null, reloadRequired: false }))
    } catch (cause) {
      if (!controller.signal.aborted) setState((previous) => ({ ...previous, phase: 'error', error: isAbort(cause) ? null : errorText(cause), message: 'Перед следующим ходом нужно обновить прохождение.' }))
    }
  }

  async function retry() {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || busy.current) return
    busy.current = true
    setState((previous) => ({ ...previous, checking: true, error: null, message: 'Проверяем нейросеть…' }))
    try {
      const session = !state.session || state.reloadRequired
        ? await api.getSession(sessionId, controller.signal) : state.session
      if (controller.signal.aborted) return
      const providers = await api.providers(controller.signal)
      if (controller.signal.aborted) return
      const available = providers.some((provider) => provider.provider_id === session.provider_id && provider.available && provider.models.includes(session.model_id))
      setState({ session, models: providers.find((provider) => provider.provider_id === session.provider_id)?.models ?? [], checking: false, reloadRequired: false, error: null, phase: available ? 'ready' : 'provider_unavailable', message: available ? 'Готово к следующему ходу.' : 'Нейросеть недоступна' })
    } catch (cause) {
      if (!controller.signal.aborted && !isAbort(cause)) setState((previous) => ({ ...previous, error: errorText(cause), message: 'Проверка не завершена. Повторите попытку.' }))
    } finally {
      if (!controller.signal.aborted) { busy.current = false; setState((previous) => ({ ...previous, checking: false })) }
    }
  }

  async function submit(text: string) {
    const controller = lifetime.current
    const session = state.session
    const value = text.trim()
    if (!session || !controller || controller.signal.aborted || busy.current || state.phase === 'provider_unavailable' || state.reloadRequired || !value) return
    busy.current = true
    // Keep the same request ID on retry so the server can return the committed turn.
    if (!attempt.current || attempt.current.action !== value || attempt.current.expected_state_version !== session.state_version) {
      attempt.current = { action: value, expected_state_version: session.state_version, request_id: crypto.randomUUID() }
    }
    setState((previous) => ({ ...previous, phase: 'submitting', error: null, message: 'Нейросеть продолжает историю…' }))
    try {
      const turn = await api.createTurn(sessionId, attempt.current, controller.signal)
      if (controller.signal.aborted) return
      attempt.current = null
      setAction('')
      setState({ session: { ...session, state_version: turn.state_version, can_rewind: true, latest_turn: turn, visual_state: turn.visual_directive }, models: state.models, phase: 'ready', message: 'Ход сохранён.', error: null, checking: false, reloadRequired: false })
    } catch (cause) {
      if (controller.signal.aborted) return
      if (isAbort(cause)) {
        setState((previous) => ({ ...previous, phase: 'ready', message: 'Готово к следующему ходу.' }))
      } else if (cause instanceof ApiRequestError && cause.status === 409) {
        await reloadAfterConflict(controller, 'Состояние обновлено. Повторите действие.')
      } else {
        const offline = cause instanceof ApiRequestError && (cause.code === 'provider_unavailable' || cause.code === 'model_unavailable')
        setState((previous) => ({ ...previous, phase: offline ? 'provider_unavailable' : 'error', error: errorText(cause), message: offline ? 'Нейросеть недоступна' : 'Последний подтверждённый ход сохранён.' }))
      }
    } finally {
      if (!controller.signal.aborted) busy.current = false
    }
  }

  async function rewind() {
    const controller = lifetime.current
    const session = state.session
    if (!controller || controller.signal.aborted || !session?.can_rewind || busy.current || state.reloadRequired) return
    busy.current = true
    setState((previous) => ({ ...previous, phase: 'rewinding', error: null, message: 'Возвращаемся к предыдущему ходу…' }))
    try {
      const updated = await api.rewind(sessionId, session.state_version, controller.signal)
      if (controller.signal.aborted) return
      attempt.current = null
      setAction('')
      setState({ session: updated, models: state.models, phase: 'ready', message: 'Ход отменён. Можно выбрать другое действие.', error: null, checking: false, reloadRequired: false })
    } catch (cause) {
      if (controller.signal.aborted) return
      if (cause instanceof ApiRequestError && cause.status === 409) {
        await reloadAfterConflict(controller, 'Состояние обновлено.')
      } else if (!isAbort(cause)) {
        setState((previous) => ({ ...previous, phase: 'ready', error: errorText(cause), message: 'Ход не отменён.' }))
      } else {
        setState((previous) => ({ ...previous, phase: 'ready', message: 'Готово к следующему ходу.' }))
      }
    } finally {
      if (!controller.signal.aborted) busy.current = false
    }
  }

  async function changeModel(modelId: string) {
    const controller = lifetime.current
    const session = state.session
    if (!controller || controller.signal.aborted || !session || !state.models.includes(modelId) || busy.current || state.reloadRequired || modelId === session.model_id) return
    busy.current = true
    const previousPhase = state.phase
    setState((previous) => ({ ...previous, phase: 'switching_model', error: null, message: 'Переключаем модель…' }))
    try {
      const updated = await api.changeModel(sessionId, modelId, session.state_version, controller.signal)
      if (controller.signal.aborted) return
      attempt.current = null
      setState((previous) => ({ ...previous, session: updated, phase: 'ready', message: `Модель ${updated.model_id} выбрана.`, error: null, reloadRequired: false }))
    } catch (cause) {
      if (controller.signal.aborted) return
      if (cause instanceof ApiRequestError && cause.status === 409) {
        attempt.current = null
        try {
          const updated = await api.getSession(sessionId, controller.signal)
          if (!controller.signal.aborted) setState((previous) => ({ ...previous, session: updated, phase: previous.models.includes(updated.model_id) ? 'ready' : 'provider_unavailable', error: null, message: 'Состояние обновлено. Выберите модель ещё раз.' }))
        } catch (reloadError) {
          if (!controller.signal.aborted) setState((previous) => ({ ...previous, phase: 'error', error: errorText(reloadError), reloadRequired: true, message: 'Обновите прохождение.' }))
        }
      } else if (!isAbort(cause)) {
        setState((previous) => ({ ...previous, phase: previousPhase, error: errorText(cause), message: 'Модель не изменена.' }))
      } else {
        setState((previous) => ({ ...previous, phase: previousPhase }))
      }
    } finally {
      if (!controller.signal.aborted) busy.current = false
    }
  }

  return { ...state, action, setAction, submit, rewind, changeModel, retry, rewinding: state.phase === 'rewinding', disabled: state.phase === 'loading' || state.phase === 'submitting' || state.phase === 'rewinding' || state.phase === 'switching_model' || state.phase === 'provider_unavailable' || state.checking || state.reloadRequired || !state.session }
}
