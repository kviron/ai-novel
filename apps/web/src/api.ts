export type Character = { id?: string; name: string; age: number; personality: string; appearance: string }
export type Turn = { id: string; state_version: number; speaker: string; dialogue: string; narration: string; choices: string[] }
export type Story = {
  id: string; title: string; premise: string; theme_labels: string[]; state_version: number;
  current_scene: string; characters: Character[]; latest_turn: Turn | null
}
export type Job = { id: string; kind: 'character_sheet' | 'sprite' | 'cg'; expression?: string; status: string; stage: string; progress?: number }
export type ProviderStatus = Record<'ollama' | 'comfyui', { available: boolean; detail?: string }>

async function json<T>(request: Promise<Response>): Promise<T> {
  const response = await request
  if (!response.ok) throw new Error((await response.json()).detail ?? `Request failed (${response.status})`)
  return response.json() as Promise<T>
}

export const api = {
  createStory: (body: unknown) => json<Story>(fetch('/api/stories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  createTurn: (storyId: string, body: unknown) => json<Turn>(fetch(`/api/stories/${storyId}/turns`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  jobs: (storyId: string) => json<Job[]>(fetch(`/api/stories/${storyId}/jobs`)),
  providers: () => json<ProviderStatus>(fetch('/health/providers')),
}
