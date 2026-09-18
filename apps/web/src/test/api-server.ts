import { vi } from 'vitest'

type Story = {
  id: string
  slug: string
  title: string
  premise: string
  story_mode: 'hybrid' | 'free'
  recommended_provider_id: string
  recommended_model_id: string
}

type Session = {
  id: string
  state_version: number
  story?: Story
  characters?: unknown[]
  current_scene?: string
  provider_id?: string
  model_id?: string
  latest_turn?: unknown
  visual_state?: { emotion: string; pose: string; outfit: string }
}

type Provider = { provider_id: string; available: boolean; detail: string; models: string[] }

let stories: Story[] = []
let nextSession: Session = { id: 'session-1', state_version: 1 }
let sessions = new Map<string, Session>()
let providers: Provider[] = []
let turns = new Map<string, unknown>()

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function handler(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input)
  const method = input instanceof Request ? input.method : init?.method ?? 'GET'
  const { pathname } = new URL(url, 'http://api.test')

  if (method === 'GET' && pathname === '/api/stories') return json(stories)
  if (method === 'GET' && pathname === '/api/providers') return json(providers)

  const startMatch = pathname.match(/^\/api\/stories\/([^/]+)\/sessions$/)
  if (method === 'POST' && startMatch) {
    const story = stories.find(({ id }) => id === startMatch[1])
    if (!story) return json({ code: 'not_found', detail: 'История не найдена.', retryable: false }, 404)
    const result = { ...nextSession, story, provider_id: story.recommended_provider_id, model_id: story.recommended_model_id }
    sessions.set(result.id, result)
    return json(result, 201)
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/)
  if (method === 'GET' && sessionMatch) {
    const session = sessions.get(sessionMatch[1])
    return session
      ? json(session)
      : json({ code: 'not_found', detail: 'Игровая сессия не найдена.', retryable: false }, 404)
  }

  const turnMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/turns$/)
  if (method === 'POST' && turnMatch) return json(turns.get(turnMatch[1]) ?? {}, 201)

  return json({ code: 'not_found', detail: 'Запрошенный ресурс не найден.', retryable: false }, 404)
}

vi.stubGlobal('fetch', vi.fn(handler))

export const apiServer = {
  listStories(value: Story[]) {
    stories = value
  },
  startSession(value: Session) {
    nextSession = value
  },
  session(value: Session) {
    sessions.set(value.id, value)
  },
  providerSequence(value: Provider[]) {
    providers = value
  },
  providersAvailable(value = true) {
    providers = [{ provider_id: 'ollama', available: value, detail: value ? 'Готово' : 'Недоступно', models: [] }]
  },
  turn(sessionId: string, value: unknown) {
    turns.set(sessionId, value)
  },
  reset() {
    stories = []
    nextSession = { id: 'session-1', state_version: 1 }
    sessions = new Map()
    providers = []
    turns = new Map()
    vi.mocked(fetch).mockClear()
  },
}
