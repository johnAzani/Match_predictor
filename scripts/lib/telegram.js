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
    `<i>${count} single${count === 1 ? '' : 's'} · booked separately</i>`,
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
  // With multiples on the same message, the two tallies need naming.
  const singles = ticket.multiples?.length ? `Singles ${summary}` : summary
  const multiples = multipleLines(ticket.multiples)
  if (multiples.length) lines.push('', ...multiples)
  lines.push('', `<i>${singles}</i>`)
  if (settled === 0) lines.push('<i>Book each at its min price or better</i>')
  return lines
}

// A multiple is one slip whose legs come from different matches, so it is shown
// as a single line with the combined price: too many legs and the slip stops
// fitting on a phone.
function multipleLines(multiples = []) {
  const valid = multiples.filter((multiple) => multiple.state !== 'invalid')
  if (!valid.length) return []
  const lines = [heading('🧮', 'Multiples'), '<i>One slip · every leg must win · different matches</i>']
  for (const multiple of valid) {
    const name = escapeHtml(multiple.short ?? multiple.label ?? 'Multiple')
    const legs = escapeHtml((multiple.legs ?? []).map((leg) => leg.short ?? leg.name ?? leg).join(' + '))
    const mark = SETTLED_MARKS[multiple.state] ?? PENDING_MARK
    if (multiple.state === 'won' || multiple.state === 'lost' || multiple.state === 'push') {
      lines.push(`${mark} ${name} · ${legs}`)
    } else {
      lines.push(`${mark} ${name} · ${legs} → ${escapeHtml(multiple.probability)}%, min ${escapeHtml(multiple.need)}`)
    }
  }
  const decided = valid.filter((multiple) => multiple.state === 'won' || multiple.state === 'lost')
  if (decided.length) {
    const won = decided.filter((multiple) => multiple.state === 'won').length
    const open = valid.length - decided.length
    lines.push(`<i>Multiples ${won} won · ${decided.length - won} lost${open ? ` · ${open} open` : ''}</i>`)
  }
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

function recordLines(record, totals, shownSelections) {
  const lines = [heading('📈', 'Record')]
  lines.push(record && record.scored > 0
    ? `<b>${(100 * record.correct / record.scored).toFixed(1)}%</b> · ${record.correct} of ${record.scored} correct`
    : 'No scored picks yet')
  if (totals && totals.selections > shownSelections) {
    lines.push(`Tickets ${totals.won}–${totals.lost} · ${totals.selections} selections`)
  }
  return lines
}

// The group follows the slips it is actually holding: every ticket that still has
// a leg to play, newest first, capped so the message stays readable. When the
// whole slate is settled, the newest ticket is shown so the section is not empty.
export const LIVE_SLIP_LIMIT = 3

// The next game on a slip still to be settled. A week slip's first leg can be
// days away, so its id would sort it wrongly against tonight's slip.
function nextFixtureDate(ticket) {
  const dates = (ticket.selections ?? [])
    .filter((selection) => !selection.state || selection.state === 'pending' || selection.state === 'unrecorded')
    .map((selection) => selection.date)
    .filter(Boolean)
    .sort()
  return dates[0] ?? '9999-12-31'
}

const byNextGame = (a, b) => nextFixtureDate(a).localeCompare(nextFixtureDate(b)) || String(a.id).localeCompare(String(b.id))

export function liveTickets(summarized, limit = LIVE_SLIP_LIMIT) {
  const slips = Array.isArray(summarized) ? summarized : []
  const live = slips.filter((ticket) => (ticket.pending ?? 0) + (ticket.unrecorded ?? 0) > 0)
  if (!live.length) return slips.slice(0, limit)

  // Soonest kick-off first: the slip being played tonight is read first.
  const ordered = live.slice().sort(byNextGame)
  if (ordered.length <= limit) return ordered

  // A cap must never bury the newest slip: it is the one that can still be
  // booked. It takes the last slot, and the rest are counted, not hidden.
  const newest = live.reduce((best, ticket) => (
    String(ticket.selectedAt ?? ticket.id) > String(best.selectedAt ?? best.id) ? ticket : best
  ), live[0])
  const shown = ordered.slice(0, limit)
  if (!shown.includes(newest)) shown[shown.length - 1] = newest
  return shown.sort(byNextGame)
}

/**
 * The message posted to the group: the day's pick, every ticket that still has a
 * leg to play, the latest scores and the running record. `ticket` is the older
 * single-slip form; `tickets` carries several slips at once. Empty sections are
 * dropped rather than filled with "nothing today", and nothing is invented.
 */
export function buildUpdate({ day, pick, results = [], record, ticket, tickets, totals, siteUrl }) {
  const slips = (Array.isArray(tickets) ? tickets : ticket ? [ticket] : []).filter(Boolean)
  const ledger = totals ?? ticket?.totals ?? null
  const selections = slips.flatMap((slip) => slip.selections ?? [])
  const hidden = Math.max(0, (ledger?.live ?? 0) - slips.length)
  const lines = [
    `<b>Pitchside</b> · ${escapeHtml(day)}`,
    '',
    ...pickLines(pick),
    ...slips.flatMap((slip) => ticketLines(slip)),
    ...(hidden > 0 ? [`<i>+${hidden} more slip${hidden === 1 ? '' : 's'} on the site</i>`] : []),
    ...resultLines(withoutTicketMatches(results, selections)),
    '',
    ...recordLines(record, ledger, selections.length),
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
