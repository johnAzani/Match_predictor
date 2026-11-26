// Ticket settlement. Selections are written into picks/tickets.json before
// kick-off, so the git history is the timestamp. Outcomes are read back from the
// same public ledger the site already publishes — a ticket is never self-scored.
const OUTCOME_KEYS = ['home', 'draw', 'away']

export const MARKET_LABELS = Object.freeze({
  '1X2': 'Straight win',
  DC: '+0.5 (win or draw)',
  AH1: '+1 (refund on a one-goal defeat)',
})

// Accents and apostrophes differ between sources ("M'gladbach", "Atlético").
export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019]/g, '')
    .toLowerCase()
    .trim()
}

const teamNames = (team) => [team?.name, team?.shortName].filter(Boolean).map(normalizeName)

// Sources differ on the full club name ("Borussia M'gladbach") and the short one
// ("M'gladbach"), so a name matches when either side completes the other.
const nameMatches = (names, target) => names.some((name) => name === target || name.endsWith(target) || target.endsWith(name))

function recordDate(record) {
  return record?.result?.date ?? record?.latestKickoff?.date ?? null
}

// Match on the reported date plus both clubs. The ledger's own ids are slugged
// differently from the fixture names, so names are the stable key here.
export function findRecord(selection, records) {
  const home = normalizeName(selection.home)
  const away = normalizeName(selection.away)
  const candidates = records.filter((record) => recordDate(record) === selection.date &&
    nameMatches(teamNames(record.home), home) && nameMatches(teamNames(record.away), away))
  if (!candidates.length) return null
  return candidates.find((record) => record.result && !record.excludedReason) ?? candidates[0]
}

export function settleSelection(selection, records) {
  const record = findRecord(selection, records)
  if (!record) return { state: 'unrecorded', score: null, note: 'The public ledger has no matching fixture yet.' }
  if (!record.result || record.excludedReason) {
    return { state: 'pending', score: null, note: record.excludedReason ? 'Excluded from the public record.' : 'Waiting for the final score.' }
  }
  const { homeGoals, awayGoals } = record.result
  const score = `${homeGoals} : ${awayGoals}`
  const side = selection.side
  if (!OUTCOME_KEYS.includes(side)) return { state: 'unrecorded', score, note: 'Unknown side.' }
  const margin = side === 'home' ? homeGoals - awayGoals : side === 'away' ? awayGoals - homeGoals : 0
  if (selection.market === 'DC') {
    if (side === 'draw') return { state: 'unrecorded', score, note: 'Double chance needs a side.' }
    return { state: margin >= 0 ? 'won' : 'lost', score, note: null }
  }
  if (selection.market === 'AH1') {
    if (side === 'draw') return { state: 'unrecorded', score, note: 'A handicap needs a side.' }
    if (margin >= 0) return { state: 'won', score, note: null }
    if (margin === -1) return { state: 'push', score, note: 'Stake returned.' }
    return { state: 'lost', score, note: null }
  }
  const correct = side === 'home' ? homeGoals > awayGoals : side === 'away' ? awayGoals > homeGoals : homeGoals === awayGoals
  return { state: correct ? 'won' : 'lost', score, note: null }
}

// The club a selection actually backs, short enough for a leg list.
export function legName(selection) {
  if (selection.side === 'draw') return 'Draw'
  if (selection.market === '1X2') return selection.side === 'home' ? selection.home : selection.away
  return selection.label
}

// Two selections on the same fixture are related contingencies, not independent
// legs: their prices move together, so multiplying the probabilities would be
// wrong. The fixture key is what keeps a multiple honest.
export function fixtureKey(selection) {
  return [normalizeName(selection.home), normalizeName(selection.away)].sort().join('|')
}

/**
 * A multiple combines selections that are already on the ticket, so nothing new
 * is predicted here: the combined price is the product of model probabilities
 * and the combined odds are its reciprocal. Legs must come from different
 * fixtures, and a void leg (a push) simply drops out.
 */
export function summarizeMultiple(multiple, selections) {
  const wanted = Array.isArray(multiple?.legs) ? multiple.legs : []
  const byId = new Map(selections.map((selection) => [selection.id, selection]))
  const legs = wanted.map((id) => byId.get(id)).filter(Boolean)
  const unknown = wanted.filter((id) => !byId.has(id))
  const base = { ...multiple, legs, unknown }

  if (legs.length < 2) {
    return { ...base, probability: null, fairOdds: null, requiredPrice: null, state: 'invalid', note: 'A multiple needs at least two legs.' }
  }
  const keys = legs.map(fixtureKey)
  if (new Set(keys).size !== keys.length) {
    return { ...base, probability: null, fairOdds: null, requiredPrice: null, state: 'invalid', note: 'Two legs on the same match are related bets, not a multiple.' }
  }

  const states = legs.map((leg) => leg.state ?? 'pending')
  const live = legs.filter((leg) => leg.state !== 'push')
  const probability = live.length ? live.reduce((total, leg) => total * leg.probability, 1) : null
  const fairOdds = probability ? 1 / probability : null
  const requiredPrice = fairOdds ? Math.ceil(fairOdds * 100) / 100 : null
  const voids = legs.length - live.length

  let state = 'pending'
  if (states.includes('lost')) state = 'lost'
  else if (live.length === 0) state = 'push'
  else if (live.every((leg) => leg.state === 'won')) state = 'won'

  return { ...base, probability, fairOdds, requiredPrice, state, voids }
}

const tally = () => ({ won: 0, lost: 0, push: 0, pending: 0, unrecorded: 0 })

export function summarizeTicket(ticket, records) {
  const summary = tally()
  const selections = ticket.selections.map((selection) => {
    const outcome = settleSelection(selection, records)
    summary[outcome.state] += 1
    return { ...selection, ...outcome }
  })
  const decided = summary.won + summary.lost
  const multiples = (ticket.multiples ?? []).map((multiple) => summarizeMultiple(multiple, selections))
  return {
    ...ticket,
    selections,
    multiples,
    won: summary.won,
    lost: summary.lost,
    push: summary.push,
    pending: summary.pending,
    unrecorded: summary.unrecorded,
    decided,
    // Pushes return the stake, so they are not part of the hit rate.
    hitRate: decided ? summary.won / decided : null,
  }
}

export function summarizeTickets(tickets, records) {
  const settled = tickets.map((ticket) => summarizeTicket(ticket, records))
  const total = tally()
  for (const ticket of settled) {
    total.won += ticket.won
    total.lost += ticket.lost
    total.push += ticket.push
    total.pending += ticket.pending
    total.unrecorded += ticket.unrecorded
  }
  const decided = total.won + total.lost
  return {
    tickets: settled.slice().sort((a, b) => b.id.localeCompare(a.id)),
    selections: settled.reduce((count, ticket) => count + ticket.selections.length, 0),
    ...total,
    decided,
    hitRate: decided ? total.won / decided : null,
  }
}
