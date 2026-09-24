export const routes = {
  novelLibrary: '/',
  characters: '/characters',
  characterDetail: (storyId: string, characterId: string) => `/characters/${encodeURIComponent(storyId)}/${encodeURIComponent(characterId)}`,
  settings: '/settings',
  storyPlayer: (sessionId: string) => `/play/${encodeURIComponent(sessionId)}`,
  studio: '/studio',
  studioSession: (sessionId: string) => `/studio/${encodeURIComponent(sessionId)}`,
} as const
