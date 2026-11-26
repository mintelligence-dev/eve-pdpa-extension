# @eve-pdpa-extension/mcp

An MCP server with two tools, `pdpa_scan` and `pdpa_redact`, so an AI agent — Claude Code, Claude Desktop, Cursor or any other MCP client — can find and hide Thai personal data before text leaves it. Built on [`@eve-pdpa-extension/core`](https://www.npmjs.com/package/@eve-pdpa-extension/core): everything runs on your machine, and nothing is sent anywhere.

[ภาษาไทย](./README.th.md)

> Not published yet.

## What it does

| Tool | The agent sends | It gets back |
|---|---|---|
| `pdpa_scan` | a text | what personal data is in it, where, and how sure — never the values, never the text |
| `pdpa_redact` | a text | the text with the personal data hidden, as your policy says |

Say you ask an agent to summarise today's customer chats into a ticket. Before the text goes into the ticket, it calls `pdpa_redact`, and the ticket gets `โทร [เบอร์โทร]` instead of the number.

Both tools take an optional `context`: the message just before, such as the question a bot asked. A reply that is only `123-4-56789-0` after `ขอเลขบัญชีค่ะ` is then found as a bank account. `context` is read for cue words only and never comes back.

## Install

Needs Node 20 or later. The client starts the server itself; you only tell it how.

**Claude Code**

```bash
claude mcp add pdpa -- npx -y @eve-pdpa-extension/mcp
```

**Claude Desktop** (`claude_desktop_config.json`) or **Cursor** (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "pdpa": {
      "command": "npx",
      "args": ["-y", "@eve-pdpa-extension/mcp", "--policy", "/path/to/pdpa-policy.json"]
    }
  }
}
```

## Policy

Without `--policy`, every type is redacted: `โทร 0812345678` becomes `โทร [เบอร์โทร]`. To choose per type, pass a policy file — the same JSON `createGuard` takes, described in [core's README](../core/README.md#policy):

```json
{
  "entitySet": "0.1",
  "entities": {
    "PHONE": { "action": "mask", "keep": "last4" },
    "CREDIT_CARD": { "action": "block" }
  }
}
```

- `redact`, `mask` and `flag` work as in core.
- `block`: `pdpa_redact` answers an error naming the types (`pdpa: blocked by policy (CREDIT_CARD)`), with no text. `pdpa_scan` still reports the value, with `action: "block"`.
- `hash` needs a secret: set `PDPA_HMAC_KEY` in the server's environment (`"env": { "PDPA_HMAC_KEY": "…" }` in the client config). Without it the server does not start.
- `tokenise` is refused: the server does not start, and says why. A token is only useful to a tool that can turn it back into the value, and this server has none.

## The tools

`pdpa_scan` with `{ "text": "โทร 0812345678 หรือ somchai@example.com" }`:

```json
{
  "found": 2,
  "byType": { "PHONE": 1, "EMAIL": 1 },
  "findings": [
    { "entity": "PHONE", "start": 4, "end": 14, "confidence": 0.99, "action": "redact" },
    { "entity": "EMAIL", "start": 20, "end": 39, "confidence": 0.97, "action": "redact" }
  ]
}
```

`start` and `end` count characters of the text that was sent. `action` is what the policy would do; scan changes nothing.

`pdpa_redact` with the same text: the text `โทร [เบอร์โทร] หรือ [อีเมล]`, and as structured content `{ "text": "…", "byType": { "PHONE": 1, "EMAIL": 1 } }`.

Each tool takes up to 20,000 characters of `text` (and of `context`); split a longer text. Both are marked read-only.

## Options

| Option | |
|---|---|
| `--policy <file>` | The policy to apply · default: every type redacted |
| `--audit <file>` | Append audit events to this file, one JSON line each · default: stderr. A new file is created readable by its owner only (`600`). If the file cannot be written at start, the server does not start (exit 2); if a write fails later, a line on stderr says which event was lost |
| `-h`, `--help` · `-v`, `--version` | |

| Environment | |
|---|---|
| `PDPA_HMAC_KEY` | The secret for a policy that hashes · required if it does |

Audit events never hold a value: they record the type, the position and the action. stdout carries the MCP protocol only.

## In your own program

The server is exported, not yet connected, for a host that runs its own transport:

```ts
import { createGuard } from '@eve-pdpa-extension/core'
import { createPdpaServer, defaultPolicy } from '@eve-pdpa-extension/mcp'

const server = createPdpaServer({ guard: createGuard({ policy: defaultPolicy(), onAudit: log }) })
await server.connect(transport)
```

## Known limitations

- **stdio only** · no HTTP transport yet
- **No `tokenise`** · see Policy
- **Error messages are generic** · if the text cannot be checked, the tool answers `pdpa: the text could not be checked` and nothing more, so no part of the text can travel in an error
- **The agent decides when to call it** · the tools protect what they are given; they do not watch what an agent sends elsewhere. To protect every message an eve agent handles, use [`@eve-pdpa-extension/eve`](../eve/README.md)
