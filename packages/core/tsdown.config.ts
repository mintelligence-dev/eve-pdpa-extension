import { defineConfig } from 'tsdown'

const entry = ['src/index.ts', 'src/data/index.ts']

export default defineConfig([
  // What we ship. Unminified on purpose: a compliance library gets read.
  // Without its JSDoc, though (D20, 14 Oct): every comment shipped four times,
  // in .js, .cjs and both maps, and the source maps still carry the source with
  // every comment in it, so a stack trace still leads to the explanation.
  // License and @__PURE__ comments stay — the second is how a user's bundler
  // knows what it may drop.
  {
    entry,
    outDir: 'dist',
    format: ['esm', 'cjs'],
    platform: 'neutral',
    target: 'es2022',
    dts: true,
    sourcemap: true,
    minify: false,
    clean: true,
    treeshake: true,
    failOnWarn: true,
    // C1 + C5, enforced by the build itself rather than by a script.
    // Note: tsdown documents that require() in CJS output is NOT covered here.
    // scripts/assert-no-node-builtins.mjs closes that gap.
    deps: { onlyBundle: [], onlyImport: [] },
    outputOptions: { comments: { legal: true, annotation: true, jsdoc: false } },
    outExtensions: ({ format }) => ({
      js: format === 'es' ? '.js' : '.cjs',
      dts: format === 'es' ? '.d.ts' : '.d.cts',
    }),
  },
  // Measured artifact only. Never published. .size-limit.json points here.
  {
    entry,
    outDir: '.size',
    format: ['esm'],
    platform: 'neutral',
    target: 'es2022',
    dts: false,
    sourcemap: false,
    minify: true,
    clean: true,
    treeshake: true,
  },
])
