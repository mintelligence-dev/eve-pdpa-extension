import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

// A static export: no server, no route handlers. The guard runs only in the
// visitor's browser, which is what the page promises.
const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  turbopack: { root: fileURLToPath(new URL('../..', import.meta.url)) },
}

export default config
