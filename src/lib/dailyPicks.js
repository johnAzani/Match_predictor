import { historyHealth, sourceHealth } from './operationalHealth.js'
import { isValidTracker, outcome } from './tracker.js'

export const DAILY_BUDGET_KOBO = 10_000
export const DAILY_PICKS_STORAGE_KEY = 'pitchside-daily-picks-v1'
const HOUR = 60 * 60 * 1000
const MAX_SOURCE_AGE = 48 * HOUR
const CLOCK_SKEW = 5 * 60 * 1000
const SAFETY_WINDOW = 2 * HOUR
const MAX_PICKS = 3660
const OUTCOMES = ['home', 'draw', 'away']

const timestamp = (value) => typeof value === 'string' ? Date.parse(value) : NaN
const shortText = (value, max = 200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

// Nigeria uses West Africa Time (UTC+1), without seasonal clock changes.
export function nigeriaDay(now = Date.now()) {
  const local = Number.isFinite(now) ? new Date(now + HOUR) : new Date(NaN)
  return Number.isFinite(local.getTime()) ? local.toISOString().slice(0, 10) : null
}

function recent(value, now, maximumAge) {
  const time = timestamp(value)
  return Number.isFinite(time) && time <= now + CLOCK_SKEW && now - time <= maximumAge
}

// A recommendation needs both the public, verified ledger and a current
// fixture snapshot. Demo/local-preview data and failed or stale checks fail
// closed; the independent public tracker itself is never modified here.
export function assessDailyData(feed, tracker, now = Date.now()) {
  if (!Number.isFinite(now)) return { state: 'unavailable', reason: 'This device’s clock could not be checked.' }
  if (feed?.status === 'loading' || tracker?.status === 'loading' || feed?.refreshing || tracker?.refreshing) return { state: 'loading', reason: 'Checking today’s fixtures and published record.' }
  if (feed?.status !== 'community' || tracker?.status !== 'ready' || !isValidTracker(tracker.data) || tracker.data.publication !== 'github-pages') {
    return { state: 'unavailable', reason: 'Published forecasts and community fixtures are needed. Demo and local-preview matches are not used.' }
  }
  const source = feed.source
  if (historyHealth(tracker, now).state !== 'ok' || sourceHealth(tracker, now).state !== 'ok' ||
    !source || source.stale || source.refreshFailed || !Array.isArray(feed.fixtures) ||
    !recent(source.fetchedAt, now, MAX_SOURCE_AGE) || !recent(source.sourceUpdatedAt, now, MAX_SOURCE_AGE)) {
    return { state: 'stale', reason: 'The fixture feed or published record is delayed or could not be verified. Try again after the next refresh.' }
  }
  const fixtures = new Map()
  const duplicateIds = new Set()
  for (const fixture of feed.fixtures) {
    if (!fixture || typeof fixture.id !== 'string') continue
    if (fixtures.has(fixture.id)) duplicateIds.add(fixture.id)
    else fixtures.set(fixture.id, fixture)
  }
  // Duplicate identities are ambiguous even when the apparent times agree.
  for (const id of duplicateIds) fixtures.delete(id)
  return {
    state: 'ready', records: new Map(tracker.data.records.map((record) => [record.id, record])), fixtures,
    unavailableLeagues: new Set(Array.isArray(source.unavailableLeagues) ? source.unavailableLeagues : []),
    updatedAt: tracker.data.updatedAt, now,
  }
}

// Only one single is shown: the highest frozen top-outcome probability among
// today's eligible public records. The choice is not an odds or value estimate.
export function chooseDailyPick(context, now = Date.now()) {
  if (context.state !== 'ready') return { state: context.state, reason: context.reason }
  const day = nigeriaDay(now)
  const candidates = [...context.records.values()].filter((record) => {
    const fixture = context.fixtures.get(record.id)
    return record.verifiedAt && timestamp(record.verifiedAt) <= now && !record.excludedReason && !record.result &&
      record.latestKickoff.date === day && !context.unavailableLeagues.has(record.league.name) &&
      Math.min(record.originalKickoff.timestamp, record.latestKickoff.timestamp) - now >= SAFETY_WINDOW &&
      fixture && fixture.kickoffTimestamp === record.latestKickoff.timestamp && fixture.date === record.latestKickoff.date &&
      fixture.time === record.latestKickoff.time
  })
  candidates.sort((a, b) => b.prediction.probabilitiesExact[b.prediction.pick] - a.prediction.probabilitiesExact[a.prediction.pick] ||
    a.latestKickoff.timestamp - b.latestKickoff.timestamp || a.id.localeCompare(b.id))
  return candidates.length
    ? { state: 'ready', record: candidates[0] }
    : { state: 'empty', reason: 'No verified, eligible match is available for today. Some days have no pick.' }
}

export function captureDailyPick(record, now = Date.now()) {
  return {
    day: nigeriaDay(now), forecastId: record.id,
    selectedAt: new Date(now).toISOString(), forecastRecordedAt: record.recordedAt, forecastVerifiedAt: record.verifiedAt,
    originalKickoff: record.originalKickoff.timestamp, selectedKickoff: record.latestKickoff.timestamp,
    leagueId: record.league.id, leagueName: record.league.name,
    homeName: record.home.name, homeShortName: record.home.shortName,
    awayName: record.away.name, awayShortName: record.away.shortName,
    pick: record.prediction.pick, probability: record.prediction.probabilities[record.prediction.pick],
    bet: null,
  }
}

function validBet(bet, pick) {
  if (bet === null) return true
  const logged = timestamp(bet?.loggedAt)
  const selected = timestamp(pick.selectedAt)
  return Number.isInteger(bet?.stakeKobo) && bet.stakeKobo > 0 && bet.stakeKobo <= DAILY_BUDGET_KOBO &&
    Number.isInteger(bet.oddsHundredths) && bet.oddsHundredths >= 101 && bet.oddsHundredths <= 100_000 &&
    Number.isFinite(logged) && logged >= selected && logged + SAFETY_WINDOW <= Math.min(pick.originalKickoff, pick.selectedKickoff) &&
    (bet.voidedAt === null || (Number.isFinite(timestamp(bet.voidedAt)) && timestamp(bet.voidedAt) >= logged))
}

export function isValidDailyPick(pick) {
  if (!pick || !isDay(pick.day) || !shortText(pick.forecastId, 250) || !pick.forecastId.startsWith('community-') ||
    !shortText(pick.leagueId) || !shortText(pick.leagueName) || !shortText(pick.homeName) || !shortText(pick.homeShortName) ||
    !shortText(pick.awayName) || !shortText(pick.awayShortName) || !OUTCOMES.includes(pick.pick) ||
    !Number.isInteger(pick.probability) || pick.probability < 0 || pick.probability > 100 ||
    !Number.isFinite(pick.originalKickoff) || !Number.isFinite(pick.selectedKickoff)) return false
  const selected = timestamp(pick.selectedAt)
  const recorded = timestamp(pick.forecastRecordedAt)
  const verified = timestamp(pick.forecastVerifiedAt)
  return Number.isFinite(selected) && Number.isFinite(recorded) && Number.isFinite(verified) &&
    recorded <= verified && verified <= selected && nigeriaDay(selected) === pick.day && nigeriaDay(pick.selectedKickoff) === pick.day &&
    selected + SAFETY_WINDOW <= Math.min(pick.originalKickoff, pick.selectedKickoff) && validBet(pick.bet, pick)
}

export function isValidDailyStore(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.picks) || data.picks.length > MAX_PICKS) return false
  const days = new Set()
  return data.picks.every((pick) => {
    if (!isValidDailyPick(pick) || days.has(pick.day)) return false
    days.add(pick.day)
    return true
  })
}

