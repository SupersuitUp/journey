import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Screens print dates in the machine's zone. One zone for every run, so a test written anywhere
// passes on CI and on the publish run.
process.env.TZ = 'UTC'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    exclude: ['test/consumer/**', 'node_modules/**'],
  },
  resolve: {
    // The consumer app's own modules import the package by name; in tests that name is this source.
    alias: [
      { find: 'server-only', replacement: fileURLToPath(new URL('./test/support/empty.ts', import.meta.url)) },
      { find: /^@supersuit\/journey\/server$/, replacement: fileURLToPath(new URL('./src/server/index.ts', import.meta.url)) },
      { find: /^@supersuit\/journey$/, replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
    ],
  },
})
