import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const root = resolve(import.meta.dirname, '../..')
const output = join(root, 'output', 'playwright')
const runlogs = join(root, '.runlogs')
mkdirSync(runlogs, { recursive: true })
const databasePath = join(runlogs, `e2e-${randomUUID()}.db`)

export default defineConfig({
  testDir: './e2e',
  outputDir: output,
  fullyParallel: false,
  workers: 1,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'uv run --directory apps/api uvicorn tests.fake_ollama:app --host 127.0.0.1 --port 11435',
      cwd: root,
      url: 'http://127.0.0.1:11435/api/tags',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'uv run --directory apps/api uvicorn app.main:app --host 127.0.0.1 --port 8000',
      cwd: root,
      env: {
        DATABASE_PATH: databasePath,
        OLLAMA_BASE_URL: 'http://127.0.0.1:11435',
        OLLAMA_MODEL: 'qwen3:14b-q4_K_M',
      },
      url: 'http://127.0.0.1:8000/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm --prefix apps/web run dev -- --host 127.0.0.1 --port 5173 --strictPort',
      cwd: root,
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
