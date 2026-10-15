# Contributing

## The one rule that matters

**Never commit real personal data.** Not in tests, not in fixtures, not in issue
reports, not in commit messages.

Every file under `fixtures/` must be listed in `fixtures/ATTESTATION.md` by
someone who confirmed it is synthetic. CI enforces the register
(`pnpm gate:attestation`); from week 5 it will also scan fixtures with our own
detectors.

Need a Thai national ID for a test? Generate one:

```ts
import { makeThaiId } from '@eve-pdpa-extension/core/test/helpers/make-thai-id'
```

## Constraints you cannot negotiate around

`packages/core` is subject to hard limits that CI enforces mechanically:

| Constraint | Enforced by |
|---|---|
| zero runtime dependencies | build config + `pnpm gate:deps` |
| no `node:` builtins, no DOM, no network | `tsconfig` (`"types": []`, `"lib": ["ES2022"]`) + `pnpm gate:builtins` + `deno run` with no permissions |
| under 150 KB minified including dictionaries | `pnpm size` |
| runs on Node 18+, Deno, Bun, workerd, browsers | `pnpm smoke` |
| no reference to sibling packages | `pnpm gate:ner` |

If a change needs a new host global, add it to `packages/core/src/platform.d.ts`
and say why in the PR. That file is the reviewable list of everything core is
allowed to touch.

## Dataset licences

Any dictionary added under `data/` must have its source and licence recorded in
`data/LICENCES.md` and must permit commercial use. Dictionaries ship inside
`core`, so unlike the optional NER model, every single user installs them.

## Local loop

```bash
corepack pnpm install
corepack pnpm exec playwright install chromium   # once
corepack pnpm verify
```
