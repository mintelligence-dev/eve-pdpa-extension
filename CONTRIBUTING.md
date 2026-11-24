# Contributing

## The one rule that matters

**Never commit real personal data.** Not in tests, not in fixtures, not in issue
reports, not in commit messages.

Every file under `fixtures/` must be listed in `fixtures/ATTESTATION.md` by
someone who confirmed it is synthetic. CI enforces the register
(`pnpm gate:attestation`). Scanning the fixtures with our own detectors is
planned but not switched on yet, so the register is the only check today.

Need a Thai national ID for a test? Generate one with a valid check digit.
The helper lives with core's tests and is not part of the published package,
so import it by path from a test in `packages/core/test/`:

```ts
import { makeThaiId } from './helpers/make-thai-id.js'
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

## Pull requests

`main` is protected: changes land through a pull request, and the `build`,
`quality`, `constraints` and `eve` jobs must pass. User-visible changes add a
line under `## Unreleased` in the package's `CHANGELOG.md`.

Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Releasing (maintainers)

Versions and changelogs are edited by hand; there is no release tool.

1. Set the version in `package.json`: `core` and `cli` share one version, `eve`
   has its own. Keep `packages/core/src/version.ts` in step (a test checks it).
2. Rename `## Unreleased` in each `CHANGELOG.md` to the version.
3. Merge to `main`, then tag that commit: `v<version>` for core and cli,
   `eve-v<version>` for eve. Push the tag.
4. The `publish` workflow checks the tag against the versions and stages the
   packages on npm. Nothing is installable until an owner approves each one on
   npmjs.com → Staged Packages.
5. Create a GitHub Release for the tag with the changelog section as its notes.

Run the workflow by hand (Actions → publish → Run workflow) for a dry run.
