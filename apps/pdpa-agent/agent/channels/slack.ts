import { pdpaSlackRenderer, withPdpaGuard } from '@eve-pdpa-extension/eve/guard'
import { slackChannel } from 'eve/channels/slack'
import { pdpa } from '../lib/guard.js'

// Slack, the channel customers use: inbound masked by withPdpaGuard, replies
// rewritten by pdpaSlackRenderer — a phone token the model repeats reaches the
// customer as xxx-xxx-7777, never as [tok:…]. channelName is this file's stem.
//
// Credentials come from SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET; without
// them the agent still starts, and eve's Slack route refuses unsigned events.
export default withPdpaGuard(slackChannel({ renderers: [pdpaSlackRenderer(pdpa)] }), {
  ...pdpa,
  channelName: 'slack',
})
