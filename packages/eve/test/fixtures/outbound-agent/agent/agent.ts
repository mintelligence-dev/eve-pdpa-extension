import { defineAgent } from 'eve'
import { mockModel } from 'eve/evals'

const TOKEN = /\[tok:[a-z]{16}\]/

// Reads a token and repeats it, or asks for a tool call that needs approval.
export default defineAgent({
  model: mockModel(({ lastUserMessage, toolResults }) => {
    const token = TOKEN.exec(lastUserMessage ?? '')?.[0] ?? ''
    if (toolResults.length > 0) return 'เสร็จแล้ว'
    if ((lastUserMessage ?? '').includes('ขอ OTP')) {
      return { toolCalls: [{ name: 'otp_send', input: { phone: token } }] }
    }
    return `ส่ง OTP ไปที่ ${token} แล้วค่ะ`
  }),
  defaultTools: false,
})
