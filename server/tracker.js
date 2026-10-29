import { hasPredictionData, predictMatch } from '../src/lib/predictions.js'
import { createTracker, isValidTracker, MODEL_VERSION } from '../src/lib/tracker.js'
import { matchId } from './football.js'

const HOUR = 60 * 60 * 1000
export const FORECAST_WINDOW_HOURS = 48
export const KICKOFF_SAFETY_HOURS = 2

function resultIndex(datasets) {
  const index = new Map()
  for (const dataset of datasets) {
    for (const result of dataset.results) {
      const id = matchId(dataset.season, dataset.league.id, result.home, result.away)
      if (!index.has(id)) index.set(id, [])
      index.get(id).push(result)
    }
  }
  return index
}

function kickoffOf(fixture) {
  return { date: fixture.date, time: fixture.time, timestamp: fixture.kickoffTimestamp }
}

function identity(team) {
  return {
    name: team.name, shortName: team.shortName, crest: team.crest ?? null,
    goalsFor: team.goalsFor, goalsAgainst: team.goalsAgainst, form: [...team.form], sampleSize: team.sampleSize,
  }
}

function capturedPrediction(fixture) {
  if (!hasPredictionData(fixture)) return null
  const prediction = predictMatch(fixture)
  // The cards say "no clear lean" when rounded leaders tie; don't score a
  // hidden tiebreaker as if it had been presented to the user.
  if (prediction.lean.key === 'tie') return null
  return {
    pick: prediction.lean.key,
    probabilities: prediction.probabilities,
    probabilitiesExact: prediction.probabilitiesExact,
    likelyScore: prediction.likelyScore,
    expectedGoals: prediction.expectedGoals,
  }
}

// Once captured, the forecast and original kick-off are immutable. Only the
// latest schedule and observed result may change. No past forecasts are made up.
export function updateTracker(previous, { feed, datasets }, now = new Date(), publication = 'local-preview') {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid tracker clock')
  if (!['github-pages', 'local-preview'].includes(publication)) throw new Error('Invalid tracker publication mode')
  if (previous && !isValidTracker(previous)) throw new Error('Invalid forecast ledger; refusing to reset it')
  if (previous && now.getTime() < Date.parse(previous.updatedAt)) throw new Error('Tracker clock cannot move backwards')
  if (publication === 'github-pages' && previous && previous.publication !== 'github-pages') throw new Error('A local preview cannot become the published track record')
  if (!feed || feed.mode !== 'community' || !Array.isArray(feed.fixtures) || !feed.source || !Array.isArray(datasets)) throw new Error('Community tracking data is unavailable')
  const state = previous || createTracker(now, publication)
  const timestamp = now.toISOString()
  const today = timestamp.slice(0, 10)
  const updatedTime = Date.parse(feed.source.sourceUpdatedAt)
  const sourceStale = Boolean(feed.source.stale) || !Number.isFinite(updatedTime) ||
    now.getTime() - updatedTime > 48 * HOUR || updatedTime > now.getTime() + 5 * 60 * 1000
  const resultById = resultIndex(datasets)
  const available = new Set(datasets.map((dataset) => `${dataset.season}|${dataset.league.id}`))
  const fixturesById = new Map(feed.fixtures.map((fixture) => [fixture.id, fixture]))
  const records = state.records.map((original) => {
    let record = { ...original }
    const fixture = fixturesById.get(record.id)
    const knownKickoff = fixture && fixture.time !== 'TBC' && Number.isFinite(fixture.kickoffTimestamp)
    const leagueAvailable = available.has(`${record.season}|${record.league.id}`)
    const candidates = resultById.get(record.id) || []
    if (!sourceStale && knownKickoff) record.latestKickoff = kickoffOf(fixture)
    // A build timestamp is not proof of publication: deployment may be late
    // or fail. Verify only a forecast restored from the public site while a
    // fresh source still lists it as upcoming and has no result for it.
    if (publication === 'github-pages' && previous && !record.verifiedAt && record.excludedReason !== 'unverified-publication') {
      const cutoff = Math.min(record.originalKickoff.timestamp, record.latestKickoff.timestamp)
      if (now.getTime() >= cutoff || (!sourceStale && leagueAvailable && candidates.length)) {
        return { ...record, result: null, excludedReason: 'unverified-publication' }
      }
      if (!sourceStale && leagueAvailable && knownKickoff) record.verifiedAt = timestamp
      else return record
    }
    if (sourceStale || record.excludedReason === 'unverified-publication' || !leagueAvailable) return record
    if (candidates.length > 1) return { ...record, excludedReason: 'ambiguous-result' }
    if (!candidates.length) return record.result ? { ...record, excludedReason: 'result-unavailable' } : record
    if (candidates[0].date >= today) return record.result ? { ...record, result: null, excludedReason: null } : record
    const result = candidates[0]
    const beforeForecast = result.date <= record.recordedAt.slice(0, 10)
    const beforeVerification = record.verifiedAt && result.date < record.verifiedAt.slice(0, 10)
    const previousResult = record.result
    const changed = !previousResult || previousResult.date !== result.date || previousResult.homeGoals !== result.homeGoals || previousResult.awayGoals !== result.awayGoals
    return {
      ...record,
      excludedReason: beforeForecast ? 'result-before-forecast' : beforeVerification ? 'result-before-verification' : null,
      result: changed ? { date: result.date, homeGoals: result.homeGoals, awayGoals: result.awayGoals, observedAt: timestamp } : previousResult,
    }
  })
  const recordedIds = new Set(records.map((record) => record.id))
  if (!sourceStale) for (const fixture of feed.fixtures) {
    const distance = fixture.kickoffTimestamp - now.getTime()
    if (recordedIds.has(fixture.id) || resultById.has(fixture.id) || fixture.time === 'TBC' || fixture.date <= today ||
      !Number.isFinite(distance) || distance < KICKOFF_SAFETY_HOURS * HOUR || distance > FORECAST_WINDOW_HOURS * HOUR) continue
    const prediction = capturedPrediction(fixture)
    if (!prediction) continue
    records.push({
      id: fixture.id,
      season: feed.source.season,
      league: { id: fixture.league.id, name: fixture.league.name, country: fixture.league.country },
      home: identity(fixture.home), away: identity(fixture.away),
      originalKickoff: kickoffOf(fixture), latestKickoff: kickoffOf(fixture),
      recordedAt: timestamp, verifiedAt: null, modelVersion: MODEL_VERSION, prediction, result: null, excludedReason: null,
    })
    recordedIds.add(fixture.id)
  }
  const next = { ...state, updatedAt: timestamp, publication, sourceUpdatedAt: feed.source.sourceUpdatedAt ?? null, sourceStale, records }
  if (!isValidTracker(next)) throw new Error('Invalid updated forecast ledger; refusing to publish it')
  return next
}
