// Builds the live demo page: the real core bundle inlined into template.html.
//
//   pnpm build && node scripts/demo/build.mjs   →   scripts/demo/out/pdpa-demo.html
//
// The page is one self-contained HTML file because the host it is published to
// cannot load other files. That is the only reason the bundle's final
// `export { … }` is rewritten to a global here; apps import the package normally.
//
// The look comes from the M Intelligence design tokens (@m-intelligence/tokens,
// github.com/mintelligence-dev/mintel-magicui): their CSS variables are inlined,
// and their Google Fonts stylesheet is linked. The tokens switch to dark under
// [data-theme="dark"], so a small script sets that from the OS setting.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

const tokenFile = (p) =>
  readFileSync(fileURLToPath(import.meta.resolve(`@m-intelligence/tokens/${p}`)), 'utf8')
const tokensCss = tokenFile('tokens.css')
const fontsUrl = tokenFile('fonts.css').match(/@import url\("([^"]+)"\)/)?.[1]
if (!fontsUrl) throw new Error('@m-intelligence/tokens/fonts.css has no @import url(...)')
if (tokensCss.includes('</style'))
  throw new Error('tokens.css contains </style and cannot be inlined')

const mintelHead = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  `<link rel="stylesheet" href="${fontsUrl}">`,
  `<style>\n${tokensCss}</style>`,
  '<script>(function () { var m = window.matchMedia("(prefers-color-scheme: dark)"); function set() { document.documentElement.setAttribute("data-theme", m.matches ? "dark" : "light") } set(); m.addEventListener("change", set) })()</script>',
].join('\n')

const template = readFileSync(here('./template.html'), 'utf8')
if (!template.includes('<!--__MINTEL_HEAD__-->'))
  throw new Error('template.html has no <!--__MINTEL_HEAD__--> marker')
// A whole document, so it renders as UTF-8 wherever it is served from.
const page = `<!doctype html>
<html lang="th">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Try eve-pdpa-extension in the browser: detect and mask Thai personal data before it reaches an AI.">
${template}`
  .replace('<!--__MINTEL_HEAD__-->', () => mintelHead)
  .replace('/*__PDPA_LIBRARY__*/', () => body)
  .replace("/*__EXAMPLE_POLICY__*/''", () => exampleLiteral)

mkdirSync(here('./out/'), { recursive: true })
writeFileSync(here('./out/pdpa-demo.html'), page)
console.log(`scripts/demo/out/pdpa-demo.html · library ${(body.length / 1024).toFixed(1)} KB`)