export function emptyDailyStore() { return { version: 1, picks: [] } }

// Corrupt or inaccessible storage is never silently replaced with an empty
// record. This is private browser storage, not the public Pages ledger.
export function loadDailyStore(storage) {
  if (!storage) return { state: 'unavailable', data: null }
  let raw
  try { raw = storage.getItem(DAILY_PICKS_STORAGE_KEY) } catch { return { state: 'unavailable', data: null } }
  if (raw === null) return { state: 'ready', data: emptyDailyStore() }
  try {
    const data = JSON.parse(raw)
    return isValidDailyStore(data) ? { state: 'ready', data } : { state: 'corrupt', data: null }
  } catch {
    return { state: 'corrupt', data: null }
  }
}

export function saveDailyStore(storage, data) {
  if (!storage || !isValidDailyStore(data)) return false
  try { storage.setItem(DAILY_PICKS_STORAGE_KEY, JSON.stringify(data)); return true } catch { return false }
}

const SAME_SUGGESTION_FIELDS = ['day', 'forecastId', 'forecastRecordedAt', 'forecastVerifiedAt', 'originalKickoff', 'selectedKickoff',
  'leagueId', 'leagueName', 'homeName', 'homeShortName', 'awayName', 'awayShortName', 'pick', 'probability']
const sameSuggestion = (a, b) => SAME_SUGGESTION_FIELDS.every((field) => a[field] === b[field])
const sameBet = (a, b) => ['stakeKobo', 'oddsHundredths', 'loggedAt', 'voidedAt'].every((field) => a[field] === b[field])

