// Telegram delivery. Everything here is pure formatting plus one HTTP call, so
// the wording can be tested without a bot and the token never leaves the script.
export const TELEGRAM_API = 'https://api.telegram.org'
export const MAX_MESSAGE_LENGTH = 4096

export function escapeHtml(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// The price a selection needs to break even. Rounding up keeps the advice on the
// safe side of the fair price rather than a kobo below it.
export function requiredPrice(probability) {
  if (!Number.isFinite(probability) || probability <= 0 || probability > 1) return null
  return Math.ceil((1 / probability) * 100) / 100
}

const price = (value) => (value === null ? '—' : value.toFixed(2))

function pickLines(pick) {
  if (!pick) return ['<b>TODAY’S SINGLE</b>', 'No verified, eligible match today. Some days have no pick.']
  const name = pick.pick === 'draw'
    ? 'Draw'
    : `${pick.pick === 'home' ? pick.home : pick.away} to win`
  const probability = pick.probability / 100
  return [
    '<b>TODAY’S SINGLE</b>',
    `${escapeHtml(name)} — ${pick.probability}%`,
    `${escapeHtml(pick.league)} · ${escapeHtml(pick.kickoff)}`,
    `Only worth playing at ${price(requiredPrice(probability))} or better.`,
  ]
}

// Pending and not-yet-in-the-ledger look the same to a reader: not settled.
const TICKET_MARKS = { won: '✔', lost: '✘', push: '➖', pending: '•', unrecorded: '•' }

// The ticket is published so it can be booked, then scored so it can be
// checked. Both views are the same list: a pending row shows the price it
// needs, a settled row shows the score it got.
function ticketLines(ticket) {
  if (!ticket || !ticket.selections?.length) return []
  const pending = ticket.selections.filter((selection) => selection.state === 'pending' || selection.state === 'unrecorded')
  const lines = [
    `<b>TICKET ${escapeHtml(ticket.id)}</b>${ticket.label ? ` — ${escapeHtml(ticket.label)}` : ''}`,
    `${ticket.selections.length} independent single${ticket.selections.length === 1 ? '' : 's'} · never multiplied`,
  ]
  for (const selection of ticket.selections) {
    const mark = TICKET_MARKS[selection.state] ?? '•'
    if (selection.state === 'won' || selection.state === 'lost' || selection.state === 'push') {
      lines.push(`${mark} ${escapeHtml(selection.day)} · ${escapeHtml(selection.score ?? '')} — ${escapeHtml(selection.pick)}`)
    } else {
      lines.push(`${mark} ${escapeHtml(selection.day)} · ${escapeHtml(selection.fixture)} — ${escapeHtml(selection.pick)} · ${escapeHtml(selection.probability)} · needs ${escapeHtml(selection.need)}`)
    }
  }
  const settled = ticket.won + ticket.lost + ticket.push
  lines.push(settled
    ? `${ticket.won} won · ${ticket.lost} lost${ticket.push ? ` · ${ticket.push} push` : ''}${ticket.selections.length > settled ? ` · ${ticket.selections.length - settled} to settle` : ''}`
    : `${ticket.selections.length} still to settle`)
  if (pending.length) lines.push('Book each one at the price shown or better — below it, a winning pick still loses money.')
  if (ticket.totals && ticket.totals.selections > ticket.selections.length) {
    lines.push(`All tickets: ${ticket.totals.won} won · ${ticket.totals.lost} lost from ${ticket.totals.selections} selections`)
  }
  return ['', ...lines]
}

function resultLines(results) {
  if (!results.length) return ['<b>RESULTS</b>', 'No settled matches in the last day.']
  return [
    '<b>RECENT RESULTS</b>',
    ...results.map((result) => {
      const score = `${result.homeGoals}–${result.awayGoals}`
      const mark = result.correct ? '✔' : '✘'
      return `${mark} ${escapeHtml(result.home)} ${score} ${escapeHtml(result.away)} — ${escapeHtml(result.pick)}`
    }),
  ]
}

/**
 * The message posted to the group: one pick, the latest scores, the running
 * record and the ticket state. Nothing is invented — an empty day says so.
 */
export function buildUpdate({ day, pick, results = [], record, ticket, siteUrl }) {
  const lines = [`<b>Pitchside — ${escapeHtml(day)}</b>`, '', ...pickLines(pick), ...ticketLines(ticket), '', ...resultLines(results), '', '<b>RECORD</b>']
  if (record && record.scored > 0) {
    lines.push(`${record.correct} of ${record.scored} correct (${(100 * record.correct / record.scored).toFixed(1)}%)`)
  } else {
    lines.push('No scored forecasts yet.')
  }
  if (siteUrl) lines.push('', `<a href="${escapeHtml(siteUrl)}">Full record and method</a>`)
  const text = lines.join('\n')
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 4)}\n…` : text
}

// Telegram's descriptions are accurate but terse. Turn the ones people hit
// into an instruction, so a failed run says what to change.
export function explainDeliveryError(description) {
  const text = String(description ?? '')
  if (/chat not found/i.test(text)) {
    return 'The bot cannot see that chat. A group id keeps its minus sign and a supergroup id starts with -100, the bot must be a member of the group, and it must have received a message there at least once.'
  }
  if (/bot was blocked/i.test(text)) return 'The bot was blocked: unblock it in the group or re-add it.'
  if (/bot is not a member/i.test(text)) return 'The bot is not in the group: add it, then send it a message there.'
  if (/not enough rights/i.test(text)) return 'The group restricts posting: make the bot an admin with permission to send messages.'
  if (/Unauthorized/i.test(text)) return 'TELEGRAM_BOT_TOKEN was rejected: copy it again from BotFather, with no spaces.'
  if (/chat_id is empty/i.test(text)) return 'TELEGRAM_CHAT_ID is empty: add the group id as a repository secret.'
  if (/can't parse entities|unsupported start tag/i.test(text)) return 'Telegram rejected the message formatting.'
  return text
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Telegram answers 429 with retry_after when a group is busy; one retry is
// enough for a once-a-day message, and the token is never logged.
export async function postTelegram({ token, chatId, text, fetchImpl = fetch, apiBase = TELEGRAM_API, retryDelay = sleep }) {
  if (!token || !chatId) return { ok: false, skipped: true, reason: 'Telegram is not configured.' }
  const url = `${apiBase}/bot${token}/sendMessage`
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  const send = async () => {
    const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    let payload = null
    try { payload = await response.json() } catch { payload = null }
    return { status: response.status, payload }
  }
  let attempt = await send()
  if (attempt.status === 429 && attempt.payload?.parameters?.retry_after) {
    await retryDelay(Math.min(30, attempt.payload.parameters.retry_after) * 1000)
    attempt = await send()
  }
  if (attempt.payload?.ok) return { ok: true, messageId: attempt.payload.result?.message_id ?? null }
  const description = attempt.payload?.description ?? 'Telegram rejected the message.'
  return { ok: false, status: attempt.status, description, reason: explainDeliveryError(description) }
}
