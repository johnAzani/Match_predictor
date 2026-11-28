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
  const open = count - settled
  const lines = [
    '',
    heading('🎫', `Ticket ${escapeHtml(ticket.id)}`),
    `<i>${escapeHtml(ticket.label ?? '')}</i>`,
    `<i>${count} leg${count === 1 ? '' : 's'} · every one must win</i>`,
  ]
  for (const selection of ticket.selections) {
    const mark = SETTLED_MARKS[selection.state] ?? PENDING_MARK
    lines.push(mark === PENDING_MARK
      ? `${mark} ${escapeHtml(selection.day)} · ${escapeHtml(selection.fixture)} → ${escapeHtml(selection.pick)}, ${escapeHtml(selection.probability)}, min ${escapeHtml(selection.need)}`
      : `${mark} ${escapeHtml(selection.day)} · ${escapeHtml(selection.score ?? '')} → ${escapeHtml(selection.pick)}`)
  }
  lines.push('', verdictLine(ticket, { count, settled, open }))
  const multiples = multipleLines(ticket.multiples)
  if (multiples.length) lines.push('', ...multiples)
  if (settled === 0) lines.push('', `<i>Book each at its min price or better</i>`)
  return lines
}

// The result of the slip itself, in one line: in play, won, or lost with the
// leg that broke it named. This is the answer to "did I win it or not".
function verdictLine(ticket, { count, settled, open }) {
  const missed = ticket.selections.filter((selection) => selection.state === 'lost').map((selection) => selection.pick)
  // One missed leg and the slip is gone, even with games still to play: saying
  // "in play" then would let the reader believe it can still come in.
  if (missed.length) {
    const named = missed.slice(0, 2).map(escapeHtml).join(' and ')
    const rest = missed.length > 2 ? `, +${missed.length - 2} more` : ''
    const tail = open > 0 ? ` · ${open} still to play` : ''
    return `<b>LOST</b> · ${settled} of ${count} settled · ${named}${rest} missed${tail}`
  }
  if (open > 0) {
    return `<b>${settled === 0 ? 'NOT STARTED' : 'IN PLAY'}</b> · ${settled} of ${count} settled · ${open} to play`
  }
  const voided = ticket.push ? ` · ${ticket.push} void` : ''
  return `<b>WON</b> · ${count - ticket.push} of ${count}${voided}`
}

