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
  const lines = [`<b>Pitchside — ${escapeHtml(day)}</b>`, '', ...pickLines(pick), '', ...resultLines(results), '', '<b>RECORD</b>']
  if (record && record.scored > 0) {
    lines.push(`${record.correct} of ${record.scored} correct (${(100 * record.correct / record.scored).toFixed(1)}%)`)
  } else {
    lines.push('No scored forecasts yet.')
  }
  if (ticket && ticket.selections > 0) {
    const settled = ticket.won + ticket.lost + ticket.push
    lines.push(`Ticket ${escapeHtml(ticket.id)}: ${ticket.won} won, ${ticket.lost} lost${settled ? '' : ' — still to settle'}`)
  }
  if (siteUrl) lines.push('', `<a href="${escapeHtml(siteUrl)}">Full record and method</a>`)
  const text = lines.join('\n')
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH - 4)}\n…` : text
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
  return { ok: false, status: attempt.status, reason: attempt.payload?.description ?? 'Telegram rejected the message.' }
}