// Restore is additive. Identical suggestions from different browsers can be
// combined with an earlier capture time and a single wager; different picks or
// conflicting wagers fail closed rather than silently overwriting a bet.
export function mergeDailyStores(current, backup) {
  if (!isValidDailyStore(current) || !isValidDailyStore(backup)) return { ok: false, reason: 'This is not a valid daily-picks backup.' }
  const byDay = new Map(current.picks.map((pick) => [pick.day, pick]))
  let added = 0
  let updated = 0
  for (const pick of backup.picks) {
    const existing = byDay.get(pick.day)
    if (!existing) { byDay.set(pick.day, pick); added += 1; continue }
    if (!sameSuggestion(existing, pick) || (existing.bet && pick.bet && !sameBet(existing.bet, pick.bet))) {
      return { ok: false, reason: `The backup conflicts with the existing record for ${pick.day}; nothing was imported.` }
    }
    const earlier = timestamp(existing.selectedAt) <= timestamp(pick.selectedAt) ? existing : pick
    const merged = { ...earlier, bet: existing.bet || pick.bet }
    if (!isValidDailyPick(merged)) return { ok: false, reason: `The backup conflicts with the existing record for ${pick.day}; nothing was imported.` }
    if (JSON.stringify(merged) !== JSON.stringify(existing)) { byDay.set(pick.day, merged); updated += 1 }
  }
  const data = { version: 1, picks: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)) }
  return isValidDailyStore(data) ? { ok: true, data, added, updated } : { ok: false, reason: 'This backup is too large to import.' }
}

function parseHundredths(value) {
  if (typeof value !== 'string' || !/^\d{1,5}(?:\.\d{1,2})?$/.test(value.trim())) return null
  const [whole, fraction = ''] = value.trim().split('.')
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2))
}

// Naira and decimal odds are parsed as integer hundredths, avoiding floating
// point rounding errors. No price is provided or inferred by the model.
export function calculateWager(stake, odds) {
  if (typeof stake !== 'string' || typeof odds !== 'string') return { state: 'invalid', reason: 'Enter a stake and decimal odds.' }
  if (!stake.trim() && !odds.trim()) return { state: 'empty' }
  const stakeKobo = parseHundredths(stake)
  const oddsHundredths = parseHundredths(odds)
  if (stakeKobo === null || stakeKobo < 1 || stakeKobo > DAILY_BUDGET_KOBO) {
    return { state: 'invalid', reason: 'Enter a stake from ₦0.01 to ₦100.00, using at most two decimal places.' }
  }
  if (oddsHundredths === null || oddsHundredths < 101 || oddsHundredths > 100_000) {
    return { state: 'invalid', reason: 'Enter decimal odds from 1.01 to 1000.00, using at most two decimal places.' }
  }
  const returnKobo = Math.round(stakeKobo * oddsHundredths / 100)
  return { state: 'ready', stakeKobo, oddsHundredths, returnKobo, profitKobo: returnKobo - stakeKobo }
}

