export const routes = {
  novelLibrary: '/',
  characters: '/characters',
  characterDetail: (characterId: string) => `/characters/${encodeURIComponent(characterId)}`,
  settings: '/settings',
  storyPlayer: (sessionId: string) => `/play/${encodeURIComponent(sessionId)}`,
  studio: '/studio',
  studioStoryCharacters: (storyId: string) => `/studio/stories/${encodeURIComponent(storyId)}/characters`,
  studioSession: (sessionId: string) => `/studio/${encodeURIComponent(sessionId)}`,
} as const
