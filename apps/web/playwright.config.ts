import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const root = resolve(import.meta.dirname, '../..')
const output = join(root, 'output', 'playwright')
const runlogs = join(root, '.runlogs')
mkdirSync(runlogs, { recursive: true })
const databasePath = join(runlogs, `e2e-${randomUUID()}.db`)
const fakePort = Number(process.env.E2E_FAKE_PORT ?? 11435)
const apiPort = Number(process.env.E2E_API_PORT ?? 8000)
const webPort = Number(process.env.E2E_WEB_PORT ?? 5173)

export default defineConfig({
  testDir: './e2e',
  outputDir: output,
  fullyParallel: false,
  workers: 1,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `uv run --directory apps/api uvicorn tests.fake_ollama:app --host 127.0.0.1 --port ${fakePort}`,
      cwd: root,
      url: `http://127.0.0.1:${fakePort}/api/tags`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `uv run --directory apps/api uvicorn app.main:app --host 127.0.0.1 --port ${apiPort}`,
      cwd: root,
      env: {
        DATABASE_PATH: databasePath,
        OLLAMA_BASE_URL: `http://127.0.0.1:${fakePort}`,
        OLLAMA_MODEL: 'qwen3:14b-q4_K_M',
      },
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm --prefix apps/web run dev -- --host 127.0.0.1 --port ${webPort} --strictPort`,
      cwd: root,
      env: { VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
