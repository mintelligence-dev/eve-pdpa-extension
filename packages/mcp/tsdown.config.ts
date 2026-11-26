import { defineConfig } from 'tsdown'

// A Node program, run with npx by an MCP client: node: builtins are fine here,
// and its dependencies (core, the MCP SDK, zod) are installed, not bundled.
export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  failOnWarn: true,
  deps: {
    neverBundle: ['@eve-pdpa-extension/core', /^@modelcontextprotocol\//, 'zod'],
  },
  // type: module, so .js is ESM. Explicit so "bin" cannot drift from what is emitted.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})
