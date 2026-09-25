export const routes = {
  novelLibrary: '/',
  characters: '/characters',
  characterNew: '/characters/new',
  characterEdit: (characterId: string) => `/characters/${encodeURIComponent(characterId)}/edit`,
  characterDetail: (characterId: string) => `/characters/${encodeURIComponent(characterId)}`,
  settings: '/settings',
  storyPlayer: (sessionId: string) => `/play/${encodeURIComponent(sessionId)}`,
  storySetup: (storyId: string) => `/stories/${encodeURIComponent(storyId)}/setup`,
  studio: '/studio',
  studioStoryCharacters: (storyId: string) => `/studio/stories/${encodeURIComponent(storyId)}/characters`,
  studioSession: (sessionId: string) => `/studio/${encodeURIComponent(sessionId)}`,
} as const
