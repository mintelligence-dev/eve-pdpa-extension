// The complete set of host globals @thai-pdpa-guard/core is allowed to touch.
//
// core/tsconfig.json sets "types": [] and "lib": ["ES2022"], so nothing from
// @types/node or the DOM is ambiently available. process, Buffer, __dirname,
// fetch, window and document are all compile errors inside this package.
//
// Adding anything to this file requires a PR review against C4 (no network)
// and C5 (runs on Node, Deno, Bun, workerd and browsers).

declare global {
  interface PdpaCrypto {
    getRandomValues<T extends Uint8Array>(array: T): T
    readonly subtle: {
      digest(algorithm: string, data: ArrayBuffer | ArrayBufferView): Promise<ArrayBuffer>
    }
  }

  // Deliberately `| undefined`: Node 18 keeps globalThis.crypto behind
  // --experimental-global-webcrypto (unflagged only in v19). Every call site is
  // forced to handle its absence at compile time rather than at runtime. See D7.
  var crypto: PdpaCrypto | undefined

  var TextEncoder: { new (): { encode(input: string): Uint8Array } }

  // warn only, for the one-time "no audit sink" notice D3 requires. Present on
  // all five runtimes and writes nowhere the host has not already chosen. Not
  // log, not error, not debug: core has nothing else to say on its own.
  var console: { warn(...data: unknown[]): void }
}

export {}
