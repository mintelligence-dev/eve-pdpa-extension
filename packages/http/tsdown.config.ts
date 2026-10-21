import { defineConfig } from 'tsdown'

// Web standards only — Request, Response, fetch, crypto.subtle — so the same
// build runs on Vercel's Node and Edge runtimes, Next.js, Hono, Deno, Bun and
// Cloudflare Workers. platform: 'neutral' keeps node: builtins out.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  failOnWarn: true,
  deps: { neverBundle: ['@eve-pdpa-extension/core'] },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})
