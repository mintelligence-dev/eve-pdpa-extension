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

## Deploy

See [Deploy on Vercel](../../packages/eve/README.md#deploy-on-vercel) in the eve package's README. In production it needs both keys and a shared token store (Upstash Redis), or it refuses to start. Replace `placeholderAuth()` in `agent/channels/eve.ts` with your own sign-in first.
