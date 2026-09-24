import { vi } from 'vitest'

type Story = {
  id: string
  slug: string
  title: string
  premise: string
  description?: string
  cover_image_url?: string | null
  story_mode: 'hybrid' | 'free'
  recommended_provider_id: string
  recommended_model_id: string
}

type Session = {
  id: string
  state_version: number
  can_rewind?: boolean
  story?: Story
  characters?: unknown[]
  current_scene?: string
  provider_id?: string
  model_id?: string
  latest_turn?: unknown
  visual_state?: { emotion: string; pose: string; outfit: string }
}

type Provider = { provider_id: string; available: boolean; detail: string; models: string[] }
type StartSessionRequest = { provider_id: string; model_id?: string; kind?: 'player' | 'author' }
type Save = { id: string; story: Story; state_version: number; current_scene: string; created_at: string; updated_at: string; kind: 'player' | 'author' }

let stories: Story[] = []
let characters: unknown[] = []
let characterDetails = new Map<string, unknown>()
let failNextCharacterList = false
let storyDetails = new Map<string, Story & { current_scene: string; characters: unknown[] }>()
let failNextStoryList = false
let failNextSaveList = false
let nextSession: Session = { id: 'session-1', state_version: 1 }
let sessions = new Map<string, Session>()
let providerQueue: Provider[] = []
let lastProvider: Provider | null = null
let turns = new Map<string, unknown>()
let lastStartRequest: StartSessionRequest | null = null
let saves: Save[] = []
let rewinds = new Map<string, Session>()
let modelChanges = new Map<string, Session>()

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const body = input instanceof Request ? await input.clone().text() : init?.body
  if (typeof body !== 'string') return undefined
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

function isStartSessionRequest(value: unknown): value is StartSessionRequest {
  return typeof value === 'object' && value !== null && typeof (value as StartSessionRequest).provider_id === 'string'
}

async function handler(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input)
  const method = input instanceof Request ? input.method : init?.method ?? 'GET'
  const { pathname, searchParams } = new URL(url, 'http://api.test')

  if (method === 'GET' && pathname === '/api/characters') {
    if (failNextCharacterList) {
      failNextCharacterList = false
      return json({ code: 'temporarily_unavailable', detail: 'Недоступно', retryable: true }, 503)
    }
    return json(characters)
  }
  if (method === 'POST' && pathname === '/api/characters') {
    const body = await requestBody(input, init) as Record<string, unknown>
    const created = { ...body, id: 'new-v1', character_id: 'new-character', current_revision_id: 'new-v1', revision_number: 1, source_type: 'local', created_at: new Date().toISOString() }
    characters = [...characters, created]
    characterDetails.set('new-character', { id: 'new-character', current_revision_id: 'new-v1', source_type: 'local', revisions: [{ ...body, id: 'new-v1', revision_number: 1, created_at: created.created_at }], linked_stories: [] })
    return json(created, 201)
  }
  if (method === 'POST' && pathname === '/api/characters/generate-field') {
    return json({ text: 'Любит дождь и исследует ночной город.' })
  }
  if (method === 'POST' && /^\/api\/stories\/[^/]+\/characters\/generate-role$/.test(pathname)) {
    return json({ text: 'Союзник героини и хранитель секрета города.' })
  }
  const revisionMatch = pathname.match(/^\/api\/characters\/([^/]+)\/revisions$/)
  if (method === 'POST' && revisionMatch) {
    const characterId = decodeURIComponent(revisionMatch[1])
    const history = characterDetails.get(characterId) as { revisions: unknown[]; linked_stories: unknown[]; source_type: string } | undefined
    if (!history) return json({ code: 'not_found', detail: 'Персонаж не найден.', retryable: false }, 404)
    const body = await requestBody(input, init) as Record<string, unknown>
    const revision = { ...body, id: `${characterId}-v${history.revisions.length + 1}`, revision_number: history.revisions.length + 1, created_at: new Date().toISOString() }
    characterDetails.set(characterId, { ...history, id: characterId, current_revision_id: revision.id, revisions: [revision, ...history.revisions] })
    return json({ ...revision, character_id: characterId, current_revision_id: revision.id, source_type: history.source_type }, 201)
  }
  const characterMatch = pathname.match(/^\/api\/characters\/([^/]+)$/)
  if (method === 'GET' && characterMatch) {
    const detail = characterDetails.get(decodeURIComponent(characterMatch[1]))
    return detail ? json(detail) : json({ code: 'not_found', detail: 'Персонаж не найден.', retryable: false }, 404)
  }

  if (method === 'GET' && pathname === '/api/stories') {
    if (failNextStoryList) {
      failNextStoryList = false
      return json({ code: 'temporarily_unavailable', detail: 'Недоступно', retryable: true }, 503)
    }
    return json(stories)
  }
  if (method === 'GET' && pathname === '/api/sessions') {
    if (failNextSaveList) {
      failNextSaveList = false
      return json({ code: 'temporarily_unavailable', detail: 'Недоступно', retryable: true }, 503)
    }
    return json(saves.filter((save) => save.kind === (searchParams.get('kind') ?? 'player')))
  }
  if (method === 'GET' && pathname === '/api/autosaves') {
    if (failNextSaveList) {
      failNextSaveList = false
      return json({ code: 'temporarily_unavailable', detail: 'Недоступно', retryable: true }, 503)
    }
    const latest = new Map<string, Save>()
    for (const save of saves.filter((item) => item.kind === 'player').sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
      if (!latest.has(save.story.id)) latest.set(save.story.id, save)
    }
    return json([...latest.values()])
  }
  const storyMatch = pathname.match(/^\/api\/stories\/([^/]+)$/)
  if (method === 'GET' && storyMatch) {
    const story = storyDetails.get(decodeURIComponent(storyMatch[1]))
    return story ? json(story) : json({ code: 'not_found', detail: 'История не найдена.', retryable: false }, 404)
  }
  const castMatch = pathname.match(/^\/api\/stories\/([^/]+)\/characters(?:\/([^/]+))?$/)
  if (castMatch && (method === 'POST' || method === 'PUT')) {
    const storyId = decodeURIComponent(castMatch[1])
    const story = storyDetails.get(storyId)
    if (!story) return json({ code: 'not_found', detail: 'История не найдена.', retryable: false }, 404)
    const body = await requestBody(input, init) as { character_id?: string; revision_id: string; role: string }
    const characterId = castMatch[2] ? decodeURIComponent(castMatch[2]) : body.character_id ?? ''
    const history = characterDetails.get(characterId) as { revisions: { id: string; revision_number: number; name: string }[]; linked_stories: { story_id: string; story_title: string; story_slug: string; revision_id: string; revision_number: number; role: string }[] } | undefined
    const revision = history?.revisions.find((item) => item.id === body.revision_id)
    if (!history || !revision) return json({ code: 'validation_error', detail: 'Ревизия не найдена.', retryable: false }, 422)
    history.linked_stories = [...history.linked_stories.filter((link) => link.story_id !== storyId), { story_id: storyId, story_title: story.title, story_slug: story.slug, revision_id: revision.id, revision_number: revision.revision_number, role: body.role }]
    story.characters = [...story.characters.filter((item) => (item as { id: string }).id !== characterId), { ...revision, id: characterId, visual_profile_version: revision.revision_number }]
    return json({ story_id: storyId, character_id: characterId, revision_id: revision.id, role: body.role }, method === 'POST' ? 201 : 200)
  }
  if (method === 'GET' && pathname === '/api/providers') {
    lastProvider = providerQueue.shift() ?? lastProvider
    return json(lastProvider ? [lastProvider] : [])
  }

  const startMatch = pathname.match(/^\/api\/stories\/([^/]+)\/sessions$/)
  if (method === 'POST' && startMatch) {
    const story = stories.find(({ id }) => id === startMatch[1])
    if (!story) return json({ code: 'not_found', detail: 'История не найдена.', retryable: false }, 404)
    const body = await requestBody(input, init)
    if (!isStartSessionRequest(body)) {
      lastStartRequest = null
      return json({ code: 'validation_error', detail: 'Передайте провайдер и модель.', retryable: false }, 422)
    }
    lastStartRequest = body
    const configuredModel = nextSession.model_id ?? story.recommended_model_id
    if (body.provider_id !== story.recommended_provider_id || (body.model_id && body.model_id !== configuredModel)) {
      return json({ code: 'validation_error', detail: 'Используйте настроенные провайдер и модель.', retryable: false }, 422)
    }
    const result = { can_rewind: false, ...nextSession, story, provider_id: story.recommended_provider_id, model_id: configuredModel }
    sessions.set(result.id, result)
    saves = [{ id: result.id, story, state_version: result.state_version, current_scene: result.current_scene ?? 'Ночной перекрёсток', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), kind: body.kind ?? 'player' }, ...saves]
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

  const rewindMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/rewind$/)
  if (method === 'POST' && rewindMatch) return json(rewinds.get(rewindMatch[1]) ?? {}, 200)

  const modelMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/model$/)
  if (method === 'POST' && modelMatch) return json(modelChanges.get(modelMatch[1]) ?? {}, 200)

  return json({ code: 'not_found', detail: 'Запрошенный ресурс не найден.', retryable: false }, 404)
}

