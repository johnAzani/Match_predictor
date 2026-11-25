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

const tally = () => ({ won: 0, lost: 0, push: 0, pending: 0, unrecorded: 0 })

export function summarizeTicket(ticket, records) {
  const summary = tally()
  const selections = ticket.selections.map((selection) => {
    const outcome = settleSelection(selection, records)
    summary[outcome.state] += 1
    return { ...selection, ...outcome }
  })
  const decided = summary.won + summary.lost
  return {
    ...ticket,
    selections,
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
