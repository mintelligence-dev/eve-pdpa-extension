// What the demo needs on top of @eve-pdpa-extension/core: labels for each data
// type, the guard set-up every step uses, and a way to line the guard's output
// up with the original text so each replacement can be marked.
import {
  type AuditFinding,
  type AuditRecord,
  type Candidate,
  createGuard,
  definePolicy,
  type EntityRule,
  type EntityType,
  type GuardOptions,
  type ProcessResult,
} from '@eve-pdpa-extension/core'

export * as P from '@eve-pdpa-extension/core'

/** For hash: a sample key, public on purpose. Never use it outside the demo. */
export const DEMO_KEY = 'a3f1c9e07b2d4f6a8c1e3b5d7f9a0c2e4b6d8f1a3c5e7b9d0f2a4c6e8b1d3f5a'

/** The threshold a policy uses unless it sets minConfidence. */
export const DEFAULT_THRESHOLD = 0.95

type Tone =
  | 'id'
  | 'phone'
  | 'email'
  | 'bank'
  | 'card'
  | 'line'
  | 'plate'
  | 'dob'
  | 'passport'
  | 'kept'

export const ENTITY: Record<string, { label: string; tone: Tone }> = {
  TH_NATIONAL_ID: { label: 'เลขบัตรประชาชน', tone: 'id' },
  PHONE: { label: 'เบอร์โทร', tone: 'phone' },
  EMAIL: { label: 'อีเมล', tone: 'email' },
  BANK_ACCOUNT: { label: 'เลขบัญชี', tone: 'bank' },
  CREDIT_CARD: { label: 'บัตรเครดิต', tone: 'card' },
  LINE_USER_ID: { label: 'LINE ID', tone: 'line' },
  LICENSE_PLATE: { label: 'ทะเบียนรถ', tone: 'plate' },
  DATE_OF_BIRTH: { label: 'วันเกิด', tone: 'dob' },
  PASSPORT: { label: 'พาสปอร์ต', tone: 'passport' },
}

/** A type this page does not know yet still renders, under its own name. */
export const ent = (entity: string) => ENTITY[entity] ?? { label: entity, tone: 'kept' as Tone }

export type Rules = Partial<Record<EntityType, EntityRule>>

/** A guard with these rules, everything else redacted, and its audit events kept in order. */
export function guardWith(entities: Rules, extra?: Partial<GuardOptions>) {
  const events: AuditRecord[] = []
  const guard = createGuard({
    policy: definePolicy({ entitySet: '0.2', onUnmapped: 'redact', entities }),
    onAudit: (e) => {
      events.push(e)
    },
    ...extra,
  })
  return { guard, events }
}

export type Part = { same: string } | { rep: string; finding: AuditFinding; was: string }

/**
 * Splits the guard's output back into unchanged and replaced stretches, using
 * the findings' offsets into the original. Returns null if it cannot line them
 * up; the caller then shows the text unmarked.
 */
export function splitOutput(
  original: string,
  out: string,
  findings: readonly AuditFinding[],
): Part[] | null {
  const fs = [...findings].sort((a, b) => a.start - b.start)
  const parts: Part[] = []
  let pos = 0
  let prev = 0
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i] as AuditFinding
    const same = original.slice(prev, f.start)
    if (out.slice(pos, pos + same.length) !== same) return null
    if (same) parts.push({ same })
    pos += same.length
    const next = fs[i + 1]
    const nextStart = next ? next.start : original.length
    const after = original.slice(f.end, nextStart)
    let end: number
    if (i === fs.length - 1) end = out.length - after.length
    else if (after === '') end = pos
    else end = out.indexOf(after, pos)
    if (end < pos) return null
    parts.push({ rep: out.slice(pos, end), finding: f, was: original.slice(f.start, f.end) })
    pos = end
    prev = f.end
  }
  const tail = original.slice(prev)
  if (out.slice(pos) !== tail) return null
  if (tail) parts.push({ same: tail })
  return parts
}

/**
 * Why a detector reported what it did. Mirrors the confidence constants in
 * packages/core/src/detectors/*.ts — each confidence value has one cause.
 */
export function why(c: Candidate, value: string): string {
  const digits = value.replace(/\D/g, '')
  const acts = c.confidence >= DEFAULT_THRESHOLD
  switch (c.detector) {
    case 'th-national-id':
      return acts
        ? 'เลข 13 หลัก และหลักสุดท้ายคำนวณ mod-11 ได้ตรง'
        : 'เลข 13 หลักเหมือนกัน แต่หลักสุดท้ายคำนวณ mod-11 ไม่ตรง จึงไม่ใช่เลขบัตรจริง'
    case 'credit-card':
      return acts
        ? 'ผ่านสูตร Luhn และเลขขึ้นต้นตรงกับผู้ออกบัตรที่รู้จัก เช่น 4 = Visa, 5 = Mastercard'
        : 'ผ่านสูตร Luhn แต่เลขขึ้นต้นไม่ตรงกับผู้ออกบัตรรายไหนเลย อาจผ่านโดยบังเอิญ'
    case 'email':
      return 'มีรูปแบบ ชื่อ@โดเมน.นามสกุล'
    case 'line-user-id':
      return 'ขึ้นต้นด้วย U ตามด้วยอักษร 0–9 a–f 32 ตัว ซึ่งเป็นรูปแบบ userId ของ LINE'
    case 'phone':
      if (c.confidence >= 0.99) return 'รูปแบบเบอร์ไทย และมีคำอย่าง เบอร์ / โทร / มือถือ อยู่ใกล้ ๆ'
      if (c.confidence >= 0.97) return 'รูปแบบเบอร์มือถือ: 0 ตามด้วย 6 / 8 / 9 รวม 10 หลัก'
      return 'รูปแบบเบอร์บ้าน: 0 ตามด้วยรหัสพื้นที่ 2–7 รวม 9 หลัก'
    case 'bank-account':
      return /^0[689]\d{8}$/.test(digits)
        ? 'หน้าตาเหมือนเบอร์มือถือ แต่มีคำว่า บัญชี อยู่ใกล้ ๆ ตัวตรวจเบอร์จึงถอยให้'
        : 'เป็นชุดตัวเลขแบบเลขบัญชี และมีคำว่า บัญชี / โอน หรือชื่อธนาคารอยู่ใกล้ ๆ'
    case 'license-plate':
      return acts
        ? 'รูปแบบทะเบียนรถ (ตัวอักษร ตามด้วยตัวเลข) และมีคำว่า ทะเบียน หรือชื่อจังหวัดอยู่ใกล้ ๆ'
        : 'รูปแบบเหมือนทะเบียนรถ แต่ไม่มีคำบอกใบ้ที่ชัดพอ'
    case 'date-of-birth':
      return acts ? 'เป็นวันที่จริง และมีคำว่า วันเกิด / เกิด / DOB ติดอยู่' : 'เป็นวันที่ แต่ไม่มีคำบอกว่าเป็นวันเกิด'
    case 'passport':
      return acts
        ? 'รูปแบบเลขพาสปอร์ต และมีคำว่า พาสปอร์ต / หนังสือเดินทาง / passport อยู่ใกล้ ๆ'
        : 'รูปแบบเหมือนพาสปอร์ตไทย (อักษร 2 ตัว + เลข 7 หลัก) แต่ไม่มีคำบอกใบ้'
    default:
      return ''
  }
}

export type { AuditFinding, AuditRecord, Candidate, ProcessResult }
