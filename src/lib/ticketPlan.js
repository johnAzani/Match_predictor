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
// A week is the unit of the slip: one bookable ticket holding the best games
// from Monday to Sunday, rather than a trickle of one-match days.
export const MAX_SELECTIONS = 6
export const WINDOW_DAYS = 7

const SIDES = ['home', 'draw', 'away']
const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven']

const dayMonth = (date) => {
  const parts = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .formatToParts(new Date(`${date}T12:00:00Z`))
  const value = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('day')} ${value('month')}`
}

const year = (date) => new Date(`${date}T12:00:00Z`).getUTCFullYear()

// ISO week: weeks run Monday to Sunday and belong to the year of their Thursday.
export function isoWeek(date) {
  const target = new Date(`${date}T00:00:00Z`)
  const shift = (target.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNumber(target) + 3)
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  firstThursday.setUTCDate(firstThursday.getUTCDate() - dayNumber(firstThursday) + 3)
  const week = 1 + Math.round((target - firstThursday) / (7 * 24 * 60 * 60 * 1000))
  const monday = new Date(target)
  monday.setUTCDate(monday.getUTCDate() - 3)
  return {
    key: `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
    monday: monday.toISOString().slice(0, 10),
  }
}

const dayNumber = (date) => (date.getUTCDay() + 6) % 7

const addDays = (date, days) => {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

const teamName = (team) => team?.shortName ?? team?.name ?? ''

// Sources disagree on club names ("Barcelona" and "FC Barcelona"), so two
// fixtures are the same when the dates match and each club completes the other.
const sameClub = (a, b) => a === b || a.endsWith(b) || b.endsWith(a)
export const sameFixture = (a, b) => a.date === b.date &&
  sameClub(normalizeName(a.home), normalizeName(b.home)) &&
  sameClub(normalizeName(a.away), normalizeName(b.away))
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
// match from the week's list.
function multiplesFor(selections, weekKey) {
  const ids = selections.map((selection) => selection.id)
  const count = ids.length
  const multiples = [{ id: `${weekKey}-double`, short: 'Double', label: 'Two-leg double — the two strongest of the week', legs: ids.slice(0, 2) }]
  if (count >= 3) {
    multiples.push({ id: `${weekKey}-treble`, short: 'Treble', label: 'Three-leg treble — the three strongest of the week', legs: ids.slice(0, 3) })
  }
  if (count >= 4) {
    multiples.push({
      id: `${weekKey}-all`,
      short: `All ${COUNT_WORDS[count] ?? count}`,
      label: `${count}-leg multiple — every pick of the week`,
      legs: ids,
    })
  }
  return multiples
}

/**
 * The next week that has no ticket yet, with its selections and multiples, or
 * `null` when every upcoming week is already covered or nothing qualifies.
 *
 * The slip is deliberately a week and not a day: the good games are spread from
 * Monday to Sunday, and one bookable ticket should hold them together. Fixtures
 * already on another ticket are never repeated, so a slip can be added later in
 * the same week without double-counting anything.
 */
export function planTicket({
  fixtures = [],
  tickets = [],
  now = Date.now(),
  threshold = TICKET_THRESHOLD,
  leadTime = LEAD_TIME,
  maxSelections = MAX_SELECTIONS,
} = {}) {
  // A week counts as covered when any ticket already has a fixture in it, so the
  // planner always looks at the week ahead instead of re-packing a week that is
  // already being played.
  const takenFixtures = []
  const coveredWeeks = new Set()
  for (const ticket of tickets) {
    coveredWeeks.add(ticket.id)
    for (const selection of ticket.selections ?? []) {
      takenFixtures.push({ date: selection.date, home: selection.home, away: selection.away })
      if (selection.date) coveredWeeks.add(isoWeek(selection.date).key)
    }
  }

  const picks = eligiblePicks(fixtures, { now, threshold, leadTime }).filter((pick) => {
    const candidate = {
      date: pick.fixture.date,
      home: teamName(pick.fixture.home),
      away: teamName(pick.fixture.away),
    }
    return !takenFixtures.some((taken) => sameFixture(taken, candidate))
  })

  const byWeek = new Map()
  for (const pick of picks) {
    const week = isoWeek(pick.fixture.date)
    if (!byWeek.has(week.key)) byWeek.set(week.key, { week, picks: [] })
    byWeek.get(week.key).picks.push(pick)
  }

  const weekKey = [...byWeek.keys()].sort().find((key) => !coveredWeeks.has(key))
  if (!weekKey) return null
  const { week, picks: weekPicks } = byWeek.get(weekKey)

  // One fixture can only appear once, however the feed is ordered.
  const seen = []
  const chosen = weekPicks
    .filter((pick) => {
      const candidate = {
        date: pick.fixture.date,
        home: teamName(pick.fixture.home),
        away: teamName(pick.fixture.away),
      }
      if (seen.some((other) => sameFixture(other, candidate))) return false
      seen.push(candidate)
      return true
    })
    .slice(0, maxSelections)
  if (!chosen.length) return null

  const selections = chosen.map((pick, index) => ({
    ...selectionFrom(pick, index, pick.fixture.date),
    // The week is part of the id so two tickets can never claim the same one.
    id: `${weekKey}-${pick.fixture.date}-${index + 1}`,
  }))
  const sunday = addDays(week.monday, 6)
  const ticket = {
    id: weekKey,
    label: `Week of ${dayMonth(week.monday)} – ${dayMonth(sunday)} ${year(sunday)}`,
    selectedAt: new Date(now).toISOString(),
    generated: true,
    note: 'Selected automatically from the model\'s eligible picks for this week and written before the first kick-off. Each selection is scored on its own; the multiples combine them into one slip, where every leg must win.',
    selections,
  }
  if (selections.length >= 2) ticket.multiples = multiplesFor(selections, weekKey)
  return ticket
}
