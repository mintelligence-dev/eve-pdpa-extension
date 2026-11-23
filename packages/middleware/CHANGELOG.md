# Changelog

## Unreleased

- New package. `pdpaExpress`, `pdpaHono` and `withPdpa` (Next.js route handlers) protect the customer's text in a JSON request body with a core guard before the handler runs, and with `responseFields` check a JSON reply on the way out. `protectRequest` / `protectResponse` do the same for any web-standard `Request`, and `protectBody` for parsed JSON from any framework. Field presets `chat` (default), `openai`, `anthropic` and `ai-sdk`. A blocked message is answered 422 with `blockedBy` unless `onBlocked` says otherwise. `createGuard`, `definePolicy`, `parsePolicy` and `PdpaError` are re-exported from core, so this package alone is enough to install.
