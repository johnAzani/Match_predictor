import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assessDailyData, chooseDailyPick, nigeriaDay } from '../src/lib/dailyPicks.js'
import { outcome, summarizeTracker } from '../src/lib/tracker.js'
import { legName, summarizeTicket, summarizeTickets } from '../src/lib/ticket.js'
import { buildUpdate, currentTicket, otherTickets, postTelegram } from './lib/telegram.js'

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const HOUR = 60 * 60 * 1000

// WAT is UTC+1 all year, so the day the group sees is the Nigerian day.
function watLabel(day) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${day}T12:00:00Z`))
}

function kickoffLabel(kickoff) {
  return `${kickoff.time} WAT`
}

// The group gets the same selection the site shows, from the same function.
function dailyPick(feedData, trackerData, now) {
  const feed = { status: 'community', source: feedData.source, fixtures: feedData.fixtures }
  const tracker = { status: 'ready', data: trackerData }
  const context = assessDailyData(feed, tracker, now)
  const chosen = chooseDailyPick(context, now)
  if (chosen.state !== 'ready') return null
  const record = chosen.record
  return {
    pick: record.prediction.pick,
    probability: record.prediction.probabilities[record.prediction.pick],
    home: record.home.shortName,
    away: record.away.shortName,
    league: record.league.name,
    kickoff: kickoffLabel(record.latestKickoff),
  }
}

const shortDay = (date) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  .format(new Date(`${date}T12:00:00Z`))

// The newest ticket is the one to book; every earlier ticket stays scored so
// the group can see how the past slips actually did.
function ticketUpdate(tickets, records) {
  if (!tickets.length) return null
  const ordered = tickets.slice().sort((a, b) => b.id.localeCompare(a.id))
  const summarized = ordered.map((ticket) => summarizeTicket(ticket, records))
  const totals = summarizeTickets(ordered, records)
  const current = currentTicket(summarized)
  const { last, next } = otherTickets(summarized, current)
  const format = (latest) => ({
    id: latest.id,
    label: latest.label,
    won: latest.won,
    lost: latest.lost,
    push: latest.push,
    selections: latest.selections.map((selection) => ({
      day: shortDay(selection.date),
      date: selection.date,
      home: selection.home,
      away: selection.away,
      fixture: `${selection.home} v ${selection.away}`,
      pick: selection.label,
      probability: `${Math.round(selection.probability * 100)}%`,
      need: (selection.requiredPrice ?? null) === null ? 'the fair price' : selection.requiredPrice.toFixed(2),
      state: selection.state,
      score: selection.state === 'won' || selection.state === 'lost' || selection.state === 'push'
        ? `${selection.home} ${selection.score} ${selection.away}`
        : null,
    })),
    // Only the multiples that are actually bookable: a slip whose legs share a
    // fixture is refused rather than posted with a wrong price.
    multiples: (latest.multiples ?? [])
      .filter((multiple) => multiple.state !== 'invalid')
      .map((multiple) => ({
        short: multiple.short ?? multiple.label,
        legs: multiple.legs.map(legName),
        probability: multiple.probability === null ? '—' : (multiple.probability * 100).toFixed(1),
        need: multiple.requiredPrice === null ? 'the fair price' : multiple.requiredPrice.toFixed(2),
        state: multiple.state,
      })),
  })
  return {
    totals: { won: totals.won, lost: totals.lost, selections: totals.selections },
    ticket: current ? format(current) : null,
    last,
    next,
  }
}

function recentResults(records, day) {
  const previous = new Date(Date.parse(`${day}T00:00:00Z`) - 24 * HOUR).toISOString().slice(0, 10)
  return records
    .filter((record) => record.result && !record.excludedReason && record.result.date >= previous)
    .slice()
    .sort((a, b) => b.result.date.localeCompare(a.result.date) || a.id.localeCompare(b.id))
    .slice(0, 6)
    .map((record) => ({
      home: record.home.shortName,
      away: record.away.shortName,
      homeGoals: record.result.homeGoals,
      awayGoals: record.result.awayGoals,
      pick: record.prediction.pick === 'draw'
        ? 'Draw'
        : `${record.prediction.pick === 'home' ? record.home.shortName : record.away.shortName} win`,
      correct: record.prediction.pick === outcome(record.result),
    }))
}

// Failures have to be readable from the run page and from the API, not only
// from a log that may be unavailable. Never include the token or the chat id.
async function reportFailure(message) {
  console.error(`::error::${message}`)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) await appendFile(summary, `## Telegram update failed\n\n${message}\n`)
  process.exitCode = 1
}

async function main() {
  const now = Date.now()
  const day = nigeriaDay(now)
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim()
  const siteUrl = process.env.SITE_URL?.trim() || ''
  if (!token || !chatId) {
    console.log('Telegram is not configured: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required. Nothing was sent.')
    return
  }
  const trackerPath = resolve(process.env.TRACK_RECORD_PATH ?? 'public/data/track-record.json')
  const matchdayPath = resolve(process.env.MATCHDAY_PATH ?? 'public/data/matchday.json')
  const trackerData = await readJson(trackerPath)
  const feedData = await readJson(matchdayPath)
  const summary = summarizeTracker(trackerData)
  const tickets = (await readJson(resolve('picks/tickets.json'))).tickets
  const slips = ticketUpdate(tickets, trackerData.records)
  // The evening run only posts when the slip in play has a game today: on a quiet
  // day it would repeat the morning's message word for word.
  if (process.env.ONLY_IF_MATCH_TODAY === 'true' &&
      !(slips?.ticket?.selections ?? []).some((selection) => selection.date === day)) {
    console.log('No fixture on the slip today, so the evening update was skipped.')
    return
  }
  const text = buildUpdate({
    day: watLabel(day),
    pick: dailyPick(feedData, trackerData, now),
    results: recentResults(trackerData.records, day),
    record: { correct: summary.correct, scored: summary.evaluated },
    ticket: slips?.ticket ?? null,
    last: slips?.last ?? null,
    next: slips?.next ?? null,
    totals: slips?.totals ?? null,
    siteUrl,
  })
  const result = await postTelegram({ token, chatId, text })
  if (!result.ok) {
    // Never print the token or the chat id: the description is enough to trace.
    await reportFailure(`Telegram delivery failed: ${result.description ?? 'unknown error'} — ${result.reason}`)
    return
  }
  const stepSummary = process.env.GITHUB_STEP_SUMMARY
  if (stepSummary) await appendFile(stepSummary, `## Telegram update sent\n\nMessage ${result.messageId ?? 'unknown'} was posted to the group.\n`)
  console.log(`Telegram update sent (message ${result.messageId ?? 'unknown'}).`)
}

main().catch(async (error) => {
  await reportFailure(`Could not post the Telegram update: ${error.message}`)
})
