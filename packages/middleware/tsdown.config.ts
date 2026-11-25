import { defineConfig } from 'tsdown'

// Web standards only — Request, Response, structuredClone — so the same
// build runs on Node, Vercel Edge, Next.js, Hono, Deno, Bun and Cloudflare
// Workers; Express is reached through types only. platform: 'neutral' keeps node: builtins out.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  // Both, as core: a project still on require() can use it.
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  failOnWarn: true,
  deps: { neverBundle: ['@eve-pdpa-extension/core'] },
  outExtensions: ({ format }) => ({
    js: format === 'es' ? '.js' : '.cjs',
    dts: format === 'es' ? '.d.ts' : '.d.cts',
  }),
})
