# Live demo · หน้าทดลองใช้

https://eve-pdpa-extension.vercel.app

`@eve-pdpa-extension/core` running in the browser, in 8 steps: the message's path, the detectors, the six actions, the policy file, tokens, hash, allowlist and audit. Built with Next.js and [Mintel UI](https://mintel-ui.vercel.app) components.

ไลบรารี core ตัวจริงทำงานในเบราว์เซอร์ 8 หน้า สร้างด้วย Next.js และ component ของ Mintel UI

- **Nothing leaves the browser.** It is a static export (`output: 'export'`): no server, no API routes, no analytics. Fonts are self-hosted by `next/font` at build time.
- **It uses core from this repository**, built from source (`workspace:*`), so the demo always shows `main`.
- **The example policy** on the "กติกา" step is `examples/pdpa-policy.json`, imported at build time.

## Run it

From the repository root:

```bash
corepack pnpm install
corepack pnpm demo          # builds core, then next dev on http://localhost:3000
```

Build the static site as Vercel does (`vercel.json`): `pnpm --filter @eve-pdpa-extension/core build && pnpm --filter @eve-pdpa-extension/demo build`, output in `apps/demo/out`.

## Layout

| Path | What it is |
|---|---|
| `app/page.tsx` | Header, step navigation (`#s1`–`#s8`), theme switch |
| `components/demo/` | The 8 steps and the shared pieces (marked text, what the AI sees) |
| `components/ui/` | Mintel UI components, installed with `npx shadcn add @mintel/<name>` |
| `lib/pdpa.ts` | Labels per data type, the guard set-up, lining output up with the original |
| `app/globals.css` | The Mintel theme (`@mintel/mintel-theme`) and the highlight colours |

To add a Mintel UI component: `cd apps/demo && npx shadcn@latest add @mintel/<name>`, then `pnpm exec biome check --write .` from the root.
