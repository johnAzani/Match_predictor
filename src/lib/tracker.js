export const TRACKER_VERSION = 1
export const MODEL_VERSION = 'poisson-v1'
const OUTCOMES = ['home', 'draw', 'away']

const isTimestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const validGoals = (value) => Number.isInteger(value) && value >= 0 && value <= 50

function validTeam(team) {
  return team && typeof team.name === 'string' && team.name.length > 0 &&
    typeof team.shortName === 'string' && team.shortName.length > 0 &&
    (team.crest === null || typeof team.crest === 'string') && Number.isFinite(team.goalsFor) && Number.isFinite(team.goalsAgainst) &&
    Number.isInteger(team.sampleSize) && team.sampleSize >= 3 && Array.isArray(team.form) && team.form.length > 0 &&
    team.form.every((result) => ['W', 'D', 'L'].includes(result))
}

function validPrediction(prediction) {
  if (!prediction || !OUTCOMES.includes(prediction.pick)) return false
  const rounded = OUTCOMES.map((key) => prediction.probabilities?.[key])
  const exact = OUTCOMES.map((key) => prediction.probabilitiesExact?.[key])
  if (!rounded.every((value) => Number.isInteger(value) && value >= 0 && value <= 100) || rounded.reduce((a, b) => a + b, 0) !== 100) return false
  if (!exact.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) || Math.abs(exact.reduce((a, b) => a + b, 0) - 1) > 1e-6) return false
  const maximum = Math.max(...rounded)
  if (rounded.filter((value) => value === maximum).length !== 1 || prediction.probabilities[prediction.pick] !== maximum) return false
  return Number.isFinite(prediction.expectedGoals?.home) && Number.isFinite(prediction.expectedGoals?.away) &&
    validGoals(prediction.likelyScore?.home) && validGoals(prediction.likelyScore?.away)
}

function validKickoff(kickoff) {
  return kickoff && isDate(kickoff.date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(kickoff.time) &&
    Number.isFinite(kickoff.timestamp) && kickoff.timestamp === Date.parse(`${kickoff.date}T${kickoff.time}:00+01:00`)
}

function validRecord(record) {
  if (!record || typeof record.id !== 'string' || !record.id.startsWith('community-') ||
    typeof record.season !== 'string' || !record.league || typeof record.league.id !== 'string' ||
    typeof record.league.name !== 'string' || !validTeam(record.home) || !validTeam(record.away) ||
    !validKickoff(record.originalKickoff) || !validKickoff(record.latestKickoff) || !isTimestamp(record.recordedAt) ||
    record.recordedAt.slice(0, 10) >= record.originalKickoff.date ||
    Date.parse(record.recordedAt) + 2 * 60 * 60 * 1000 > record.originalKickoff.timestamp ||
    record.originalKickoff.timestamp - Date.parse(record.recordedAt) > 48 * 60 * 60 * 1000 || typeof record.modelVersion !== 'string' ||
    !(record.verifiedAt === null || (isTimestamp(record.verifiedAt) && Date.parse(record.verifiedAt) >= Date.parse(record.recordedAt) && Date.parse(record.verifiedAt) < record.originalKickoff.timestamp)) ||
    !validPrediction(record.prediction) || ![null, 'ambiguous-result', 'result-before-forecast', 'result-before-verification', 'unverified-publication', 'result-unavailable'].includes(record.excludedReason)) return false
  if (record.result === null) return true
  return record.result && isDate(record.result.date) && validGoals(record.result.homeGoals) && validGoals(record.result.awayGoals) &&
    isTimestamp(record.result.observedAt) && record.result.observedAt.slice(0, 10) > record.result.date &&
    (record.excludedReason || (record.result.date > record.recordedAt.slice(0, 10) && (!record.verifiedAt || record.result.date >= record.verifiedAt.slice(0, 10))))
}

// The ledger is public and is also the input to the next Pages build. Never
// silently accept a broken or partially downloaded archive as an empty one.
export function isValidTracker(data) {
  if (!data || data.version !== TRACKER_VERSION || !isTimestamp(data.startedAt) || !isTimestamp(data.updatedAt) || Date.parse(data.startedAt) > Date.parse(data.updatedAt) ||
    !['github-pages', 'local-preview'].includes(data.publication) || typeof data.sourceStale !== 'boolean' || !Array.isArray(data.records)) return false
  const ids = new Set()
  return data.records.every((record) => {
    if (!validRecord(record) || ids.has(record.id) || Date.parse(record.recordedAt) > Date.parse(data.updatedAt) ||
      (record.verifiedAt && Date.parse(record.verifiedAt) > Date.parse(data.updatedAt)) ||
      (record.result && Date.parse(record.result.observedAt) > Date.parse(data.updatedAt)) ||
      (data.publication === 'github-pages' && record.result && !record.excludedReason && !record.verifiedAt)) return false
    ids.add(record.id)
    return true
  })
}

export function createTracker(now = new Date(), publication = 'local-preview') {
  const timestamp = now.toISOString()
  return { version: TRACKER_VERSION, startedAt: timestamp, updatedAt: timestamp, publication, sourceUpdatedAt: null, sourceStale: true, records: [] }
}

export function outcome(result) {
  return result.homeGoals > result.awayGoals ? 'home' : result.homeGoals === result.awayGoals ? 'draw' : 'away'
}

export function frozenPrediction(record, fixture) {
  const pick = record.prediction.pick
  return {
    probabilities: record.prediction.probabilities,
    probabilitiesExact: record.prediction.probabilitiesExact,
    expectedGoals: record.prediction.expectedGoals,
    likelyScore: record.prediction.likelyScore,
    lean: {
      key: pick,
      label: pick === 'home' ? 'Home win' : pick === 'draw' ? 'Draw' : 'Away win',
      team: pick === 'home' ? fixture.home : pick === 'away' ? fixture.away : null,
      percent: record.prediction.probabilities[pick],
    },
  }
}

export function summarizeTracker(tracker) {
  const summary = { total: tracker.records.length, evaluated: 0, correct: 0, pending: 0, excluded: 0, accuracy: null, byLeague: [], byMonth: [], recent: [], awaiting: [] }
  const leagues = new Map()
  const months = new Map()
  for (const record of tracker.records) {
    const league = leagues.get(record.league.id) || { id: record.league.id, name: record.league.name, evaluated: 0, correct: 0, pending: 0 }
    leagues.set(record.league.id, league)
    if (record.excludedReason) { summary.excluded += 1; continue }
    if (!record.result) { summary.pending += 1; league.pending += 1; summary.awaiting.push(record); continue }
    const correct = record.prediction.pick === outcome(record.result)
    summary.evaluated += 1
    summary.correct += Number(correct)
    league.evaluated += 1
    league.correct += Number(correct)
    const month = record.result.date.slice(0, 7)
    const bucket = months.get(month) || { month, evaluated: 0, correct: 0 }
    bucket.evaluated += 1
    bucket.correct += Number(correct)
    months.set(month, bucket)
    summary.recent.push({ ...record, correct })
  }
  summary.accuracy = summary.evaluated ? summary.correct / summary.evaluated : null
  summary.byLeague = [...leagues.values()].sort((a, b) => a.name.localeCompare(b.name))
  summary.byMonth = [...months.values()].sort((a, b) => a.month.localeCompare(b.month))
  summary.recent.sort((a, b) => b.result.date.localeCompare(a.result.date) || a.id.localeCompare(b.id))
  summary.awaiting.sort((a, b) => a.latestKickoff.timestamp - b.latestKickoff.timestamp || a.id.localeCompare(b.id))
  return summary
}
