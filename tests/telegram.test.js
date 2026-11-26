import { describe, expect, it, vi } from 'vitest'
import { buildUpdate, escapeHtml, explainDeliveryError, postTelegram, requiredPrice } from '../scripts/lib/telegram.js'

const pick = {
  pick: 'home',
  probability: 60,
  home: 'Mainz',
  away: 'Union Berlin',
  league: 'Bundesliga',
  kickoff: '15:30 WAT',
}

const results = [
  { home: 'Werder Bremen', away: "M'gladbach", homeGoals: 2, awayGoals: 0, pick: 'Werder Bremen win', correct: true },
  { home: 'Levante', away: 'Elche', homeGoals: 1, awayGoals: 1, pick: 'Levante win', correct: false },
]

const record = { correct: 69, scored: 117 }
const ticket = { id: '2026-11-27', won: 0, lost: 0, push: 0, selections: 5 }

describe('telegram formatting', () => {
  it('escapes markup so a club name cannot break the message', () => {
    expect(escapeHtml('A & B <C>')).toBe('A &amp; B &lt;C&gt;')
    const text = buildUpdate({ day: 'Fri 27 Nov 2026', pick: { ...pick, home: '<b>Mainz</b>' }, results: [], record, siteUrl: 'https://example.test' })
    expect(text).toContain('&lt;b&gt;Mainz&lt;/b&gt; to win')
  })

  it('turns a probability into the price the pick needs', () => {
    expect(requiredPrice(0.6)).toBe(1.67)
    expect(requiredPrice(0.68)).toBe(1.48)
    expect(requiredPrice(0.25)).toBe(4)
    expect(requiredPrice(0)).toBeNull()
    expect(requiredPrice(1.2)).toBeNull()
  })

  it('posts the single, the latest scores, the record and the ticket', () => {
    const text = buildUpdate({ day: 'Fri 27 Nov 2026', pick, results, record, ticket, siteUrl: 'https://example.test/record' })
    expect(text).toContain('Pitchside — Fri 27 Nov 2026')
    expect(text).toContain('Mainz to win — 60%')
    expect(text).toContain('Only worth playing at 1.67 or better.')
    expect(text).toContain('✔ Werder Bremen 2–0 M&#39;gladbach'.replace('&#39;', "'"))
    expect(text).toContain('✘ Levante 1–1 Elche')
    expect(text).toContain('69 of 117 correct (59.0%)')
    expect(text).toContain('Ticket 2026-11-27: 0 won, 0 lost — still to settle')
    expect(text).toContain('href="https://example.test/record"')
  })

  it('says so on a day with no pick instead of inventing one', () => {
    const text = buildUpdate({ day: 'Wed 25 Nov 2026', pick: null, results: [], record: { correct: 0, scored: 0 } })
    expect(text).toContain('No verified, eligible match today.')
    expect(text).toContain('No scored forecasts yet.')
    expect(text).not.toContain('Only worth playing at')
  })

  it('never exceeds the Telegram limit', () => {
    const many = Array.from({ length: 300 }, (_, index) => ({ ...results[0], home: `Team ${index}` }))
    const text = buildUpdate({ day: 'Fri 27 Nov 2026', pick, results: many, record, siteUrl: 'https://example.test' })
    expect(text.length).toBeLessThanOrEqual(4096)
    expect(text.endsWith('…')).toBe(true)
  })
})

describe('delivery errors', () => {
  it('turns the common rejections into an instruction', () => {
    expect(explainDeliveryError('Bad Request: chat not found')).toMatch(/minus sign and a supergroup id starts with -100/)
    expect(explainDeliveryError('Forbidden: bot is not a member of the chat')).toMatch(/not in the group/)
    expect(explainDeliveryError('Forbidden: not enough rights to send text messages to the chat')).toMatch(/admin with permission/)
    expect(explainDeliveryError('Unauthorized')).toMatch(/TELEGRAM_BOT_TOKEN was rejected/)
    expect(explainDeliveryError('Bad Request: chat_id is empty')).toMatch(/TELEGRAM_CHAT_ID is empty/)
    expect(explainDeliveryError('Bad Request: unexpected server error')).toBe('Bad Request: unexpected server error')
  })
})

describe('telegram delivery', () => {
  const ok = { ok: true, result: { message_id: 42 } }

  it('sends HTML with the chat id and no token in the body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, json: async () => ok })
    const result = await postTelegram({ token: 'secret-token', chatId: '-100123', text: 'hello', fetchImpl })
    expect(result).toMatchObject({ ok: true, messageId: 42 })
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.telegram.org/botsecret-token/sendMessage')
    expect(options.body).not.toContain('secret-token')
    expect(JSON.parse(options.body)).toMatchObject({ chat_id: '-100123', parse_mode: 'HTML' })
  })

  it('skips quietly when the bot is not configured', async () => {
    const fetchImpl = vi.fn()
    await expect(postTelegram({ token: '', chatId: '', text: 'x', fetchImpl })).resolves.toMatchObject({ ok: false, skipped: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('waits once when Telegram rate-limits the group', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ status: 429, json: async () => ({ ok: false, parameters: { retry_after: 3 } }) })
      .mockResolvedValueOnce({ status: 200, json: async () => ok })
    const retryDelay = vi.fn().mockResolvedValue(undefined)
    const result = await postTelegram({ token: 't', chatId: 'c', text: 'x', fetchImpl, retryDelay })
    expect(result.ok).toBe(true)
    expect(retryDelay).toHaveBeenCalledWith(3000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('reports a rejection without leaking the token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 403, json: async () => ({ ok: false, description: 'Forbidden: bot is not a member of the chat' }) })
    const result = await postTelegram({ token: 'secret-token', chatId: 'c', text: 'x', fetchImpl })
    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(result.description).toBe('Forbidden: bot is not a member of the chat')
    expect(result.reason).toMatch(/not in the group/)
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })
})
