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
  role?: string
  color?: string
  visual_profile_version: number
  sprite_contract_version?: number
  sprites?: Record<string, SpriteVariant[]>
}

export type CharacterRevision = Omit<Character, 'visual_profile_version' | 'role'> & {
  revision_number: number
  biography: string
  speech: string
  created_at: string
  avatar?: CharacterMaterial | null
  cover?: CharacterMaterial | null
}

export type CharacterMaterial = {
  id: string
  kind: string
  sha256: string
  mime_type: string
  filename: string
  creator: string
  license: string
  source: string
  url: string
}

export type SpriteVariant = { variant: string; material: CharacterMaterial }

export type CatalogCharacter = CharacterRevision & {
  character_id: string
  current_revision_id: string
  source_type: string
  origin_character_id?: string | null
}

export type CharacterHistory = {
  id: string
  current_revision_id: string
  source_type: string
  origin_character_id?: string | null
  revisions: CharacterRevision[]
  linked_stories: { story_id: string; story_title: string; story_slug: string; revision_id: string; revision_number: number; role: string; color?: string }[]
}

export type CharacterWrite = Pick<CharacterRevision, 'name' | 'gender' | 'age' | 'personality' | 'appearance' | 'biography' | 'speech'>

export type CharacterTextField = 'personality' | 'appearance' | 'biography' | 'speech'

export type StoryCharacterLink = { story_id: string; character_id: string; revision_id: string; role: string; color: string }

export type SceneSegment = { kind: 'narration' | 'dialogue'; text: string; character_id?: string | null }

export type StoryDetail = StorySummary & {
  current_scene: string
  characters: Character[]
}

export type StorySetup = {
  story_id: string
  policy: 'fixed' | 'choice'
  policy_version: number
  allowed_sources: ('catalog' | 'draft')[]
  playable_character_ids: string[]
  fixed_hero: (Character & { biography: string }) | null
}

export type HeroChoice =
  | { source_kind: 'fixed' }
  | { source_kind: 'catalog'; character_id: string; revision_id: string }
  | { source_kind: 'draft'; name: string; address: string | null; gender: 'female' | 'male' | 'unspecified'; appearance: string; biography: string }

export type Protagonist = {
  session_id: string
  source_kind: 'fixed' | 'catalog' | 'draft' | 'legacy'
  source_character_id: string | null
  source_revision_id: string | null
  policy_version: number
  name: string
  address: string
  gender: string
  appearance: string
  biography: string
  personality: string
  age: number | null
}

export type VisualDirective = {
  mode?: 'sprite_scene'
  character_id: string
  emotion: string
  pose: string
  outfit: string
  background: string
  present_character_ids?: string[]
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
  segments?: SceneSegment[]
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
  segments?: SceneSegment[]
  choices: string[]
  visual_directive: VisualDirective
}

export type StorySession = {
  id: string
  story: StorySummary
  characters: Character[]
  protagonist: Protagonist
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

export type ModelProfile = {
  provider_id: string
  model_id: string
  usable: boolean
  native_window?: number
  working_window?: number
}

export type ApiError = {
  code: string
  detail: string
  retryable: boolean
}

export type StoryIdentitySection = {
  title: string
  slug: string
  short_description: string
  premise: string
  cover_material_id: string | null
  genres: string[]
  tone: string[]
  setting: string
  opening_situation: string
  content_rating: 'adult_18_plus'
}

export type StoryModeSection = { mode: 'freeform' | 'hybrid' }

export type StoryHeroSection = {
  hero_policy: 'fixed' | 'choice'
  hero_allowed_sources: ('catalog' | 'draft')[]
  fixed_hero_revision_id: string | null
}

export type StoryDraftCastMember = {
  id: string
  character_id: string
  revision_id: string
  order_index: number
  role: string
  color: string
  playable: boolean
}

export type StoryCastSection = { characters: StoryDraftCastMember[] }

export type StoryGenerationPolicy = {
  narration_perspective: 'first_person' | 'second_person' | 'third_person'
  prose_density: 'concise' | 'balanced' | 'detailed'
  choice_policy: 'choices_and_free_input' | 'choices_only' | 'free_input_only'
  min_choices: number
  max_choices: number
  allow_romance: boolean
  allow_violence: boolean
  allow_horror: boolean
  allow_sexual_themes: boolean
  desired_themes: string
  forbidden_outcomes: string
}

export type StoryRulesSection = {
  themes_allowed: string[]
  themes_blocked: string[]
  ending_policy: 'open_ended' | 'model_may_end' | 'required_beats_then_end'
  generation_policy: StoryGenerationPolicy
  recommended_provider_id: string
  recommended_model_id: string
}

export type StoryBeatCondition =
  | { kind: 'always' }
  | { kind: 'after_turn_count'; turn_count: number }
  | { kind: 'after_beat'; beat_id: string }

export type StoryCanonFact = {
  id: string
  order_index: number
  title: string
  statement: string
  severity: 'hard' | 'soft'
  scope: 'world' | 'character' | 'relationship' | 'plot'
  referenced_character_ids: string[]
}

export type StoryBeat = {
  id: string
  order_index: number
  title: string
  description: string
  activation_condition: StoryBeatCondition
  completion_evidence: string
  required: boolean
  ending_gate: boolean
}

export type StoryCanonSection = {
  creative_goals: string
  facts: StoryCanonFact[]
  beats: StoryBeat[]
}

export type DraftDiagnostic = {
  code: string
  severity: 'error' | 'warning'
  step: 'identity' | 'mode' | 'hero' | 'cast' | 'rules' | 'canon' | 'review'
  field: string
  item_id: string | null
  message: string
}

export type DraftValidationResult = { valid: boolean; diagnostics: DraftDiagnostic[] }

export type CharacterRevisionSnapshot = {
  id: string
  character_id: string
  revision_number: number
  name: string
  gender: string
  age: number
  personality: string
  appearance: string
  biography: string
  speech: string
  role: string
}

export type StoryDraft = {
  story_id: string
  version_id: string
  version_number: number
  status: 'draft' | 'published'
  draft_revision: number
  based_on_version_id: string | null
  rules_version: number
  created_at: string
  published_at: string | null
  identity: StoryIdentitySection
  mode: StoryModeSection
  hero: StoryHeroSection
  cast: StoryCastSection
  rules: StoryRulesSection
  canon: StoryCanonSection
  character_revisions: CharacterRevisionSnapshot[]
  diagnostics: DraftDiagnostic[]
}

export type StoryDraftSectionMap = {
  identity: StoryIdentitySection
  mode: StoryModeSection
  hero: StoryHeroSection
  cast: StoryCastSection
  rules: StoryRulesSection
  canon: StoryCanonSection
}

export type StoryDraftSectionName = keyof StoryDraftSectionMap

export type SaveStoryDraftSectionRequest<K extends StoryDraftSectionName> = {
  expected_revision: number
  data: StoryDraftSectionMap[K]
}

export type DraftInvalidResponse = ApiError & { diagnostics: DraftDiagnostic[] }
export type DraftConflictResponse = ApiError & { latest_revision: number }

export type StoryCoverMaterial = {
  id: string
  sha256: string
  mime_type: string
  filename: string
  creator: string
  license: string
  source: string
}

export type AuthorTestSessionRequest = {
  provider_id?: string
  model_id?: string | null
  hero?: HeroChoice | null
}

export type StartSessionRequest = {
  provider_id: string
  model_id?: string
  kind?: 'player' | 'author'
  hero?: HeroChoice
}

export type CreateTurnRequest = {
  request_id: string
  expected_state_version: number
  action: string
}
