import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': `${import.meta.dirname}/src` } },
  server: { proxy: { '/api': process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000', '/health': process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000' } },
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'jsdom', setupFiles: './src/test/setup.ts' },
})
