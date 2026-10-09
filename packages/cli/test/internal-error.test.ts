import { describe, expect, it, vi } from 'vitest'
import { INTERNAL_ERROR } from '../src/cli.js'
import { cli, file, jsonl } from './helpers.js'

/**
 * A bug inside the scan must still exit 2, not 1 ("found"), and must not print
 * its message: a SyntaxError from JSON.parse quotes the text it choked on.
 */

const failure = vi.hoisted(() => ({ error: undefined as unknown }))

vi.mock('../src/scan.js', async (original) => ({
  ...(await original<typeof import('../src/scan.js')>()),
  scan: async () => {
    throw failure.error
  },
}))

describe('an error the scan did not expect', () => {
  it('exits 2, says it is a bug, and keeps the message to itself', async () => {
    failure.error = new SyntaxError('Unexpected token in "เบอร์ 0918887777"')
    const { code, stdout, stderr } = await cli('scan', file(jsonl({ text: 'x' })))
    expect(code).toBe(2)
    expect(stderr).toContain(`${INTERNAL_ERROR} (SyntaxError)`)
    expect(stdout + stderr).not.toContain('0918887777')
  })

  it('prints the message of an fs error, which names the path', async () => {
    failure.error = Object.assign(new Error('EACCES: permission denied, open chats.csv'), {
      code: 'EACCES',
    })
    const { code, stderr } = await cli('scan', file(jsonl({ text: 'x' })))
    expect(code).toBe(2)
    expect(stderr).toBe('scan stopped: EACCES: permission denied, open chats.csv\n')
  })
})
