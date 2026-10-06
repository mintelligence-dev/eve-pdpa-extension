/**
 * Synthetic Thai national ids with a correct check digit.
 *
 * The spec requires fixtures to contain no real personal data and ids to be
 * generated with valid checksums. This helper exists from the first commit so
 * nobody is ever tempted to paste a real number into a test.
 */
export function makeThaiId(rnd: () => number = Math.random): string {
  const body = Array.from({ length: 12 }, () => Math.floor(rnd() * 10)).join('')
  return body + checkDigit(body)
}

export function checkDigit(body12: string): number {
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += (body12.charCodeAt(i) - 48) * (13 - i)
  }
  return (11 - (sum % 11)) % 10
}
