import { vi } from 'vitest'

import type { DraftDiagnostic, StoryDraft } from '@/shared/api/contracts'

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
  protagonist?: unknown
}

type Provider = { provider_id: string; available: boolean; detail: string; models: string[] }
type StartSessionRequest = { provider_id: string; model_id?: string; kind?: 'player' | 'author'; hero?: unknown }
type Setup = { story_id: string; policy: 'fixed' | 'choice'; policy_version: number; allowed_sources: ('catalog' | 'draft')[]; playable_character_ids: string[]; fixed_hero: unknown }
type Save = { id: string; story: Story; state_version: number; current_scene: string; created_at: string; updated_at: string; kind: 'player' | 'author' }

let stories: Story[] = []
let characters: unknown[] = []
let characterDetails = new Map<string, unknown>()
let failNextCharacterList = false
let storyDetails = new Map<string, Story & { current_scene: string; characters: unknown[] }>()
let storySetups = new Map<string, Setup>()
let failNextStoryList = false
let failNextSaveList = false
let nextSession: Session = { id: 'session-1', state_version: 1 }
let sessions = new Map<string, Session>()
let providerQueue: Provider[] = []
let lastProvider: Provider | null = null
let turns = new Map<string, unknown>()
let dialogueHistories = new Map<string, unknown[]>()
let lastStartRequest: StartSessionRequest | null = null
let lastHeroSave: unknown = null
let saves: Save[] = []
let rewinds = new Map<string, Session>()
let modelChanges = new Map<string, Session>()
let activeStoryDrafts = new Map<string, StoryDraft>()
let publishedStoryVersions = new Map<string, Map<string, StoryDraft>>()
let nextStoryNumber = 1
let failNextDraftCreation = false
let failNextSectionSave = false
let authoringRequestLog: { method: string; path: string; body: unknown }[] = []
let lastSectionRequest: { storyId: string; section: string; expected_revision: number; data: unknown } | null = null
let nextDraftDiagnostics: DraftDiagnostic[] = []
let lastCoverUpload: { storyId: string; mimeType: string; size: number; filename: string; creator: string; license: string; source: string } | null = null

function defaultStoryDraft(storyId = 'story-1'): StoryDraft {
  return {
    story_id: storyId,
    version_id: `${storyId}-draft-v1`,
    version_number: 1,
    status: 'draft',
    draft_revision: 1,
    based_on_version_id: null,
    rules_version: 1,
    created_at: '2026-09-27T00:00:00Z',
    published_at: null,
    identity: {
      title: '', slug: '', short_description: '', premise: '', cover_material_id: null,
      genres: [], tone: [], setting: '', opening_situation: '', content_rating: 'adult_18_plus',
    },
    mode: { mode: 'freeform' },
    hero: { hero_policy: 'choice', hero_allowed_sources: ['catalog', 'draft'], fixed_hero_revision_id: null },
    cast: { characters: [] },
    rules: {
      themes_allowed: [], themes_blocked: [], ending_policy: 'open_ended',
      generation_policy: {
        narration_perspective: 'second_person', prose_density: 'balanced', choice_policy: 'choices_and_free_input',
        min_choices: 2, max_choices: 4, allow_romance: true, allow_violence: true, allow_horror: true,
        allow_sexual_themes: false, desired_themes: '', forbidden_outcomes: '',
      },
      recommended_provider_id: 'ollama', recommended_model_id: 'qwen3:14b-q4_K_M',
    },
    canon: { creative_goals: '', facts: [], beats: [] },
    character_revisions: [], diagnostics: [],
  }
}

type StoryDraftSeed = Omit<Partial<StoryDraft>, 'identity'> & { identity?: Partial<StoryDraft['identity']> }

