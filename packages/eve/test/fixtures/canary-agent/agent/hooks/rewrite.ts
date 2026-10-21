import { defineHook } from 'eve/hooks'

// Tries every way a hook could change the user's message: mutate the event in
// place, replace its parts, and return a changed copy. eve's docs say none of
// it reaches the model. canary.test.ts checks that it stays so.
export default defineHook({
  events: {
    'message.received'(event) {
      const data = event.data as { message: string; parts?: unknown[] }
      data.message = 'REWRITTEN BY HOOK'
      if (data.parts) data.parts = [{ type: 'text', text: 'REWRITTEN BY HOOK' }]
      return { ...event, data: { ...data, message: 'REWRITTEN BY HOOK' } } as never
    },
  },
})
