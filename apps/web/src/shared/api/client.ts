import type {
  ApiError,
  CreateTurnRequest,
  ProviderStatus,
  SessionSummary,
  StartSessionRequest,
  StorySession,
  StoryDetail,
  StorySummary,
  TurnResult,
} from './contracts'

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  baseUrl?: string
  body?: unknown
}

function apiUrl(path: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

function isApiError(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null
    && typeof (value as ApiError).code === 'string'
    && typeof (value as ApiError).detail === 'string'
    && typeof (value as ApiError).retryable === 'boolean'
}

async function readJson(response: Response): Promise<unknown | undefined> {
  if (!response.headers.get('Content-Type')?.includes('application/json')) return undefined
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function isAbortError(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { name?: unknown }).name === 'AbortError'
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { baseUrl = '', body, headers, ...init } = options
  let response: Response

  try {
    response = await fetch(apiUrl(path, baseUrl), {
      ...init,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (cause) {
    if (isAbortError(cause)) throw cause
    throw new ApiRequestError('Не удалось подключиться к серверу. Повторите попытку.', 0, 'network_error', true)
  }

  const payload = await readJson(response)
  if (!response.ok) {
    if (isApiError(payload)) {
      throw new ApiRequestError(payload.detail, response.status, payload.code, payload.retryable)
    }
    throw new ApiRequestError(
      response.status >= 500 ? 'Сервис временно недоступен. Повторите попытку позже.' : 'Не удалось выполнить запрос.',
      response.status,
      'http_error',
      response.status >= 500,
    )
  }

  if (payload === undefined) {
    throw new ApiRequestError('Сервер вернул неожиданный ответ.', response.status, 'invalid_response', false)
  }
  return payload as T
}

export function createApiClient({ baseUrl = '' }: { baseUrl?: string } = {}) {
  return {
    listStories(signal?: AbortSignal) {
      return request<StorySummary[]>('/api/stories', { baseUrl, signal })
    },
    listSessions(kind: 'player' | 'author' = 'player', signal?: AbortSignal) {
      return request<SessionSummary[]>(`/api/sessions?kind=${kind}`, { baseUrl, signal })
    },
    listAutosaves(signal?: AbortSignal) {
      return request<SessionSummary[]>('/api/autosaves', { baseUrl, signal })
    },
    getStory(storyId: string, signal?: AbortSignal) {
      return request<StoryDetail>(`/api/stories/${encodeURIComponent(storyId)}`, { baseUrl, signal })
    },
    startSession(storyId: string, body: StartSessionRequest, signal?: AbortSignal) {
      return request<StorySession>(`/api/stories/${encodeURIComponent(storyId)}/sessions`, {
        baseUrl,
        method: 'POST',
        body,
        signal,
      })
    },
    getSession(sessionId: string, signal?: AbortSignal) {
      return request<StorySession>(`/api/sessions/${encodeURIComponent(sessionId)}`, { baseUrl, signal })
    },
    providers(signal?: AbortSignal) {
      return request<ProviderStatus[]>('/api/providers', { baseUrl, signal })
    },
    createTurn(sessionId: string, body: CreateTurnRequest, signal?: AbortSignal) {
      return request<TurnResult>(`/api/sessions/${encodeURIComponent(sessionId)}/turns`, {
        baseUrl,
        method: 'POST',
        body,
        signal,
      })
    },
    rewind(sessionId: string, expectedStateVersion: number, signal?: AbortSignal) {
      return request<StorySession>(`/api/sessions/${encodeURIComponent(sessionId)}/rewind`, {
        baseUrl,
        method: 'POST',
        body: { expected_state_version: expectedStateVersion },
        signal,
      })
    },
  }
}

export const api = createApiClient()