export function pickName(pick) {
  return pick.pick === 'draw' ? 'Draw' : `${pick.pick === 'home' ? pick.homeShortName : pick.awayShortName} win`
}

function sameForecast(pick, record) {
  return record && record.id === pick.forecastId && record.recordedAt === pick.forecastRecordedAt &&
    record.verifiedAt === pick.forecastVerifiedAt && record.originalKickoff.timestamp === pick.originalKickoff &&
    record.league.id === pick.leagueId && record.home.name === pick.homeName && record.away.name === pick.awayName &&
    record.prediction.pick === pick.pick && record.prediction.probabilities[pick.pick] === pick.probability
}

export function assessSavedPick(pick, context) {
  if (context.state !== 'ready') return { state: context.state === 'loading' ? 'loading' : 'unavailable' }
  const record = context.records.get(pick.forecastId)
  if (!sameForecast(pick, record)) return { state: 'review' }
  if (record.excludedReason) return { state: 'review', record }
  if (context.unavailableLeagues.has(record.league.name)) return { state: 'unavailable', record }
  // A result on another date can indicate a postponement even when the feed
  // never supplied an updated fixture. Do not infer bookmaker settlement.
  const scheduleChanged = record.latestKickoff.timestamp !== pick.selectedKickoff || Boolean(record.result && record.result.date !== pick.day)
  if (!record.result) return { state: 'pending', record, scheduleChanged }
  if (timestamp(record.result.observedAt) > context.now) return { state: 'unavailable', record, scheduleChanged }
  if (record.result.date < pick.day || timestamp(record.result.observedAt) < timestamp(pick.selectedAt)) return { state: 'review', record, scheduleChanged }
  return { state: record.prediction.pick === outcome(record.result) ? 'correct' : 'incorrect', record, scheduleChanged }
}

export function canRecordBet(pick, context, now = Date.now()) {
  if (!isValidDailyPick(pick) || context.state !== 'ready' || nigeriaDay(now) !== pick.day ||
    Math.min(pick.originalKickoff, pick.selectedKickoff) - now < SAFETY_WINDOW) return false
  const status = assessSavedPick(pick, context)
  const fixture = context.fixtures.get(pick.forecastId)
  return status.state === 'pending' && !status.scheduleChanged && fixture &&
    fixture.kickoffTimestamp === pick.selectedKickoff && fixture.date === pick.day &&
    fixture.time === status.record.latestKickoff.time
}

export function estimatedBetResult(pick, assessment) {
  if (!pick.bet) return { state: 'no-bet' }
  if (pick.bet.voidedAt) return { state: 'void' }
  if (assessment.scheduleChanged) return { state: 'review' }
  if (assessment.state !== 'correct' && assessment.state !== 'incorrect') return { state: 'pending' }
  const returnKobo = assessment.state === 'correct' ? Math.round(pick.bet.stakeKobo * pick.bet.oddsHundredths / 100) : 0
  return { state: assessment.state === 'correct' ? 'won' : 'lost', returnKobo, netKobo: returnKobo - pick.bet.stakeKobo }
}

export function summarizeDailyPicks(picks, context) {
  const summary = { picks: picks.length, scored: 0, correct: 0, awaitingPicks: 0, bets: 0, estimatedBets: 0, estimatedNetKobo: 0, awaitingBets: 0, voidBets: 0 }
  for (const pick of picks) {
    const assessment = assessSavedPick(pick, context)
    if (assessment.state === 'correct' || assessment.state === 'incorrect') {
      summary.scored += 1
      if (assessment.state === 'correct') summary.correct += 1
    } else summary.awaitingPicks += 1
    if (!pick.bet) continue
    summary.bets += 1
    const estimate = estimatedBetResult(pick, assessment)
    if (estimate.state === 'won' || estimate.state === 'lost') { summary.estimatedBets += 1; summary.estimatedNetKobo += estimate.netKobo }
    else if (estimate.state === 'void') summary.voidBets += 1
    else summary.awaitingBets += 1
  }
  return summary
}
