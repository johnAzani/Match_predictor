// Telegram delivery. Everything here is pure formatting plus one HTTP call, so
// the wording can be tested without a bot and the token never leaves the script.
import { normalizeName } from '../../src/lib/ticket.js'

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
const heading = (emoji, label) => `<b>${emoji} ${label}</b>`
const num = (value) => Number(value).toFixed(2)

function pickLines(pick) {
  if (!pick) return [heading('🎯', 'Today’s pick'), '<i>No eligible match today</i>']
  const name = pick.pick === 'draw' ? 'Draw' : `${pick.pick === 'home' ? pick.home : pick.away} to win`
  return [
    heading('🎯', 'Today’s pick'),
    `<b>${escapeHtml(name)}</b> — ${pick.probability}%`,
    `${escapeHtml(pick.league)} · ${escapeHtml(pick.kickoff)}`,
    `Min price ${price(requiredPrice(pick.probability / 100))}`,
  ]
}

// One line per selection, so the whole slip can be read on a phone without
// wrapping. Pending rows carry the price to book at; settled rows carry the
// score that decided them.
const PENDING_MARK = '▫️'
const SETTLED_MARKS = { won: '✅', lost: '❌', push: '➖' }

function ticketLines(ticket) {
  if (!ticket || !ticket.selections?.length) return []
  const count = ticket.selections.length
  const settled = ticket.won + ticket.lost + ticket.push
  const lines = [
    '',
    heading('🎫', `Ticket ${escapeHtml(ticket.id)}`),
    `<i>${count} single${count === 1 ? '' : 's'} · booked separately, never multiplied</i>`,
  ]
  for (const selection of ticket.selections) {
    const mark = SETTLED_MARKS[selection.state] ?? PENDING_MARK
    lines.push(mark === PENDING_MARK
      ? `${mark} ${escapeHtml(selection.day)} · ${escapeHtml(selection.fixture)} → ${escapeHtml(selection.pick)}, ${escapeHtml(selection.probability)}, min ${escapeHtml(selection.need)}`
      : `${mark} ${escapeHtml(selection.day)} · ${escapeHtml(selection.score ?? '')} → ${escapeHtml(selection.pick)}`)
  }
  const summary = settled
    ? `${ticket.won} won · ${ticket.lost} lost${ticket.push ? ` · ${ticket.push} push` : ''}${count > settled ? ` · ${count - settled} to settle` : ''}`
    : `${count} to settle`
  lines.push('', `<i>${summary}</i>`)
  if (settled === 0) lines.push('<i>Book each at its min price or better</i>')
  return lines
}

// A ticket row already shows its own score, so repeating that fixture in the
// results list is noise. Names differ between sources, so compare loosely.
export function withoutTicketMatches(results, selections = []) {
  const team = (a, b) => a === b || a.endsWith(b) || b.endsWith(a)
  return results.filter((result) => !selections.some((selection) => selection.home && selection.away &&
    team(normalizeName(result.home), normalizeName(selection.home)) &&
    team(normalizeName(result.away), normalizeName(selection.away))))
}

function resultLines(results) {
  if (!results.length) return []
  return [
    '',
    heading('📋', 'Latest results'),
    ...results.map((result) => `${result.correct ? '✅' : '❌'} ${escapeHtml(result.home)} ${result.homeGoals}–${result.awayGoals} ${escapeHtml(result.away)} · ${escapeHtml(result.pick)}`),
  ]
}

function recordLines(record, ticket) {
  const lines = [heading('📈', 'Record')]
  lines.push(record && record.scored > 0
    ? `<b>${(100 * record.correct / record.scored).toFixed(1)}%</b> · ${record.correct} of ${record.scored} correct`
    : 'No scored picks yet')
  if (ticket?.totals && ticket.totals.selections > ticket.selections.length) {
    lines.push(`Tickets ${ticket.totals.won}–${ticket.totals.lost} · ${ticket.totals.selections} selections`)
  }
  return lines
}

/**
 * The message posted to the group: the day's pick, the bookable ticket, the
 * latest scores and the running record. Empty sections are dropped rather than
 * filled with "nothing today", and nothing is invented.
 */
export function buildUpdate({ day, pick, results = [], record, ticket, siteUrl }) {
  const lines = [
    `<b>Pitchside</b> · ${escapeHtml(day)}`,
    '',
    ...pickLines(pick),
    ...ticketLines(ticket),
    ...resultLines(withoutTicketMatches(results, ticket?.selections ?? [])),
    '',
    ...recordLines(record, ticket),
  ]
  if (siteUrl) lines.push('', `<a href="${escapeHtml(siteUrl)}">Full record and method →</a>`)
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
