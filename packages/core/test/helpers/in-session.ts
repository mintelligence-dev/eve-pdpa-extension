import type { Guard } from '../../src/types.js'

/**
 * A guard whose calls carry a sessionId unless the test passes its own.
 *
 * A policy that tokenises refuses a call without one (D10.4). Tests that are
 * about something else — the sink, the store, the placeholders — use this so
 * each call does not have to repeat it.
 */
export function inSession(guard: Guard, sessionId = 'conv_test'): Guard {
  return {
    get stats() {
      return guard.stats
    },
    processSync: (text, opts) => guard.processSync(text, { sessionId, ...opts }),
    process: (text, opts) => guard.process(text, { sessionId, ...opts }),
    resolve: (token, opts) => guard.resolve(token, { sessionId, ...opts }),
    resolveSync: (token, opts) => guard.resolveSync(token, { sessionId, ...opts }),
    endSession: (id) => guard.endSession(id),
  }
}
