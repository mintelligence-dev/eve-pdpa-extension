/** Set and not empty, or undefined. */
export function env(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

/** The first of `names` that is set: one value, two names (Vercel's Upstash integration and Upstash's console). */
export function envOneOf(...names: string[]): string | undefined {
  for (const name of names) {
    const value = env(name)
    if (value !== undefined) return value
  }
  return undefined
}

export const isProduction = (): boolean => process.env.VERCEL_ENV === 'production'

/**
 * A secret the deployment must set. Locally, a fixed development value keeps
 * `eve dev` working with nothing configured — never in production, where a
 * missing secret stops the agent at startup.
 */
export function secret(name: string, development: string): string {
  const value = env(name)
  if (value !== undefined) return value
  if (isProduction())
    throw new Error(`set ${name} in the project's environment variables (openssl rand -hex 32)`)
  return development
}
