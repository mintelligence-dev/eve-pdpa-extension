import type { EntityType } from '@eve-pdpa-extension/core'

// What the person who sent the message is told. Kinds of data only, never a
// value: the reason travels into errors, logs and chat replies.

const NAMES_TH: Readonly<Record<EntityType, string>> = {
  TH_NATIONAL_ID: 'เลขบัตรประชาชน',
  PHONE: 'เบอร์โทร',
  EMAIL: 'อีเมล',
  BANK_ACCOUNT: 'เลขบัญชี',
  CREDIT_CARD: 'เลขบัตรเครดิต',
  LINE_USER_ID: 'LINE ID',
}

const NAMES_EN: Readonly<Record<EntityType, string>> = {
  TH_NATIONAL_ID: 'a Thai national ID number',
  PHONE: 'a phone number',
  EMAIL: 'an email address',
  BANK_ACCOUNT: 'a bank account number',
  CREDIT_CARD: 'a credit card number',
  LINE_USER_ID: 'a LINE user ID',
}

export type Language = 'th' | 'en'

function list(names: readonly string[], and: string): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')}${and}${names[names.length - 1]}`
}

/** `blockedBy` from core: entity types in reading order, each once. */
export function blockedReason(blockedBy: readonly EntityType[], language: Language): string {
  if (language === 'en') {
    // An entity type a later core adds, before this table knows it.
    const names = blockedBy.map((e) => NAMES_EN[e] ?? 'personal data')
    return `This message was not passed on because it contains ${list(names, ' and ')}. Please send it again without that information.`
  }
  const names = blockedBy.map((e) => NAMES_TH[e] ?? 'ข้อมูลส่วนบุคคล')
  return `ข้อความนี้ไม่ได้ถูกส่งต่อ เพราะมี${list(names, ' และ')} กรุณาส่งใหม่โดยไม่ใส่ข้อมูลนี้`
}

export function filesReason(language: Language): string {
  return language === 'en'
    ? 'This message was not passed on because it has a file attached. Only text is accepted here.'
    : 'ข้อความนี้ไม่ได้ถูกส่งต่อ เพราะมีไฟล์แนบ ช่องทางนี้รับเฉพาะข้อความ'
}
