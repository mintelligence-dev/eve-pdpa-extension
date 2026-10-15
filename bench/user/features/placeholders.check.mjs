// PH — redact placeholders in Thai and English, and the hash label.
//   bench/user/run features/placeholders.check.mjs
import assert from 'node:assert/strict'
import { ENTITY_TYPES } from '@thai-pdpa-guard/core'
import { allRules, check, makeGuard } from '../lib/kit.mjs'

const SAMPLES = {
  TH_NATIONAL_ID: 'เลขบัตร 1-1037-02071-81-1',
  PHONE: 'เบอร์ 091-888-7777',
  EMAIL: 'เมล somchai.k@gmail.com',
  BANK_ACCOUNT: 'เลขบัญชี 123-4-56789-0',
  CREDIT_CARD: 'บัตร 4111 1111 1111 1111',
  LINE_USER_ID: 'userId U4af4980629f1ae0b2b5c2f7a7b2e9c3d',
}
const placeholder = (lang, entity, action = 'redact') => {
  const g = makeGuard({
    entities: allRules({ action }),
    ...(lang ? { placeholderLanguage: lang } : {}),
  }).guard
  const text = SAMPLES[entity]
  return g.processSync(text).text.slice(text.indexOf(' ') + 1)
}

check('PH1 placeholderLanguage th → [เบอร์โทร]', () => {
  assert.equal(placeholder('th', 'PHONE'), '[เบอร์โทร]')
})
check('PH2 placeholderLanguage en → [phone]', () => {
  assert.equal(placeholder('en', 'PHONE'), '[phone]')
})
check('PH3 the default language is th', () => {
  assert.equal(placeholder(undefined, 'PHONE'), '[เบอร์โทร]')
})
check(
  'PH4 every entity has a Thai and an English placeholder, bracketed, carrying nothing of the value',
  (t) => {
    const table = []
    for (const e of ENTITY_TYPES) {
      const th = placeholder('th', e)
      const en = placeholder('en', e)
      table.push(`${e}: ${th} / ${en}`)
      for (const p of [th, en]) {
        assert.match(p, /^\[[^\]]+\]$/, `${e} ${p}`)
        assert.ok(
          !/[0-9]/.test(p) && !p.includes('somchai') && !p.includes('4af49806'),
          `${e} placeholder carries part of the value: ${p}`,
        )
      }
      assert.notEqual(th, en, e)
    }
    t.diagnostic(`observed (only PHONE is documented): ${table.join(' · ')}`)
  },
)
check('PH5 hash output uses the English entity name, whatever the language', () => {
  for (const e of ENTITY_TYPES) {
    for (const lang of ['th', 'en'])
      assert.match(
        placeholder(lang, e, 'hash'),
        new RegExp(`^\\[${e}:[a-z]{16}\\]$`),
        `${e} ${lang}`,
      )
  }
})
