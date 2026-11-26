// Automatic matchday ticket. The picks come from the same published model the
// site uses, taken only from fixtures that have not kicked off yet, and only
// when the model is confident enough to put the selection on a slip. Nothing is
// written by hand: given the same snapshot the plan is the same.
import { hasPredictionData, predictMatch } from './predictions.js'
import { normalizeName } from './ticket.js'

// A selection has to clear the model's own bar before it is worth publishing.
export const TICKET_THRESHOLD = 0.57
// A fixture that kicks off within this window is left alone: a ticket is only
// honest if it is written before the match starts.
export const LEAD_TIME = 45 * 60 * 1000
export const MAX_SELECTIONS = 5

const SIDES = ['home', 'draw', 'away']
const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven']

const dayLabel = (date) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).formatToParts(new Date(`${date}T12:00:00Z`))
  const value = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('weekday')} ${value('day')} ${value('month')} ${value('year')}`
}

const teamName = (team) => team?.shortName ?? team?.name ?? ''
const fixtureKey = (home, away, date) => `${date}|${normalizeName(home)}|${normalizeName(away)}`
const round = (value, places) => Number(value.toFixed(places))

function requiredPrice(probability) {
  return Math.ceil((1 / probability) * 100) / 100
}

/**
 * Every fixture that has not started and whose strongest outcome clears the
 * threshold, strongest first. `now` is injectable so the choice is testable.
 */
export function eligiblePicks(fixtures, { now = Date.now(), threshold = TICKET_THRESHOLD, leadTime = LEAD_TIME } = {}) {
  return fixtures
    .filter((fixture) => hasPredictionData(fixture) && Number.isFinite(fixture.kickoffTimestamp) && fixture.kickoffTimestamp > now + leadTime)
    .map((fixture) => {
      const prediction = predictMatch(fixture)
      const side = SIDES.reduce((best, key) => (
        prediction.probabilitiesExact[key] > prediction.probabilitiesExact[best] ? key : best
      ), 'home')
      const probability = prediction.probabilitiesExact[side]
      return { fixture, side, probability }
    })
    .filter((pick) => pick.probability >= threshold)
    .sort((a, b) => b.probability - a.probability || a.fixture.kickoffTimestamp - b.fixture.kickoffTimestamp)
}

function selectionFrom(pick, index, date) {
  const { fixture, side, probability } = pick
  const team = side === 'home' ? teamName(fixture.home) : teamName(fixture.away)
  const fairOdds = round(1 / probability, 2)
  return {
    id: `${date}-${index + 1}`,
    date,
    league: fixture.league?.name ?? '',
    home: teamName(fixture.home),
    away: teamName(fixture.away),
    market: '1X2',
    side,
    label: side === 'draw' ? 'Draw' : `${team} win`,
    probability: round(probability, 6),
    fairOdds,
    requiredPrice: requiredPrice(probability),
  }
}

// The multiples always name different fixtures, because each leg is a different
// selection from the day's list.
function multiplesFor(selections) {
  const ids = selections.map((selection) => selection.id)
  const count = ids.length
  const multiples = [{ id: `${selections[0].date}-double`, short: 'Double', label: 'Two-leg double — the two strongest of the day', legs: ids.slice(0, 2) }]
  if (count >= 3) {
    multiples.push({ id: `${selections[0].date}-treble`, short: 'Treble', label: 'Three-leg treble — the three strongest of the day', legs: ids.slice(0, 3) })
  }
  if (count >= 4) {
    multiples.push({
      id: `${selections[0].date}-all`,
      short: `All ${COUNT_WORDS[count] ?? count}`,
      label: `${count}-leg multiple — every pick on this day`,
      legs: ids,
    })
  }
  return multiples
}

/**
 * The next day that has no ticket yet, with its selections and multiples, or
 * `null` when every upcoming matchday is already covered or nothing qualifies.
 */
export function planTicket({
  fixtures = [],
  tickets = [],
  now = Date.now(),
  threshold = TICKET_THRESHOLD,
  leadTime = LEAD_TIME,
  maxSelections = MAX_SELECTIONS,
} = {}) {
  // A matchday that any ticket already touches is left alone: one slip per day,
  // so a fixture is never counted twice and two slips never compete.
  const coveredDates = new Set(tickets.map((ticket) => ticket.id))
  for (const ticket of tickets) {
    for (const selection of ticket.selections ?? []) {
      if (selection.date) coveredDates.add(selection.date)
    }
  }

  const picks = eligiblePicks(fixtures, { now, threshold, leadTime })
    .filter((pick) => !coveredDates.has(pick.fixture.date))

  const byDate = new Map()
  for (const pick of picks) {
    if (!byDate.has(pick.fixture.date)) byDate.set(pick.fixture.date, [])
    byDate.get(pick.fixture.date).push(pick)
  }

  const date = [...byDate.keys()].sort()[0]
  if (!date) return null

  // One fixture can only appear once, however the feed is ordered.
  const seen = new Set()
  const chosen = byDate.get(date)
    .filter((pick) => {
      const key = fixtureKey(teamName(pick.fixture.home), teamName(pick.fixture.away), date)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, maxSelections)
  if (!chosen.length) return null

  const selections = chosen.map((pick, index) => selectionFrom(pick, index, date))
  const ticket = {
    id: date,
    label: dayLabel(date),
    selectedAt: new Date(now).toISOString(),
    generated: true,
    note: 'Selected automatically from the model\'s eligible picks for this day and written before the first kick-off. Each selection is scored on its own; the multiples combine them into one slip, where every leg must win.',
    selections,
  }
  if (selections.length >= 2) ticket.multiples = multiplesFor(selections)
  return ticket
}