function mergeDraftSeed(seed: StoryDraftSeed): StoryDraft {
  const base = defaultStoryDraft(seed.story_id)
  return { ...base, ...seed, identity: { ...base.identity, ...seed.identity } }
}

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

  if (pathname.startsWith('/api/author/stories')) {
    const body = await requestBody(input, init)
    authoringRequestLog.push({ method, path: pathname, body })
    if (method === 'POST' && pathname === '/api/author/stories') {
      if (failNextDraftCreation) {
        failNextDraftCreation = false
        return json({ code: 'temporarily_unavailable', detail: 'Не удалось создать черновик.', retryable: true }, 503)
      }
      const storyId = `story-${nextStoryNumber++}`
      const created = mergeDraftSeed({
        story_id: storyId,
        identity: body && typeof body === 'object' ? body as Partial<StoryDraft['identity']> : {},
      })
      activeStoryDrafts.set(created.story_id, created)
      return json(created, 201)
    }
    const draftMatch = pathname.match(/^\/api\/author\/stories\/([^/]+)\/draft$/)
    if (method === 'GET' && draftMatch) {
      const draft = activeStoryDrafts.get(decodeURIComponent(draftMatch[1]))
      return draft ? json(draft) : json({ code: 'story_not_found', detail: 'История или версия не найдена.', retryable: false }, 404)
    }
    const sectionMatch = pathname.match(/^\/api\/author\/stories\/([^/]+)\/draft\/(identity|mode|hero|cast|rules|canon)$/)
    if (method === 'PUT' && sectionMatch) {
      const storyId = decodeURIComponent(sectionMatch[1])
      const section = sectionMatch[2] as keyof Pick<StoryDraft, 'identity' | 'mode' | 'hero' | 'cast' | 'rules' | 'canon'>
      const request = body as { expected_revision: number; data: StoryDraft[typeof section] }
      lastSectionRequest = { storyId, section, expected_revision: request.expected_revision, data: request.data }
      if (failNextSectionSave) {
        failNextSectionSave = false
        return json({ code: 'temporarily_unavailable', detail: 'Не удалось сохранить раздел. Повторите попытку.', retryable: true }, 503)
      }
      const draft = activeStoryDrafts.get(storyId)
      if (!draft) return json({ code: 'story_not_found', detail: 'История или версия не найдена.', retryable: false }, 404)
      if (request.expected_revision !== draft.draft_revision) {
        return json({
          code: 'draft_conflict', detail: 'Черновик был изменён. Обновите его и повторите сохранение.',
          retryable: false, latest_revision: draft.draft_revision,
        }, 409)
      }
      const updated = { ...draft, [section]: request.data, draft_revision: draft.draft_revision + 1 }
      activeStoryDrafts.set(storyId, updated)
      return json(updated)
    }
    const validateMatch = pathname.match(/^\/api\/author\/stories\/([^/]+)\/validate$/)
    if (method === 'POST' && validateMatch) {
      const storyId = decodeURIComponent(validateMatch[1])
      if (!activeStoryDrafts.has(storyId)) return json({ code: 'story_not_found', detail: 'История или версия не найдена.', retryable: false }, 404)
      return json({ valid: !nextDraftDiagnostics.some(({ severity }) => severity === 'error'), diagnostics: nextDraftDiagnostics })
    }
    const publishMatch = pathname.match(/^\/api\/author\/stories\/([^/]+)\/publish$/)
    if (method === 'POST' && publishMatch) {
      const storyId = decodeURIComponent(publishMatch[1])
      const draft = activeStoryDrafts.get(storyId)
      if (!draft) return json({ code: 'story_not_found', detail: 'История или версия не найдена.', retryable: false }, 404)
      if (nextDraftDiagnostics.some(({ severity }) => severity === 'error')) {
        return json({ code: 'draft_invalid', detail: 'Исправьте ошибки черновика перед продолжением.', retryable: false, diagnostics: nextDraftDiagnostics }, 422)
      }
      const published = { ...draft, status: 'published' as const, published_at: '2026-09-27T01:00:00Z' }
      activeStoryDrafts.delete(storyId)
      const versions = publishedStoryVersions.get(storyId) ?? new Map<string, StoryDraft>()
      versions.set(published.version_id, published)
      publishedStoryVersions.set(storyId, versions)
      return json(published)
    }
    const testMatch = pathname.match(/^\/api\/author\/stories\/([^/]+)\/test-sessions$/)
    if (method === 'POST' && testMatch) {
      const storyId = decodeURIComponent(testMatch[1])
      const draft = activeStoryDrafts.get(storyId)
      if (!draft) return json({ code: 'story_not_found', detail: 'История или версия не найдена.', retryable: false }, 404)
      if (nextDraftDiagnostics.some(({ severity }) => severity === 'error')) {
        return json({ code: 'draft_invalid', detail: 'Исправьте ошибки черновика перед продолжением.', retryable: false, diagnostics: nextDraftDiagnostics }, 422)
      }
      const createdSession = { ...nextSession, id: nextSession.id, state_version: nextSession.state_version }
      sessions.set(createdSession.id, createdSession)
      return json(createdSession, 201)
    }
    const cloneMatch = pathname.match(/^\/api\/author\/stories\/([^/]+)\/draft-from\/([^/]+)$/)
    if (method === 'POST' && cloneMatch) {
      const storyId = decodeURIComponent(cloneMatch[1])
      const versionId = decodeURIComponent(cloneMatch[2])
      const source = publishedStoryVersions.get(storyId)?.get(versionId)
      if (!source) return json({ code: 'version_not_found', detail: 'История или версия не найдена.', retryable: false }, 404)
      const active = activeStoryDrafts.get(storyId)
      if (active) return json({
        code: 'draft_conflict', detail: 'Черновик был изменён. Обновите его и повторите сохранение.',
        retryable: false, latest_revision: active.draft_revision,
      }, 409)
      const versionNumber = Math.max(...[...publishedStoryVersions.get(storyId)!.values()].map(({ version_number }) => version_number)) + 1
      const cloned = {
        ...source, status: 'draft' as const, version_id: `${storyId}-draft-v${versionNumber}`,
        version_number: versionNumber, based_on_version_id: source.version_id, published_at: null, draft_revision: 1,
      }
      activeStoryDrafts.set(storyId, cloned)
      return json(cloned, 201)
    }
    const coverMatch = pathname.match(/^\/api\/author\/stories\/([^/]+)\/draft\/cover$/)
    if (method === 'POST' && coverMatch) {
      const storyId = decodeURIComponent(coverMatch[1])
      if (!activeStoryDrafts.has(storyId)) return json({ code: 'story_not_found', detail: 'История или версия не найдена.', retryable: false }, 404)
      const blob = input instanceof Request ? await input.clone().blob() : init?.body
      const headers = input instanceof Request ? input.headers : new Headers(init?.headers)
      const mimeType = blob instanceof Blob && blob.type ? blob.type : headers.get('Content-Type') ?? ''
      const filename = searchParams.get('filename') ?? ''
      const creator = searchParams.get('creator') ?? ''
      const license = searchParams.get('license') ?? ''
      const source = searchParams.get('source') ?? ''
      if (!(blob instanceof Blob) || blob.size === 0 || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) || !filename || !creator || !license || !source) {
        return json({ code: 'invalid_material', detail: 'Нужна обложка PNG, JPEG или WebP и сведения об авторстве.', retryable: false }, 422)
      }
      lastCoverUpload = { storyId, mimeType, size: blob.size, filename, creator, license, source }
      return json({ id: 'cover-1', sha256: 'cover-sha', mime_type: mimeType, filename, creator, license, source }, 201)
    }
  }

  const publishedVersionMatch = pathname.match(/^\/api\/stories\/([^/]+)\/versions\/([^/]+)$/)
  if (method === 'GET' && publishedVersionMatch) {
    const version = publishedStoryVersions
      .get(decodeURIComponent(publishedVersionMatch[1]))
      ?.get(decodeURIComponent(publishedVersionMatch[2]))
    return version ? json(version) : json({ code: 'version_not_found', detail: 'История или версия не найдена.', retryable: false }, 404)
  }

  if (method === 'GET' && pathname === '/api/characters') {
    if (failNextCharacterList) {
      failNextCharacterList = false
      return json({ code: 'temporarily_unavailable', detail: 'Недоступно', retryable: true }, 503)
    }
    const excludeStoryId = searchParams.get('exclude_story_id')
    return json(excludeStoryId ? characters.filter((item) => !(characterDetails.get((item as { id: string }).id) as { linked_stories?: { story_id: string }[] } | undefined)?.linked_stories?.some((link) => link.story_id === excludeStoryId)) : characters)
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
  const extractionMatch = pathname.match(/^\/api\/sessions\/[^/]+\/characters\/([^/]+)\/extract$/)
  if (method === 'POST' && extractionMatch) {
    const original = characters.find((item) => (item as { id?: string }).id === extractionMatch[1]) as Record<string, unknown> | undefined
    return json({ ...original, id: 'extracted-1', name: original?.name ?? 'Аканэ', source_type: 'extracted' }, 201)
  }
  if (method === 'POST' && /^\/api\/sessions\/[^/]+\/protagonist\/save-to-catalog$/.test(pathname)) {
    lastHeroSave = await requestBody(input, init)
    return json({ character_id: 'hero-saved', name: 'Лена' }, 201)
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
  const setupMatch = pathname.match(/^\/api\/stories\/([^/]+)\/setup$/)
  if (method === 'GET' && setupMatch) {
    const setup = storySetups.get(decodeURIComponent(setupMatch[1]))
    return setup ? json(setup) : json({ code: 'not_found', detail: 'Настройка не найдена.', retryable: false }, 404)
  }
  const castMatch = pathname.match(/^\/api\/stories\/([^/]+)\/characters(?:\/([^/]+))?$/)
  const batchMatch = pathname.match(/^\/api\/stories\/([^/]+)\/characters\/batch$/)
  if (method === 'POST' && batchMatch) {
    const story = storyDetails.get(batchMatch[1])
    if (!story) return json({ code: 'not_found', detail: 'История не найдена.', retryable: false }, 404)
    const body = await requestBody(input, init) as { character_ids: string[] }
    const links = body.character_ids.map((id) => {
      const member = characters.find((item) => (item as { id: string }).id === id) as { id: string; name: string; current_revision_id: string; revision_number: number } | undefined
      if (!member) return null
      story.characters.push({ ...member, color: '#D9A75F' })
      return { story_id: story.id, character_id: id, revision_id: member.current_revision_id, role: 'cast', color: '#D9A75F' }
    })
    return links.includes(null) ? json({ code: 'not_found', detail: 'Персонаж не найден.', retryable: false }, 404) : json(links, 201)
  }
  if (method === 'DELETE' && castMatch?.[2]) {
    const story = storyDetails.get(castMatch[1])
    if (!story) return json({ code: 'not_found', detail: 'История не найдена.', retryable: false }, 404)
    story.characters = story.characters.filter((item) => (item as { id: string }).id !== castMatch[2])
    return new Response(null, { status: 204 })
  }
  if (castMatch && (method === 'POST' || method === 'PUT')) {
    const storyId = decodeURIComponent(castMatch[1])
    const story = storyDetails.get(storyId)
    if (!story) return json({ code: 'not_found', detail: 'История не найдена.', retryable: false }, 404)
    const body = await requestBody(input, init) as { character_id?: string; revision_id: string; role: string; color?: string }
    const characterId = castMatch[2] ? decodeURIComponent(castMatch[2]) : body.character_id ?? ''
    const history = characterDetails.get(characterId) as { revisions: { id: string; revision_number: number; name: string }[]; linked_stories: { story_id: string; story_title: string; story_slug: string; revision_id: string; revision_number: number; role: string; color?: string }[] } | undefined
    const revision = history?.revisions.find((item) => item.id === body.revision_id)
    if (!history || !revision) return json({ code: 'validation_error', detail: 'Ревизия не найдена.', retryable: false }, 422)
    history.linked_stories = [...history.linked_stories.filter((link) => link.story_id !== storyId), { story_id: storyId, story_title: story.title, story_slug: story.slug, revision_id: revision.id, revision_number: revision.revision_number, role: body.role, color: body.color ?? '#D9A75F' }]
    story.characters = [...story.characters.filter((item) => (item as { id: string }).id !== characterId), { ...revision, id: characterId, role: body.role, color: body.color ?? '#D9A75F', visual_profile_version: revision.revision_number }]
    return json({ story_id: storyId, character_id: characterId, revision_id: revision.id, role: body.role, color: body.color ?? '#D9A75F' }, method === 'POST' ? 201 : 200)
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

  const historyMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/dialogue-history$/)
  if (method === 'GET' && historyMatch) return json(dialogueHistories.get(historyMatch[1]) ?? [])

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
  storySetup(id: string, value: Setup) { storySetups.set(id, value) },
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
    dialogueHistory(sessionId: string, value: unknown[]) { dialogueHistories.set(sessionId, value) },
  rewind(sessionId: string, value: Session) { rewinds.set(sessionId, value) },
  modelSwitch(sessionId: string, value: Session) { modelChanges.set(sessionId, value) },
  lastStartSessionRequest() {
    return lastStartRequest
  },
  lastHeroSaveRequest() { return lastHeroSave },
  storyDraft(seed: StoryDraftSeed) {
    const draft = mergeDraftSeed(seed)
    activeStoryDrafts.set(draft.story_id, draft)
  },
  draftDiagnostics(value: DraftDiagnostic[]) { nextDraftDiagnostics = value },
  failDraftCreationOnce() { failNextDraftCreation = true },
  failSectionSaveOnce() { failNextSectionSave = true },
  authoringRequests() { return authoringRequestLog },
  lastAuthoringSectionRequest() { return lastSectionRequest },
  lastCoverUploadRequest() { return lastCoverUpload },
  reset() {
    stories = []
    characters = []
    characterDetails = new Map()
    failNextCharacterList = false
    storyDetails = new Map()
    storySetups = new Map()
    failNextStoryList = false
    failNextSaveList = false
    nextSession = { id: 'session-1', state_version: 1 }
    sessions = new Map()
    providerQueue = []
    lastProvider = null
      turns = new Map()
      dialogueHistories = new Map()
    lastStartRequest = null
    lastHeroSave = null
    saves = []
    rewinds = new Map()
    modelChanges = new Map()
    activeStoryDrafts = new Map()
    publishedStoryVersions = new Map()
    nextStoryNumber = 1
    failNextDraftCreation = false
    failNextSectionSave = false
    authoringRequestLog = []
    lastSectionRequest = null
    nextDraftDiagnostics = []
    lastCoverUpload = null
    vi.mocked(fetch).mockReset()
    vi.mocked(fetch).mockImplementation(handler)
  },
}