// A multiple is one slip whose legs come from different matches, so it is shown
// as a single line with the combined price: too many legs and the slip stops
// fitting on a phone.
function multipleLines(multiples = []) {
  // A dead multiple is not shown with a price: quoting a bet that can no
  // longer win is how a slip gets read as still alive.
  const valid = multiples.filter((multiple) => multiple.state !== 'invalid' && multiple.state !== 'lost')
  if (!valid.length) {
    return multiples.some((multiple) => multiple.state === 'lost')
      ? ['<i>No multiple from this slip came in.</i>']
      : []
  }
  // Multiples are shown because they were asked for, but stated for what they
  // are: the quantity that matters is how often they lose, not the big price.
  const lines = [heading('🧮', 'Multiples'), '<i>Long shots · every leg must win · not a plan</i>']
  for (const multiple of valid) {
    const name = escapeHtml(multiple.short ?? multiple.label ?? 'Multiple')
    const legs = escapeHtml((multiple.legs ?? []).map((leg) => leg.short ?? leg.name ?? leg).join(' + '))
    const mark = SETTLED_MARKS[multiple.state] ?? PENDING_MARK
    if (multiple.state === 'won' || multiple.state === 'lost' || multiple.state === 'push') {
      lines.push(`${mark} ${name} · ${legs}`)
    } else {
      const chance = Number(multiple.probability) / 100
      const losing = Number.isFinite(chance) ? ` · loses ${Math.round((1 - chance) * 12)} in 12` : ''
      lines.push(`${mark} ${name} · ${legs} → ${escapeHtml(multiple.probability)}%, min ${escapeHtml(multiple.need)}${losing}`)
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
  // The all-ticket tally only earns its line once something has actually been
  // decided; before that it is a number that has not been earned yet.
  if (totals && totals.selections > shownSelections && (totals.won ?? 0) + (totals.lost ?? 0) > 0) {
    // This counts legs, not slips: calling them tickets made two beaten legs
    // look like two lost tickets.
    lines.push(`Legs ${totals.won}–${totals.lost} of ${totals.selections} across all slips`)
  }
  return lines
}

// The group follows one slip at a time: the one being played, from its first
// leg to its last, and only then the next. Two slips in a message is what made
// it unreadable.
function nextFixtureDate(ticket) {
  const dates = (ticket.selections ?? [])
    .filter((selection) => !selection.state || selection.state === 'pending' || selection.state === 'unrecorded')
    .map((selection) => selection.date)
    .filter(Boolean)
    .sort()
  return dates[0] ?? '9999-12-31'
}

function lastFixtureDate(ticket) {
  const dates = (ticket.selections ?? []).map((selection) => selection.date).filter(Boolean).sort()
  return dates[dates.length - 1] ?? ''
}

const byNextGame = (a, b) => nextFixtureDate(a).localeCompare(nextFixtureDate(b)) || String(a.id).localeCompare(String(b.id))

const isLive = (ticket) => (ticket?.pending ?? 0) + (ticket?.unrecorded ?? 0) > 0

/**
 * The slip to show: the live one whose next game comes first. When nothing is
 * live, the one that finished most recently — so its verdict stays on screen
 * until the next slip starts.
 */
export function currentTicket(summarized) {
  const slips = Array.isArray(summarized) ? summarized.slice() : []
  if (!slips.length) return null
  const live = slips.filter(isLive).sort(byNextGame)
  if (live.length) return live[0]
  return slips.sort((a, b) => lastFixtureDate(a).localeCompare(lastFixtureDate(b)))[slips.length - 1]
}

/**
 * What to say about the other slips: the last one that finished (its verdict)
 * and the one waiting to be played. Both are one line, never a second slip.
 */
export function otherTickets(summarized, current) {
  const slips = Array.isArray(summarized) ? summarized.filter((ticket) => ticket !== current) : []
  const finished = slips
    .filter((ticket) => !isLive(ticket) && (ticket.won ?? 0) + (ticket.lost ?? 0) + (ticket.push ?? 0) > 0)
    .sort((a, b) => lastFixtureDate(a).localeCompare(lastFixtureDate(b)))
    .at(-1) ?? null
  const upcoming = slips.filter(isLive).sort(byNextGame)[0] ?? null
  return {
    last: finished ? {
      id: finished.id,
      state: (finished.lost ?? 0) > 0 ? 'lost' : 'won',
      won: finished.won ?? 0,
      count: finished.selections?.length ?? 0,
    } : null,
    next: upcoming ? { label: upcoming.label ?? upcoming.id, games: upcoming.selections?.length ?? 0 } : null,
  }
}

/**
 * The message posted to the group: the day's pick, every ticket that still has a
 * leg to play, the latest scores and the running record. `ticket` is the older
 * single-slip form; `tickets` carries several slips at once. Empty sections are
 * dropped rather than filled with "nothing today", and nothing is invented.
 */
export function buildUpdate({ day, pick, results = [], record, ticket, tickets, last, next, totals, siteUrl }) {
  const slips = (Array.isArray(tickets) ? tickets : ticket ? [ticket] : []).filter(Boolean)
  const ledger = totals ?? ticket?.totals ?? null
  const selections = slips.flatMap((slip) => slip.selections ?? [])
  const lines = [
    `<b>Pitchside</b> · ${escapeHtml(day)}`,
    '',
    ...pickLines(pick),
    ...slips.flatMap((slip) => ticketLines(slip)),
    ...(last ? [`<i>Last slip: ${escapeHtml(last.id)} — ${last.state === 'won' ? 'won' : 'lost'}, ${last.won} of ${last.count}</i>`] : []),
    ...(next ? [`<i>Next slip: ${escapeHtml(next.label)} · ${next.games} leg${next.games === 1 ? '' : 's'} · on the site</i>`] : []),
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
