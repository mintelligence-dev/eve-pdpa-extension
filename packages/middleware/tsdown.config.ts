import { defineConfig } from 'tsdown'

// Web standards only — Request, Response, structuredClone — so the same
// build runs on Node, Vercel Edge, Next.js, Hono, Deno, Bun and Cloudflare
// Workers; Express is reached through types only. platform: 'neutral' keeps node: builtins out.
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
