// Entry point for runtimes that execute a file directly (Node, Deno, Bun).
// workerd and the browser import ./dist.mjs and call run() themselves, inside a
// request handler and a page respectively.
import { run } from './dist.mjs'

console.log(await run())
