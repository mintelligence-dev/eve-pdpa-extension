# @thai-pdpa-guard/cli

Find out what Thai personal data is sitting in old chat exports — **without writing any code**. Run it before letting an AI read your chats, or before handing a file to someone else.

- Reads JSONL · CSV · TSV · chat exports from LINE Official Account
- Says what it found, how many, and on which line · given a policy, says what that policy would mask or block
- **The report contains no personal data** · paste it into a ticket or pass it on
- Uses the same detectors as [`@thai-pdpa-guard/core`](https://www.npmjs.com/package/@thai-pdpa-guard/core)

> **This is a technical tool, not a certification of compliance with Thailand's Personal Data Protection Act (PDPA).**
> A report that finds nothing does not mean the file holds no personal data — see [Limitations](#limitations).

[ภาษาไทย](./README.th.md)

---

## Usage

No install needed (Node.js 18.18 or later):

```bash
npx @thai-pdpa-guard/cli scan chats.csv
```

Or install it for regular use:

```bash
npm install -g @thai-pdpa-guard/cli
thai-pdpa-guard scan chats.csv
```

## Example

`chats.csv`:

```csv
id,text
m1,สวัสดีครับ สั่งเสื้อไซซ์ M ได้ไหมครับ
m2,เบอร์ 091-888-7777 นะครับ
m3,"โอนเข้าเลขบัญชี 123-4-56789-0
แล้วนะครับ"
m4,จ่ายด้วยบัตร 4111 1111 1111 1111 ได้ไหมคะ
m5,เลขอ้างอิง 9000123456789016 ค่ะ
m6,ติดต่อร้านได้ที่ 02-123-4567 ค่ะ
m7,สั่งเพิ่ม 2 ตัว, ส่งด่วน
```

```
$ thai-pdpa-guard scan chats.csv
thai-pdpa-guard scan  chats.csv
policy   none given — every entity reported, nothing rewritten  (fnv1a64:944707045e078ba4)
messages 6 scanned · 4 with personal data · 1 line unreadable

found
  PHONE         2
  BANK_ACCOUNT  1
  CREDIT_CARD   1

messages with personal data
  line 3  m2  PHONE
  line 4  m3  BANK_ACCOUNT
  line 6  m4  CREDIT_CARD
  line 8  m6  PHONE

below the confidence threshold — found, but the policy does nothing with them
  CREDIT_CARD  1  (confidence 0.6, threshold 0.95)
  line 7  m5  CREDIT_CARD
  lower minConfidence in the policy to act on them

unreadable lines — not scanned
  line 9  3 fields, header has 2
```

Reading the report:

| Section | Meaning |
|---|---|
| `found` | Values found, by type |
| `messages with personal data` | Which message holds what · the **line number in the file** (a message over several lines counts from its first) and the id from the `id` column |
| `below the confidence threshold` | Found by a detector, but not with enough confidence to count — such as a number that passes the card checksum but matches no card issuer · usually not personal data, but worth a look |
| `unreadable lines` | Lines that could not be read and **were not scanned** · here m7 has a comma in its text without quotes around it, so its columns shift |

### See what a policy would do

```
$ thai-pdpa-guard scan chats.csv --policy pdpa-policy.json
...
found
  PHONE         1
  BANK_ACCOUNT  1
  CREDIT_CARD   2
  (and 1 let through by the allowlist)

the policy would
  tokenise  1
  mask      1
  block     2
  2 messages would be blocked whole
```

The shop's own number `02-123-4567` is on the allowlist, so it is not counted · this policy sets `minConfidence: 0.6` for credit cards, so the reference number in m5 is counted and would be blocked too · see how to write a policy in the [core README](https://www.npmjs.com/package/@thai-pdpa-guard/core#policy)

### A report for machines

```bash
thai-pdpa-guard scan chats.csv --json > report.json
```

The same information as JSON, listing **every message** (the human report shows the first 20).

## Files it reads

| Kind | Recognised by | Message is in |
|---|---|---|
| JSONL | extension `.jsonl` `.ndjson` | field `text` · id in field `id` |
| CSV | extension `.csv` · needs a header row | column `text` · id in column `id` (optional) |
| TSV | extension `.tsv` | as CSV, tab-separated |
| LINE OA | a `.csv` whose first line is `ชื่อบัญชี,…` followed by a `ประเภทผู้ส่ง,…` header | column `ข้อความ` |

Fields or columns named differently:

```bash
thai-pdpa-guard scan export.csv --text-field message --id-field msg_id
```

Extension says nothing about the format: `--format jsonl` · `csv` · `tsv` · `line-oa`

### CSV files from Thai Excel

Thai Excel usually saves CSV as windows-874, not UTF-8:

```
$ thai-pdpa-guard scan excel.csv
scan stopped: excel.csv is not valid utf-8 — a CSV saved by Thai Excel is usually windows-874: try --encoding windows-874

$ thai-pdpa-guard scan excel.csv --encoding windows-874
```

The CLI **stops rather than reading on with garbled text**. Read in the wrong encoding, the digits survive but the Thai words do not — cue words such as "เลขบัญชี" (account number) vanish, and bank accounts are missed with nothing to say so.

### Chat exports from LINE Official Account

In LINE OA Manager, download the chat history (needs a plan that includes this feature). You get a .zip holding one CSV per customer · **unzip it first**, then scan one file at a time:

```
$ thai-pdpa-guard scan "3_20261001_20261007_สมชาย ตัวอย่าง.csv"
thai-pdpa-guard scan  3_20261001_20261007_….csv
policy   none given — every entity reported, nothing rewritten  (fnv1a64:944707045e078ba4)
messages 3 scanned · 2 with personal data
         from customers 1 of 2 · from the shop 1 of 1

found
  PHONE  2

messages with personal data
  line 6  customer  PHONE
  line 7  shop      PHONE
```

- **No customer names in the report** · LINE names each file after the customer's LINE name, so the report keeps only its number and dates · the sender shows only as `customer` or `shop`
- **Both sides are scanned** · staff type customers' data too, like line 7 above
- A LINE OA account set to another language writes different headers · use `--format line-oa --text-field <message column>`

## Check a policy file

```
$ thai-pdpa-guard policy validate pdpa-policy.json
pdpa-policy.json  valid  fnv1a64:ee142dc8b1111706

  TH_NATIONAL_ID  redact
  PHONE           tokenise · purposes: otp_send · ttl 300s · reply shows masked value
  EMAIL           hash
  BANK_ACCOUNT    mask · last 4 shown
  CREDIT_CARD     block · minConfidence 0.6
  LINE_USER_ID    redact

allowlist   2 exact · 1 pattern (values not shown)
placeholders [เบอร์โทร]

note: uses hash: createGuard needs an hmacKey of at least 32 bytes
note: uses tokenise: every process and resolve call needs a sessionId
```

Loaded the same way your app loads it, so a file that passes here is a file your app accepts · a mistake names the field, such as `entities.PHONE.allowedPurposes: required for tokenise` · allowlist entries are counted, never shown

## In scripts and CI

Branch on the exit code without reading the report:

| `scan` | Meaning |
|---|---|
| `0` | Every line read, nothing found |
| `1` | Personal data found |
| `2` | Could not run · bad arguments · missing file · invalid policy · wrong encoding |
| `3` | Nothing found **but some lines could not be read** · "nothing found" is not "nothing there" |

`policy validate`: `0` valid · `1` invalid · `2` could not run

```bash
thai-pdpa-guard scan export.jsonl --policy pdpa-policy.json
case $? in
  0) echo "no personal data found" ;;
  1) echo "found — read the report before passing the file on" ;;
  3) echo "some lines were not scanned — fix the file and scan again" ;;
  *) exit 1 ;;
esac
```

## Limitations

- **Names and addresses are not detected yet** (planned for 0.2)
- Every detector limitation of core applies here, such as bank accounts needing a cue word · see [Known limitations](https://www.npmjs.com/package/@thai-pdpa-guard/core#known-limitations)
- One file at a time · does not read .zip
- The LINE OA format comes from a Thai-language export seen in 2025 · if LINE changes it, the CLI stops and says it cannot find the column, rather than scanning the wrong one in silence
- **Reports only, never rewrites the file** · there is no command yet that writes a protected copy

## Reporting a vulnerability

**Do not open a public issue.** Email **kunlachat@m-intelligence.tech** with the subject line starting `[thai-pdpa-guard security]`. Reproduce with made-up values — never send real personal data.

## License

Apache-2.0