vi.stubGlobal('fetch', vi.fn(handler))

export const apiServer = {
  listCharacters(value: unknown[]) { characters = value },
  characterDetail(id: string, value: unknown) { characterDetails.set(id, value) },
  failCharacterListOnce() { failNextCharacterList = true },
  listStories(value: Story[]) {
    stories = value
  },
  storyDetail(id: string, value: Story & { current_scene: string; characters: unknown[] }) {
    storyDetails.set(id, value)
  },
  failStoryListOnce() { failNextStoryList = true },
  failSaveListOnce() { failNextSaveList = true },
  startSession(value: Session) {
    nextSession = value
  },
  session(value: Session) {
    sessions.set(value.id, value)
  },
  savedSessions(value: Save[]) { saves = value },
  providerSequence(value: Provider[]) {
    providerQueue = [...value]
    lastProvider = null
  },
  providersAvailable(value = true, models = ['qwen3:14b-q4_K_M']) {
    providerQueue = [{ provider_id: 'ollama', available: value, detail: value ? 'Готово' : 'Недоступно', models: value ? [...models] : [] }]
    lastProvider = null
  },
  turn(sessionId: string, value: unknown) {
    turns.set(sessionId, value)
  },
  rewind(sessionId: string, value: Session) { rewinds.set(sessionId, value) },
  modelSwitch(sessionId: string, value: Session) { modelChanges.set(sessionId, value) },
  lastStartSessionRequest() {
    return lastStartRequest
  },
  reset() {
    stories = []
    characters = []
    characterDetails = new Map()
    failNextCharacterList = false
    storyDetails = new Map()
    failNextStoryList = false
    failNextSaveList = false
    nextSession = { id: 'session-1', state_version: 1 }
    sessions = new Map()
    providerQueue = []
    lastProvider = null
    turns = new Map()
    lastStartRequest = null
    saves = []
    rewinds = new Map()
    modelChanges = new Map()
    vi.mocked(fetch).mockReset()
    vi.mocked(fetch).mockImplementation(handler)
  },
}
