// Entry point for runtimes that execute a file directly (Node). workerd
// imports ./dist.mjs and calls run() inside a request handler.
import { run } from './dist.mjs'

console.log(await run())
