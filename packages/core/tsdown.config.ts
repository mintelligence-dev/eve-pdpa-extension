import { defineConfig } from 'tsdown'

const entry = ['src/index.ts', 'src/data/index.ts']

export default defineConfig([
  // What we ship. Unminified on purpose: a compliance library gets read.
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
