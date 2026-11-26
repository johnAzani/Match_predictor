import { describe, expect, it, vi } from 'vitest'
import { buildUpdate, escapeHtml, explainDeliveryError, liveTickets, postTelegram, requiredPrice, withoutTicketMatches } from '../scripts/lib/telegram.js'

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
const pendingTicket = {
  id: '2026-11-27',
  label: 'Weekend of 27–29 November 2026',
  won: 0, lost: 0, push: 0,
  selections: [
    { day: 'Fri 27 Nov', home: 'Werder Bremen', away: "M'gladbach", fixture: 'Werder Bremen v M\'gladbach', pick: 'Werder Bremen win', probability: '68%', need: '1.48', state: 'pending', score: null },
    { day: 'Sat 28 Nov', home: 'Mainz', away: 'Union Berlin', fixture: 'Mainz v Union Berlin', pick: 'Mainz win', probability: '60%', need: '1.68', state: 'pending', score: null },
  ],
}

const settledTicket = {
  id: '2026-11-27',
  label: 'Weekend of 27–29 November 2026',
  won: 1, lost: 1, push: 0,
  selections: [
    { day: 'Fri 27 Nov', home: 'Werder Bremen', away: "M'gladbach", fixture: 'Werder Bremen v M\'gladbach', pick: 'Werder Bremen win', probability: '68%', need: '1.48', state: 'won', score: 'Werder Bremen 2 : 0 M\'gladbach' },
    { day: 'Sat 28 Nov', home: 'Mainz', away: 'Union Berlin', fixture: 'Mainz v Union Berlin', pick: 'Mainz win', probability: '60%', need: '1.68', state: 'lost', score: 'Mainz 0 : 1 Union Berlin' },
  ],
}

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

  it('posts the single, the latest scores and the record', () => {
    const text = buildUpdate({ day: 'Fri 27 Nov 2026', pick, results, record, siteUrl: 'https://example.test/record' })
    expect(text).toContain('<b>Pitchside</b> · Fri 27 Nov 2026')
    expect(text).toContain('<b>Mainz to win</b> — 60%')
    expect(text).toContain('Min price 1.67')
    expect(text).toContain("✅ Werder Bremen 2–0 M'gladbach · Werder Bremen win")
    expect(text).toContain('❌ Levante 1–1 Elche · Levante win')
    expect(text).toContain('59.0%</b> · 69 of 117 correct')
    expect(text).toContain('href="https://example.test/record"')
  })

  it('says so on a day with no pick instead of inventing one', () => {
    const text = buildUpdate({ day: 'Wed 25 Nov 2026', pick: null, results: [], record: { correct: 0, scored: 0 } })
    expect(text).toContain('No eligible match today')
    expect(text).toContain('No scored picks yet')
    expect(text).not.toContain('Min price')
  })

  it('lists a pending ticket with the price each selection needs', () => {
    const text = buildUpdate({ day: 'Fri 27 Nov 2026', pick, results: [], record, ticket: pendingTicket })
    expect(text).toContain('<b>🎫 Ticket 2026-11-27</b>')
    expect(text).toContain('<i>2 singles · booked separately</i>')
    expect(text).toContain("▫️ Fri 27 Nov · Werder Bremen v M'gladbach → Werder Bremen win, 68%, min 1.48")
    expect(text).toContain('<i>2 to settle</i>')
    expect(text).toContain('<i>Book each at its min price or better</i>')
  })

  it('replaces the price with the score once a selection has settled', () => {
    const text = buildUpdate({ day: 'Sat 28 Nov 2026', pick, results: [], record, ticket: settledTicket })
    expect(text).toContain("✅ Fri 27 Nov · Werder Bremen 2 : 0 M'gladbach → Werder Bremen win")
    expect(text).toContain("❌ Sat 28 Nov · Mainz 0 : 1 Union Berlin → Mainz win")
    expect(text).toContain('<i>1 won · 1 lost</i>')
    expect(text).not.toContain('Book each at its min price')
  })

  it('posts a multiple as one slip with the combined price', () => {
    const text = buildUpdate({
      day: 'Fri 27 Nov 2026', pick, results: [], record,
      ticket: {
        ...pendingTicket,
        multiples: [{ short: 'Double', legs: ['Werder Bremen', 'Mainz'], probability: '40.8', need: '2.46', state: 'pending' }],
      },
    })
    expect(text).toContain('<b>🧮 Multiples</b>')
    expect(text).toContain('<i>One slip · every leg must win · different matches</i>')
    expect(text).toContain('▫️ Double · Werder Bremen + Mainz → 40.8%, min 2.46')
  })

  it('drops the price once the multiple has settled', () => {
    const text = buildUpdate({
      day: 'Fri 27 Nov 2026', pick, results: [], record,
      ticket: {
        ...settledTicket,
        multiples: [{ short: 'Double', legs: ['Werder Bremen', 'Mainz'], probability: '40.8', need: '2.46', state: 'won' }],
      },
    })
    expect(text).toContain('✅ Double · Werder Bremen + Mainz')
    expect(text).not.toContain('min 2.46')
  })

  it('never posts a multiple whose legs share a match', () => {
    const text = buildUpdate({
      day: 'Fri 27 Nov 2026', pick, results: [], record,
      ticket: { ...pendingTicket, multiples: [{ short: 'Refused', legs: ['Werder Bremen', 'Werder Bremen'], state: 'invalid' }] },
    })
    expect(text).not.toContain('🧮')
    expect(text).not.toContain('Refused')
  })

  it('adds the all-time ticket tally once there is more than one ticket', () => {
    const withTotals = { ...settledTicket, totals: { won: 4, lost: 3, selections: 9 } }
    const text = buildUpdate({ day: 'Sat 28 Nov 2026', pick, results: [], record, ticket: withTotals })
    expect(text).toContain('Tickets 4–3 · 9 selections')
  })

  it('does not repeat a fixture that the ticket already scores', () => {
    const settled = settledTicket.selections
    const kept = withoutTicketMatches(results, settled)
    // The Werder result is in the ticket; Levante is not.
    expect(kept.map((result) => result.home)).toEqual(['Levante'])
    expect(withoutTicketMatches(results, [])).toHaveLength(2)
    const text = buildUpdate({ day: 'Fri 27 Nov 2026', pick, results, record, ticket: settledTicket })
    // Werder is on the ticket, so its score is shown there and not repeated in
    // the results list; Levante is not on the ticket, so it stays.
    expect(text).not.toContain('Werder Bremen 2–0')
    expect(text).toContain('❌ Levante 1–1 Elche · Levante win')
    expect(text).toContain('❌ Sat 28 Nov · Mainz 0 : 1 Union Berlin → Mainz win')
  })

  it('posts two slips when both still have a leg to play', () => {
    const sunday = {
      id: '2026-11-29',
      won: 0, lost: 0, push: 0,
      selections: [
        { day: 'Sun 29 Nov', home: 'Roma', away: 'Monza', fixture: 'Roma v Monza', pick: 'Roma win', probability: '69%', need: '1.46', state: 'pending', score: null },
      ],
    }
    const text = buildUpdate({
      day: 'Fri 27 Nov 2026', pick, results: [], record,
      tickets: [pendingTicket, sunday],
      totals: { won: 0, lost: 0, selections: 3 },
    })
    expect(text).toContain('<b>🎫 Ticket 2026-11-27</b>')
    expect(text).toContain('<b>🎫 Ticket 2026-11-29</b>')
    // Every leg is shown, and the ledger tally is left out because all of it is
    // already on the message.
    expect(text).toContain('▫️ Sun 29 Nov · Roma v Monza → Roma win, 69%, min 1.46')
    expect(text).not.toContain('Tickets 0–0')
  })

  it('orders slips by their next game, not by their name', () => {
    const slip = (id, date) => ({ id, pending: 1, unrecorded: 0, selectedAt: '2026-11-26T00:00:00Z', selections: [{ date, state: 'pending' }] })
    // A week slip is named last but its first leg is days after tonight's game.
    expect(liveTickets([slip('2026-W49', '2026-12-04'), slip('2026-11-27', '2026-11-27')]).map((ticket) => ticket.id))
      .toEqual(['2026-11-27', '2026-W49'])

    const weekSlip = {
      id: '2026-W49', won: 0, lost: 0, push: 0,
      selections: [{ day: 'Fri 4 Dec', home: 'Bayern', away: 'Paderborn', fixture: 'Bayern v Paderborn', pick: 'Bayern win', probability: '75%', need: '1.33', state: 'pending', score: null }],
    }
    const text = buildUpdate({ day: 'Thu 26 Nov 2026', pick, results: [], record, tickets: [pendingTicket, weekSlip] })
    expect(text.indexOf('🎫 Ticket 2026-11-27')).toBeLessThan(text.indexOf('🎫 Ticket 2026-W49'))
  })

  it('keeps the newest slip when there are more than three', () => {
    const slip = (id, date, selectedAt) => ({ id, pending: 1, unrecorded: 0, selectedAt, selections: [{ date, state: 'pending' }] })
    const live = [
      slip('2026-11-27', '2026-11-27', '2026-11-25T00:00:00Z'),
      slip('2026-11-28', '2026-11-28', '2026-11-25T00:00:00Z'),
      slip('2026-11-29', '2026-11-29', '2026-11-25T00:00:00Z'),
      slip('2026-W49', '2026-12-04', '2026-11-26T12:00:00Z'),
    ]
    expect(liveTickets(live).map((ticket) => ticket.id)).toEqual(['2026-11-27', '2026-11-28', '2026-W49'])
  })

  it('counts the slips it could not fit instead of hiding them', () => {
    const text = buildUpdate({
      day: 'Thu 26 Nov 2026', pick, results: [], record,
      tickets: [pendingTicket],
      totals: { won: 0, lost: 0, selections: 2, live: 4 },
    })
    expect(text).toContain('<i>+3 more slips on the site</i>')
  })

  it('shows the slips still in play and hides the ones already settled', () => {
    const summarized = [
      { id: '2026-11-29', pending: 4, unrecorded: 0 },
      { id: '2026-11-27', pending: 0, unrecorded: 0 },
      { id: '2026-11-21', pending: 0, unrecorded: 0 },
    ]
    expect(liveTickets(summarized).map((ticket) => ticket.id)).toEqual(['2026-11-29'])
    // Two live slips are shown soonest-first, so the one in play tonight is read first.
    expect(liveTickets([
      { id: '2026-11-29', pending: 4, unrecorded: 0 },
      { id: '2026-11-27', pending: 5, unrecorded: 0 },
    ]).map((ticket) => ticket.id)).toEqual(['2026-11-27', '2026-11-29'])
    // With everything settled, the newest slip is still shown.
    expect(liveTickets(summarized.slice(1)).map((ticket) => ticket.id)).toEqual(['2026-11-27', '2026-11-21'])
    expect(liveTickets([])).toEqual([])
  })

  it('never exceeds the Telegram limit', () => {
    const many = Array.from({ length: 300 }, (_, index) => ({ ...results[0], home: `Team ${index}` }))
    const text = buildUpdate({ day: 'Fri 27 Nov 2026', pick, results: many, record, ticket: pendingTicket, siteUrl: 'https://example.test' })
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
