export const routes = {
  novelLibrary: '/',
  storyPlayer: (sessionId: string) => `/play/${encodeURIComponent(sessionId)}`,
  studio: '/studio',
  studioSession: (sessionId: string) => `/studio/${encodeURIComponent(sessionId)}`,
} as const
