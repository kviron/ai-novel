export type StorySummary = {
  id: string
  slug: string
  title: string
  premise: string
  description: string
  cover_image_url: string | null
  story_mode: 'hybrid' | 'free'
  recommended_provider_id: string
  recommended_model_id: string
}

export type Character = {
  id: string
  name: string
  gender: 'female' | 'male' | 'unspecified'
  age: number
  personality: string
  appearance: string
  visual_profile_version: number
}

export type CharacterRevision = Omit<Character, 'visual_profile_version'> & {
  revision_number: number
  biography: string
  speech: string
  role: string
  created_at: string
}

export type CatalogCharacter = CharacterRevision & {
  character_id: string
  current_revision_id: string
  source_type: string
}

export type CharacterHistory = {
  id: string
  current_revision_id: string
  source_type: string
  revisions: CharacterRevision[]
  linked_stories: { story_id: string; story_title: string; story_slug: string; revision_id: string; revision_number: number }[]
}

export type StoryDetail = StorySummary & {
  current_scene: string
  characters: Character[]
}

export type VisualDirective = {
  mode: 'sprite_scene'
  character_id: string
  emotion: string
  pose: string
  outfit: string
  background: string
}

export type TurnResult = {
  id: string
  session_id: string
  request_id: string
  state_version: number
  action: string
  speaker: string
  narration: string
  dialogue: string
  choices: string[]
  visual_directive: VisualDirective
  provider_id: string
  model_id: string
  prompt_version: string
  created_at: string
}

export type SessionTurn = {
  id: string
  state_version: number
  action: string
  prompt_version: string
  speaker: string
  narration: string
  dialogue: string
  choices: string[]
  visual_directive: Record<string, string>
}

export type StorySession = {
  id: string
  story: StorySummary
  characters: Character[]
  state_version: number
  can_rewind: boolean
  current_scene: string
  provider_id: string
  model_id: string
  latest_turn: SessionTurn | null
  visual_state: { emotion: string; pose: string; outfit: string; background: string }
}

export type SessionSummary = {
  id: string
  story: StorySummary
  state_version: number
  current_scene: string
  created_at: string
  updated_at: string
}

export type ProviderStatus = {
  provider_id: string
  available: boolean
  detail: string
  models: string[]
}

export type ApiError = {
  code: string
  detail: string
  retryable: boolean
}

export type StartSessionRequest = {
  provider_id: string
  model_id?: string
  kind?: 'player' | 'author'
}

export type CreateTurnRequest = {
  request_id: string
  expected_state_version: number
  action: string
}
