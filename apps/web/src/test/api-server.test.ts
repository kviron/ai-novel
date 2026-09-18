import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/shared/api'

import { apiServer } from './api-server'

const offline = { provider_id: 'ollama', available: false, detail: 'Недоступно', models: [] }
const online = { provider_id: 'ollama', available: true, detail: 'Готово', models: ['qwen3:14b-q4_K_M'] }

afterEach(() => apiServer.reset())

test('advances provider status from offline to online and retains the last status', async () => {
  apiServer.providerSequence([offline, online])

  await expect(api.providers()).resolves.toEqual([offline])
  await expect(api.providers()).resolves.toEqual([online])
  await expect(api.providers()).resolves.toEqual([online])
})

test('restores the canonical handler after queued rejection and implementation overrides are reset', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('test override'))
  vi.mocked(fetch).mockImplementationOnce(async () => new Response(JSON.stringify([online]), {
    headers: { 'Content-Type': 'application/json' },
  }))
  apiServer.reset()

  await expect(api.providers()).resolves.toEqual([])
  await expect(api.providers()).resolves.toEqual([])
})
