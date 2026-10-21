import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // The cli imports core by package name, which resolves to core's dist/.
    // Point it at the source instead, so `pnpm test` with no build tests the
    // code as it is now, not whatever was built last.
    alias: [
      {
        find: /^@eve-pdpa-extension\/core$/,
        replacement: fileURLToPath(new URL('packages/core/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      reporter: ['text', 'lcov'],
    },
  },
})
