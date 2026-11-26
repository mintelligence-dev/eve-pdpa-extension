import type { EntityType, ProcessResult } from '@eve-pdpa-extension/core'

/**
 * The longest text either tool takes, in characters. Kept well below what core
 * can take: one shape of national-ID-like text costs core time that grows with
 * the square of its length (about 0.3 s at this cap, 5 s at 100,000), and the
 * server answers nothing else meanwhile.
 */
export const MAX_TEXT = 20_000

export interface Found {
  readonly entity: EntityType
  readonly start: number
  readonly end: number
  readonly confidence: number
  readonly action: string
}

export interface ScanOutput {
  readonly found: number
  readonly byType: Partial<Record<EntityType, number>>
  readonly findings: readonly Found[]
  // The SDK's structuredContent is a plain record.
  readonly [key: string]: unknown
}

export interface RedactOutput {
  readonly text: string
  readonly byType: Partial<Record<EntityType, number>>
  readonly [key: string]: unknown
}

function countByType(result: ProcessResult): Partial<Record<EntityType, number>> {
  const byType: Partial<Record<EntityType, number>> = {}
  for (const f of result.findings) byType[f.entity] = (byType[f.entity] ?? 0) + 1
  return byType
}

/**
 * What pdpa_scan answers: where each value is and what it is, never the value
 * and never the text. Positions count from the text as it was sent.
 */
export function scanOutput(result: ProcessResult): ScanOutput {
  return {
    found: result.findings.length,
    byType: countByType(result),
    findings: result.findings.map((f) => ({
      entity: f.entity,
      start: f.start,
      end: f.end,
      confidence: f.confidence,
      action: f.action,
    })),
  }
}

/** What pdpa_redact answers when the policy let the text through: the text, protected. */
export function redactOutput(result: ProcessResult): RedactOutput {
  return { text: result.text, byType: countByType(result) }
}

/** The message of a blocked redact: the types only, never the text. */
export function blockedMessage(blockedBy: readonly EntityType[]): string {
  return blockedBy.length > 0
    ? `pdpa: blocked by policy (${blockedBy.join(', ')})`
    : 'pdpa: blocked by policy'
}
