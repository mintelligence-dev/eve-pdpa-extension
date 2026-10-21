/**
 * Test-only. With PDPA_EXAMPLE_LINE_API_BASE set, calls the LINE adapter makes
 * to api.line.me and api-data.line.me go to that base URL instead — a stub the
 * integration test runs on 127.0.0.1 — so the LINE path runs offline and the
 * test can read what the bot would have sent. Unset, nothing changes.
 *
 * @line/bot-sdk calls the global fetch, so swapping it here, where the channel
 * module loads, covers both the webhook route and the reply eve posts later.
 */
const LINE_ORIGINS = ['https://api.line.me', 'https://api-data.line.me']

export function routeLineApiForTests(): void {
  const base = process.env.PDPA_EXAMPLE_LINE_API_BASE
  if (!base) return
  const marker = Symbol.for('eve-pdpa-extension.example.offline-line')
  const g = globalThis as typeof globalThis & { [marker]?: true }
  if (g[marker]) return
  g[marker] = true
  const realFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    const origin = LINE_ORIGINS.find((o) => url.startsWith(o))
    if (origin === undefined) return realFetch(input, init)
    const target = base + url.slice(origin.length)
    return input instanceof Request
      ? realFetch(new Request(target, input), init)
      : realFetch(target, init)
  }
}
