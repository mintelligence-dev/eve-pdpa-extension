import { defineConfig } from 'tsdown'

// Node-only, so none of core's constraints apply here. It may have
// dependencies and it may use node: builtins.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  dts: true,
  clean: true,
  deps: { neverBundle: ['@thai-pdpa-guard/core'] },
  // The package is type: module, so .js is already ESM. Keep the extension
  // explicit so package.json "bin" cannot drift from what is emitted.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})
