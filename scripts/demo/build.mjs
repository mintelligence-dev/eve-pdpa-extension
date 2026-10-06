// Builds the live demo page: the real core bundle inlined into template.html.
//
//   pnpm build && node scripts/demo/build.mjs   →   scripts/demo/out/pdpa-demo.html
//
// The page is one self-contained HTML file because the host it is published to
// cannot load other files. That is the only reason the bundle's final
// `export { … }` is rewritten to a global here; apps import the package normally.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const here = (p) => new URL(p, import.meta.url)

const lib = readFileSync(here('../../packages/core/dist/index.js'), 'utf8')
const m = lib.match(/\nexport \{([^}]*)\};\s*(\/\/# sourceMappingURL=.*)?\s*$/)
if (!m) throw new Error('export line not found in dist/index.js — run pnpm build first')
if (/^\s*import\s/m.test(lib))
  throw new Error('dist/index.js has imports; the demo needs a self-contained bundle')
const body = `${lib.slice(0, m.index)}\nwindow.PDPA = Object.freeze({${m[1]}});\n`
if (body.includes('</script')) throw new Error('bundle contains </script and cannot be inlined')

// The policy page shows the repo's example policy, so the two cannot drift.
const example = readFileSync(here('../../examples/pdpa-policy.json'), 'utf8')
const exampleLiteral = JSON.stringify(example).replace(/</g, '\\u003c')

const page = readFileSync(here('./template.html'), 'utf8')
  .replace('/*__PDPA_LIBRARY__*/', () => body)
  .replace("/*__EXAMPLE_POLICY__*/''", () => exampleLiteral)

mkdirSync(here('./out/'), { recursive: true })
writeFileSync(here('./out/pdpa-demo.html'), page)
console.log(`scripts/demo/out/pdpa-demo.html · library ${(body.length / 1024).toFixed(1)} KB`)
