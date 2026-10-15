// NM — normalisation: Thai and full-width digits, the space family, invisible characters,
// offsets into the original text, and the exported normalise()/toOriginal*() helpers.
//   bench/user/run features/normalise.check.mjs
import assert from 'node:assert/strict'
import { normalise, toOriginalEnd, toOriginalSpan, toOriginalStart } from '@thai-pdpa-guard/core'
import { allRules, check, found, makeGuard } from '../lib/kit.mjs'

const { guard } = makeGuard({ entities: allRules({ action: 'redact' }) })
const masker = makeGuard({ entities: allRules({ action: 'mask', keep: 'last4' }) }).guard

check('NM1 Thai digits are detected and the returned text keeps Thai digits', () => {
  assert.equal(masker.processSync('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ').text, 'เบอร์ xxx-xxx-๗๗๗๗ ค่ะ')
  assert.equal(guard.processSync('เบอร์ ๐๙๑-๘๘๘-๗๗๗๗ ค่ะ').text, 'เบอร์ [เบอร์โทร] ค่ะ')
})

check('NM2 full-width digits are detected', () => {
  const text = 'เบอร์ ０９１８８８７７７７ ค่ะ'
  const f = found(text, guard.processSync(text))
  assert.deepEqual(
    f.map((x) => [x.entity, x.value]),
    [['PHONE', '０９１８８８７７７７']],
  )
  assert.equal(masker.processSync(text).text, 'เบอร์ xxxxxx７７７７ ค่ะ')
})

check(
  'NM3 the space family between digit groups (NBSP, en, figure, thin, narrow NBSP, ideographic)',
  () => {
    for (const sp of [' ', ' ', ' ', ' ', ' ', '　']) {
      const v = `091${sp}888${sp}7777`
      const text = `เบอร์ ${v} ค่ะ`
      const f = found(text, guard.processSync(text))
      assert.deepEqual(
        f.map((x) => [x.entity, x.value]),
        [['PHONE', v]],
        `U+${sp.codePointAt(0).toString(16)}`,
      )
      // the original space characters survive a mask
      assert.equal(
        masker.processSync(text).text,
        `เบอร์ xxx${sp}xxx${sp}7777 ค่ะ`,
        `mask keeps U+${sp.codePointAt(0).toString(16)}`,
      )
    }
  },
)

check(
  'NM4 invisible characters inside a value (ZWSP, ZWNJ, ZWJ, BOM, word joiner, LRM, RLM, soft hyphen)',
  () => {
    const misses = []
    for (const z of ['​', '‌', '‍', '﻿', '⁠', '‎', '‏', '­']) {
      const v = `091${z}888${z}7777`
      const text = `เบอร์ ${v} ค่ะ`
      const res = guard.processSync(text)
      const f = found(text, res)
      if (
        !(f.length === 1 && f[0].entity === 'PHONE' && f[0].value === v && !/[0-9]/.test(res.text))
      )
        misses.push(
          `U+${z.codePointAt(0).toString(16).padStart(4, '0')}: ${JSON.stringify(f)} → ${JSON.stringify(res.text)}`,
        )
    }
    assert.deepEqual(misses, [])
  },
)

check(
  'NM5 finding offsets index the original text in UTF-16, after emoji and removed characters',
  () => {
    for (const text of [
      '😀😀 เบอร์ 091-888-7777 👍',
      '​​เบอร์ 091-888-7777',
      'เบอร์​ 091​888​7777 ค่ะ',
      '👨‍👩‍👧 ID 1-1037-02071-81-1',
    ]) {
      const res = guard.processSync(text)
      assert.equal(res.findings.length, 1, text)
      const v = text.slice(res.findings[0].start, res.findings[0].end)
      assert.match(
        v,
        /^(091.888.7777|091​888​7777|1-1037-02071-81-1)$/u,
        `slice ${JSON.stringify(v)} of ${JSON.stringify(text)}`,
      )
    }
  },
)

check(
  'NM6 characters that are not personal data are left untouched (emoji, line breaks, Thai)',
  () => {
    const text = 'สวัสดีค่ะ 😊\nเบอร์ 091-888-7777\r\nขอบคุณค่ะ 🙏🏻\t(ส่งด่วน)'
    assert.equal(guard.processSync(text).text, 'สวัสดีค่ะ 😊\nเบอร์ [เบอร์โทร]\r\nขอบคุณค่ะ 🙏🏻\t(ส่งด่วน)')
  },
)

check(
  'NM7 normalise() folds Thai/full-width digits and spaces, keeps the original, shifts null when 1:1',
  () => {
    const n = normalise('เบอร์ ๐๙๑ ８８８')
    assert.equal(n.text, 'เบอร์ 091 888')
    assert.equal(n.original, 'เบอร์ ๐๙๑ ８８８')
    assert.equal(n.shifts, null)
  },
)

check('NM8 normalise() records shifts for removed characters and does not strip separators', () => {
  const n = normalise('09​1-888')
  assert.equal(n.text, '091-888')
  assert.ok(Array.isArray(n.shifts) && n.shifts.length > 0, 'shifts recorded')
  assert.equal(normalise('3-1005-00123-45-8').text, '3-1005-00123-45-8')
})

check(
  'NM9 toOriginalStart/End/Span — the documented example: "AB" + ZWSP, span [0,2) maps to [0,2)',
  () => {
    const n = normalise('AB​')
    assert.equal(n.text, 'AB')
    assert.deepEqual([...toOriginalSpan(n, 0, 2)], [0, 2])
    assert.equal(toOriginalEnd(n, 2), 2)
    assert.equal(toOriginalStart(n, 1), 1)
    const m = normalise('​A​B')
    assert.deepEqual([...toOriginalSpan(m, 0, 2)], [1, 4])
  },
)
