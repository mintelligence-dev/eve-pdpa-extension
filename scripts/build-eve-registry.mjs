// Builds the eve package's registry for `eve add` into packages/eve/r/, the
// way `shadcn build` would: r/registry.json, the catalog, and one r/<item>.json
// per item with each file's content inlined. Run by the eve package's build,
// so the tarball always carries a registry for its own version: jsDelivr then
// serves it at https://cdn.jsdelivr.net/npm/@eve-pdpa-extension/eve@<version>/r/pdpa.json.
//
// The source is packages/eve/registry/. `{{version}}` in a dependency becomes
// the package's version, exactly: an item installs the code it was built with.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const pkg = new URL('../packages/eve/', import.meta.url)
const source = new URL('registry/', pkg)
const out = new URL('r/', pkg)

const { version } = JSON.parse(readFileSync(new URL('package.json', pkg), 'utf8'))
const registry = JSON.parse(readFileSync(new URL('registry.json', source), 'utf8'))

const items = registry.items.map((item) => ({
  ...item,
  dependencies: (item.dependencies ?? []).map((d) => d.replaceAll('{{version}}', version)),
}))

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
writeFileSync(new URL('registry.json', out), `${JSON.stringify({ ...registry, items }, null, 2)}\n`)
for (const item of items) {
  const built = {
    $schema: 'https://ui.shadcn.com/schema/registry-item.json',
    ...item,
    files: item.files.map((file) => ({
      ...file,
      content: readFileSync(new URL(file.path, source), 'utf8'),
    })),
  }
  writeFileSync(new URL(`${item.name}.json`, out), `${JSON.stringify(built, null, 2)}\n`)
}
console.log(`build-eve-registry ok (${items.map((i) => i.name).join(', ')} @ ${version})`)
