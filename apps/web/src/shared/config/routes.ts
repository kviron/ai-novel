export const routes = {
  novelLibrary: '/',
  characters: '/characters',
  storyPlayer: (sessionId: string) => `/play/${encodeURIComponent(sessionId)}`,
  studio: '/studio',
  studioSession: (sessionId: string) => `/studio/${encodeURIComponent(sessionId)}`,
} as const
