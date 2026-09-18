export const routes = {
  novelLibrary: '/',
  storyPlayer: (sessionId: string) => `/play/${encodeURIComponent(sessionId)}`,
} as const
