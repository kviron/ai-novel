export const routes = {
  novelLibrary: '/',
  characters: '/characters',
  settings: '/settings',
  storyPlayer: (sessionId: string) => `/play/${encodeURIComponent(sessionId)}`,
  studio: '/studio',
  studioSession: (sessionId: string) => `/studio/${encodeURIComponent(sessionId)}`,
} as const
