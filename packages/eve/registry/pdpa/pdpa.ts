import { createPdpa } from "@eve-pdpa-extension/eve/guard";
import policy from "../../policies/pdpa-policy.json" with { type: "json" };

// One guard for the whole agent. Keys come from PDPA_HMAC_KEY and
// PDPA_SESSION_KEY; tokens are kept in Upstash when UPSTASH_REDIS_REST_* or
// KV_REST_API_* is set. On Vercel production (VERCEL_ENV=production) a missing
// key or token store stops the agent from starting, instead of leaking later.
export const pdpa = createPdpa({ policy });
