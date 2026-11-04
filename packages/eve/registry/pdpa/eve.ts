import { eveChannel } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";
import { pdpa } from "../lib/pdpa.js";

export default pdpa.channel(
  eveChannel({
    auth: [
      // Lets the eve TUI and your Vercel deployments reach the deployed agent.
      vercelOidc(),
      // Open on localhost for `eve dev` and the REPL; ignored in production.
      localDev(),
      // This placeholder will not allow browser requests in production.
      // Replace it with your app's auth provider, like Auth.js or Clerk,
      // or use none() for a public demo.
      placeholderAuth(),
    ],
  }),
  // eve's HTTP channel streams the model's reply as written, so a token the
  // model repeats ([tok:…]) is shown as is. A token is not the value. Channels
  // that post their replies (Slack, Telegram, …) show xxx-xxx-7777 instead.
  { allowRawTokensInOutput: true },
);
