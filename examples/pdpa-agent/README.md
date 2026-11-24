# pdpa-agent · ตัวอย่าง eve agent ที่ปิดข้อมูลส่วนบุคคล

An [eve](https://eve.dev) agent for a Thai online shop, protected by [`@eve-pdpa-extension/eve`](../../packages/eve). Made with `eve init` and the `eve add` line from the eve package's README, plus the four small edits listed below.

ตัวอย่าง agent ร้านค้าออนไลน์ที่สร้างด้วย `eve init` แล้วติดตั้ง `@eve-pdpa-extension/eve` ด้วย `eve add` ตาม README ของแพ็กเกจ

## What happens to a message

```
ลูกค้า: ขอ OTP ที่เบอร์ 091-888-7777 ค่ะ เลขบัตร 3-1005-00123-45-8
   │
   ▼  channel (agent/channels/eve.ts, pdpa.channel)
eve records:  ขอ OTP ที่เบอร์ [tok:phvbmbbcnsjkqpqd] ค่ะ เลขบัตร [เลขบัตรประชาชน]
   │
   ▼  model (agent/agent.ts, pdpa.model)       the model never sees the number
   │
   ▼  tool otp_send (agent/tools/otp_send.ts, pdpa.tool)
gets 0918887777: the policy allows the purpose "otp_send" for PHONE, for 5 minutes
   │
   ▼  reply: LINE, Telegram, Slack … show the token as xxx-xxx-7777;
      eve's HTTP channel (eve dev) shows [tok:…] as the model wrote it
```

The rules are in [`policies/pdpa-policy.json`](policies/pdpa-policy.json):

| Data | What the model sees |
|---|---|
| phone | `[tok:…]`; only `otp_send` can swap it back |
| national ID, LINE user ID, license plate, date of birth, passport | a label such as `[เลขบัตรประชาชน]` |
| email | `[EMAIL:…]`, a keyed fingerprint |
| bank account | last 4 digits |
| credit card | nothing: the whole message is stopped |

## Run it

Node 24 or later.

```bash
cd examples/pdpa-agent
npm install
cp .env.example .env.local        # fill in the keys (openssl rand -hex 32), or let eve dev use development keys
npx eve link                      # or set AI_GATEWAY_API_KEY in .env.local
npm run check                     # eve-pdpa-check: is every channel, the model and the hook wrapped?
npm run dev                       # eve dev: chat with the agent in the terminal
```

Type something with a phone number or an ID card number and ask for an OTP. The reply in `eve dev` shows the token as the model wrote it (eve's HTTP channel does not mask on the way out); the `otp_send` line on stdout shows the tool got the real number, and the audit lines show what was found and done, never the value.

## How it was made

```bash
npx eve@0.80.1 init pdpa-agent --non-interactive --model anthropic/claude-haiku-5.5
cd pdpa-agent
npx eve add https://cdn.jsdelivr.net/npm/@eve-pdpa-extension/eve@0.2.0/r/pdpa.json --overwrite
```

Then four edits:

- `agent/agent.ts`: `pdpa.model(…)`, `modelContextWindowTokens`, `defaultTools: false`;
- `agent/tools/otp_send.ts`: a tool wrapped with `pdpa.tool(…, "otp_send")`;
- `agent/instructions.md`: tells the model how to treat tokens and labels;
- the policy: rules for the 0.2 types and the 0.2.0 schema.

eve 0.80.x only: `@eve-pdpa-extension/eve` does not support eve 1.x yet.

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmintelligence-dev%2Feve-pdpa-extension%2Ftree%2Fmain%2Fexamples%2Fpdpa-agent&project-name=pdpa-agent&repository-name=pdpa-agent&env=PDPA_HMAC_KEY%2CPDPA_SESSION_KEY&envDescription=Two%20different%20random%20secrets%20of%2032%20bytes%20or%20more%2C%20one%20for%20each%20key.%20Make%20each%20with%3A%20openssl%20rand%20-hex%2032&envLink=https%3A%2F%2Fgithub.com%2Fmintelligence-dev%2Feve-pdpa-extension%2Ftree%2Fmain%2Fexamples%2Fpdpa-agent%23environment-variables&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22protocol%22%3A%22storage%22%7D%5D)

The button copies this folder into a new repository in your GitHub account and creates a Vercel project from it. On the way it:

1. **asks for two keys**, `PDPA_HMAC_KEY` and `PDPA_SESSION_KEY` (see [Environment variables](#environment-variables));
2. **creates an Upstash for Redis database** and connects it, which sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`. The free plan is enough to try it;
3. **builds and deploys** the agent (`eve build`). The model is called through the project's own AI Gateway, so no AI key is needed to start.

ปุ่มนี้คัดลอกโฟลเดอร์นี้ไปเป็น repo ใหม่ใน GitHub ของคุณ สร้างโปรเจกต์บน Vercel ให้กรอก key 2 ตัว สร้าง Redis (Upstash) ให้อัตโนมัติ แล้ว deploy โดยใช้ AI Gateway ของโปรเจกต์ ไม่ต้องใส่ key ของ AI

### Environment variables

| Variable | Needed | What it does | Where it comes from |
|---|---|---|---|
| `PDPA_HMAC_KEY` | yes | The key for `hash` (emails in this policy): the same value always gives the same fingerprint, so you can count and match without seeing it. Anyone with this key can test guesses against a fingerprint, so keep it secret. | Any random secret of 32 bytes or more: `openssl rand -hex 32`. You type it into the button's form. |
| `PDPA_SESSION_KEY` | yes | The key the chat id is derived from. Tokens belong to one chat, so a token from one conversation can never be resolved in another. | Another random secret, different from the first: `openssl rand -hex 32`. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | yes | The shared token store. On Vercel each request may run on a different machine, so a token issued on one has to be found by the tool running on another. **It holds the real values (for example, phone numbers) until their tokens expire**: 5 minutes in this policy, an hour at most, or when the chat ends. Guard the token like any other secret. | Set by the Upstash for Redis database the button creates. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work too. |
| `AI_GATEWAY_API_KEY` | recommended | An AI Gateway key with a spending limit. Without it the agent uses the project's AI Gateway access, which has no limit of its own. | [vercel.com/ai-gateway](https://vercel.com/ai-gateway): create a key, set a budget, then `vercel env add AI_GATEWAY_API_KEY production` and redeploy. |

In production (`VERCEL_ENV=production`), a missing key or token store **stops the agent from starting** and names the variable. That is on purpose: it is better than a deployment that loses tokens or uses development keys.

| ตัวแปร | ทำอะไร |
|---|---|
| `PDPA_HMAC_KEY` | key สำหรับทำ hash (อีเมลในกติกานี้) ค่าเดิมได้ผลเดิมเสมอ จึงนับหรือจับคู่ได้โดยไม่เห็นค่าจริง ต้องเก็บเป็นความลับ |
| `PDPA_SESSION_KEY` | key สำหรับสร้างรหัสห้องแชท token ของห้องหนึ่งจึงแลกในห้องอื่นไม่ได้ |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | ที่เก็บ token ที่ทุกเครื่องเห็นร่วมกัน **เก็บค่าจริงไว้ชั่วคราวจน token หมดอายุ** (5 นาทีในกติกานี้) ปุ่มสร้างให้ |
| `AI_GATEWAY_API_KEY` | ไม่บังคับ แต่แนะนำ: key ของ AI Gateway ที่ตั้งงบไว้ เพื่อคุมค่าใช้จ่าย |

### Talk to the deployed agent

The channel only lets in requests signed by Vercel (`vercelOidc()`), so a browser or a stranger gets `401` and cannot spend your AI budget. From a terminal where you are signed in to Vercel:

```bash
npx eve remote invoke -u https://<your-project>.vercel.app "ขอ OTP ที่เบอร์ 091-888-7777 ค่ะ"
npx eve remote connect -u https://<your-project>.vercel.app      # the terminal chat UI
```

The model gets `[tok:…]`, `otp_send` gets the real number, and the function logs on Vercel show `[otp_send] would send an OTP to the number ending 7777` next to the audit lines, which never hold a value.

To open the agent to customers, replace `placeholderAuth()` in `agent/channels/eve.ts` with your own sign-in first, or add a channel such as LINE or Telegram and wrap it the same way (see [Other channels](../../packages/eve/README.md#other-channels)).

### Deploy from the command line instead

```bash
npx vercel link
npx vercel integration add upstash/upstash-kv
openssl rand -hex 32 | npx vercel env add PDPA_HMAC_KEY production --sensitive
openssl rand -hex 32 | npx vercel env add PDPA_SESSION_KEY production --sensitive
npx eve deploy
```
