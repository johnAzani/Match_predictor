import { describe, expect, it } from 'vitest'
import { updateTracker } from '../server/tracker.js'
import {
  assessDailyData, assessSavedPick, calculateWager, canRecordBet, captureDailyPick, chooseDailyPick,
  DAILY_PICKS_STORAGE_KEY, emptyDailyStore, estimatedBetResult, isValidDailyPick, isValidDailyStore,
  loadDailyStore, mergeDailyStores, nigeriaDay, saveDailyStore, summarizeDailyPicks,
} from '../src/lib/dailyPicks.js'
import { completedScenario, fixture, HOUR, input, league, makeScenario, resultTime, selectionTime } from './fixtures/dailyPicks.js'

const selected = (scenario) => captureDailyPick(chooseDailyPick(assessDailyData(scenario.feed, scenario.tracker, selectionTime.getTime()), selectionTime.getTime()).record, selectionTime.getTime())
const withBet = (pick, stakeKobo = 10_000, oddsHundredths = 130) => ({ ...pick, bet: { stakeKobo, oddsHundredths, loggedAt: selectionTime.toISOString(), voidedAt: null } })

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return { getItem: (key) => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, value) }
}

describe('daily model selection', () => {
  it('uses the Nigeria calendar, including the UTC midnight boundary', () => {
    expect(nigeriaDay(Date.parse('2026-11-05T22:59:59Z'))).toBe('2026-11-05')
    expect(nigeriaDay(Date.parse('2026-11-05T23:00:00Z'))).toBe('2026-11-06')
    expect(nigeriaDay(NaN)).toBeNull()
    expect(nigeriaDay(1e300)).toBeNull()
  })

  it('chooses the highest frozen probability from eligible verified forecasts', () => {
    const scenario = makeScenario([fixture(), fixture({ homeName: 'Gamma', awayName: 'Delta', homeGoals: 3, awayGoals: 0.4, time: '20:00' })])
    const context = assessDailyData(scenario.feed, scenario.tracker, selectionTime.getTime())
    const best = scenario.verified.records.reduce((left, right) => left.prediction.probabilitiesExact[left.prediction.pick] >= right.prediction.probabilitiesExact[right.prediction.pick] ? left : right)
    expect(chooseDailyPick(context, selectionTime.getTime())).toMatchObject({ state: 'ready', record: { id: best.id } })
    const pick = selected(scenario)
    expect(isValidDailyPick(pick)).toBe(true)
    expect(pick.bet).toBeNull()
    expect(pick.day).toBe('2026-11-05')
    expect(pick.forecastVerifiedAt).toBe(scenario.verified.records.find((record) => record.id === best.id).verifiedAt)
  })

  it('breaks equal probabilities by kick-off and then identity, not input order', () => {
    const later = fixture({ homeName: 'Later', awayName: 'Opponent A', time: '20:00' })
    const earlier = fixture({ homeName: 'Earlier', awayName: 'Opponent B', time: '18:30' })
    const scenario = makeScenario([later, earlier])
    const data = structuredClone(scenario.verified)
    data.records[1].prediction = structuredClone(data.records[0].prediction)
    const context = assessDailyData(scenario.feed, { ...scenario.tracker, data }, selectionTime.getTime())
    expect(chooseDailyPick(context, selectionTime.getTime()).record.id).toBe(earlier.id)
  })

  it('refuses demo, local-preview, invalid, stale, failed and still-refreshing data', () => {
    const s = makeScenario()
    const at = selectionTime.getTime()
    expect(assessDailyData({ status: 'loading' }, s.tracker, at).state).toBe('loading')
    expect(assessDailyData({ ...s.feed, refreshing: true }, s.tracker, at).state).toBe('loading')
    expect(assessDailyData(s.feed, { ...s.tracker, refreshing: true }, at).state).toBe('loading')
    expect(assessDailyData({ ...s.feed, status: 'demo' }, s.tracker, at).state).toBe('unavailable')
    expect(assessDailyData(s.feed, { ...s.tracker, data: { ...s.verified, publication: 'local-preview' } }, at).state).toBe('unavailable')
    expect(assessDailyData(s.feed, { ...s.tracker, data: { version: 1 } }, at).state).toBe('unavailable')
    expect(assessDailyData(s.feed, { ...s.tracker, loadFailed: true }, at).state).toBe('stale')
    expect(assessDailyData({ ...s.feed, source: { ...s.feed.source, stale: true } }, s.tracker, at).state).toBe('stale')
    expect(assessDailyData({ ...s.feed, source: { ...s.feed.source, fetchedAt: null } }, s.tracker, at).state).toBe('stale')
    expect(assessDailyData({ ...s.feed, source: { ...s.feed.source, sourceUpdatedAt: new Date(at - 49 * HOUR).toISOString() } }, s.tracker, at).state).toBe('stale')
    expect(assessDailyData({ ...s.feed, source: { ...s.feed.source, fetchedAt: new Date(at + 6 * 60_000).toISOString() } }, s.tracker, at).state).toBe('stale')
    expect(assessDailyData(s.feed, s.tracker, at + 37 * HOUR).state).toBe('stale')
  })

  it('never backfills a result, an unverified forecast, or a fixture within two hours', () => {
    const s = makeScenario()
    const at = selectionTime.getTime()
    const unverified = assessDailyData(s.feed, { ...s.tracker, data: s.initial }, at)
    expect(chooseDailyPick(unverified, at).state).toBe('empty')
    const excluded = structuredClone(s.verified)
    excluded.records[0].excludedReason = 'ambiguous-result'
    expect(chooseDailyPick(assessDailyData(s.feed, { ...s.tracker, data: excluded }, at), at).state).toBe('empty')
    const context = assessDailyData(s.feed, s.tracker, at)
    expect(chooseDailyPick(context, s.fixtures[0].kickoffTimestamp - 2 * HOUR).state).toBe('ready')
    expect(chooseDailyPick(context, s.fixtures[0].kickoffTimestamp - 2 * HOUR + 1).state).toBe('empty')
    expect(chooseDailyPick(context, s.fixtures[0].kickoffTimestamp + HOUR).state).toBe('empty')
    const completed = completedScenario(s)
    expect(chooseDailyPick(assessDailyData(completed.feed, completed.tracker, resultTime.getTime()), resultTime.getTime()).state).toBe('empty')
  })

  it('requires a matching, unique fixture and skips unavailable leagues', () => {
    const s = makeScenario()
    const at = selectionTime.getTime()
    const selection = (feed) => chooseDailyPick(assessDailyData(feed, s.tracker, at), at).state
    expect(selection({ ...s.feed, fixtures: [] })).toBe('empty')
    expect(selection({ ...s.feed, fixtures: [{ ...s.fixtures[0], time: '19:00' }] })).toBe('empty')
    expect(selection({ ...s.feed, fixtures: [s.fixtures[0], s.fixtures[0]] })).toBe('empty')
    expect(selection({ ...s.feed, source: { ...s.feed.source, unavailableLeagues: [league.name] } })).toBe('empty')
  })
})

describe('budget, decimal odds and local storage', () => {
  it('computes hypothetical single returns and loss using integer kobo', () => {
    expect(calculateWager('100', '1.30')).toEqual({ state: 'ready', stakeKobo: 10_000, oddsHundredths: 130, returnKobo: 13_000, profitKobo: 3_000 })
    expect(calculateWager('50.50', '1.30')).toMatchObject({ returnKobo: 6565, profitKobo: 1515 })
    expect(calculateWager('0.01', '1.50')).toMatchObject({ returnKobo: 2, profitKobo: 1 })
    expect(calculateWager('', '')).toEqual({ state: 'empty' })
  })

  it('rejects more than ₦100 total, invalid odds and overly precise amounts', () => {
    for (const [stake, odds] of [['100.01', '1.5'], ['0', '2'], ['1.001', '2'], ['1e2', '2'], ['20', '1'], ['20', '1.001'], ['20', '1000.01'], ['-1', '2']]) {
      expect(calculateWager(stake, odds).state, `${stake} at ${odds}`).toBe('invalid')
    }
    expect(calculateWager(null, '2').state).toBe('invalid')
  })

  it('accepts one validated record per WAT day and refuses corrupt or inaccessible storage', () => {
    const pick = withBet(selected(makeScenario()))
    const storage = fakeStorage()
    const data = { version: 1, picks: [pick] }
    expect(isValidDailyStore(data)).toBe(true)
    expect(saveDailyStore(storage, data)).toBe(true)
    expect(loadDailyStore(storage)).toEqual({ state: 'ready', data })
    expect(isValidDailyStore({ ...data, picks: [pick, pick] })).toBe(false)
    expect(isValidDailyStore({ version: 1, picks: [{ ...pick, bet: { ...pick.bet, stakeKobo: 10_001 } }] })).toBe(false)
    expect(isValidDailyPick({ ...pick, selectedKickoff: 1e300 })).toBe(false)
    expect(loadDailyStore(fakeStorage({ [DAILY_PICKS_STORAGE_KEY]: '{broken' })).state).toBe('corrupt')
    expect(loadDailyStore({ getItem: () => { throw new Error('denied') } }).state).toBe('unavailable')
    expect(saveDailyStore({ setItem: () => { throw new Error('full') } }, data)).toBe(false)
  })

  it('only allows bet recording against the saved, still-current fixture before the cut-off', () => {
    const s = makeScenario()
    const pick = selected(s)
    const context = assessDailyData(s.feed, s.tracker, selectionTime.getTime())
    expect(canRecordBet(pick, context, selectionTime.getTime())).toBe(true)
    expect(canRecordBet(pick, context, pick.selectedKickoff - 2 * HOUR + 1)).toBe(false)
    expect(canRecordBet(pick, { ...context, fixtures: new Map() }, selectionTime.getTime())).toBeFalsy()
    expect(canRecordBet(pick, { ...context, state: 'stale' }, selectionTime.getTime())).toBe(false)
  })

  it('restores additively and refuses a same-day conflict without overwriting', () => {
    const pick = selected(makeScenario())
    const current = { version: 1, picks: [pick] }
    expect(mergeDailyStores(emptyDailyStore(), current)).toEqual({ ok: true, data: current, added: 1, updated: 0 })
    expect(mergeDailyStores(current, structuredClone(current))).toMatchObject({ ok: true, added: 0, updated: 0 })
    const wagered = withBet(pick)
    const restored = mergeDailyStores(current, { version: 1, picks: [wagered] })
    expect(restored).toMatchObject({ ok: true, updated: 1, data: { picks: [{ bet: wagered.bet }] } })
    expect(mergeDailyStores({ version: 1, picks: [wagered] }, { version: 1, picks: [withBet(pick, 5000)] })).toMatchObject({ ok: false })
    expect(mergeDailyStores(current, { version: 1, picks: [{ ...pick, forecastId: 'community-different' }] })).toMatchObject({ ok: false })
    expect(mergeDailyStores(current, { version: 10, picks: [] })).toMatchObject({ ok: false })
    expect(current.picks[0].bet).toBeNull()
  })
})

describe('result and estimated bet tracking', () => {
  it('scores a saved suggestion separately from a user-recorded bet and handles corrections', () => {
    const s = makeScenario()
    const pick = selected(s)
    const won = completedScenario(s)
    const context = assessDailyData(won.feed, won.tracker, resultTime.getTime())
    expect(assessSavedPick(pick, context)).toMatchObject({ state: 'correct' })
    expect(estimatedBetResult(pick, assessSavedPick(pick, context))).toEqual({ state: 'no-bet' })
    const wagered = withBet(pick)
    expect(estimatedBetResult(wagered, assessSavedPick(wagered, context))).toEqual({ state: 'won', returnKobo: 13_000, netKobo: 3_000 })
    expect(summarizeDailyPicks([wagered], context)).toMatchObject({ scored: 1, correct: 1, bets: 1, estimatedBets: 1, estimatedNetKobo: 3_000 })

    const later = new Date(resultTime.getTime() + HOUR)
    const correctedInput = input(later, [], [{ ...won.result, homeGoals: 0, awayGoals: 2 }])
    const corrected = updateTracker(won.completed, correctedInput, later, 'github-pages')
    const correctedContext = assessDailyData({ ...correctedInput.feed, status: 'community' }, { status: 'ready', data: corrected }, later.getTime())
    expect(assessSavedPick(wagered, correctedContext).state).toBe('incorrect')
    expect(estimatedBetResult(wagered, assessSavedPick(wagered, correctedContext))).toEqual({ state: 'lost', returnKobo: 0, netKobo: -10_000 })
    expect(summarizeDailyPicks([wagered], correctedContext)).toMatchObject({ scored: 1, correct: 0, estimatedNetKobo: -10_000 })
  })

  it('scores draw and away-win selections using the full-time result', () => {
    for (const [outcome, homeGoals, awayGoals] of [['draw', 1, 1], ['away', 0, 2]]) {
      const s = makeScenario()
      const data = structuredClone(s.verified)
      const probabilities = outcome === 'draw' ? { home: 25, draw: 50, away: 25 } : { home: 25, draw: 20, away: 55 }
      data.records[0].prediction = { ...data.records[0].prediction, pick: outcome, probabilities, probabilitiesExact: Object.fromEntries(Object.entries(probabilities).map(([key, value]) => [key, value / 100])) }
      const tracker = { ...s.tracker, data }
      const context = assessDailyData(s.feed, tracker, selectionTime.getTime())
      const pick = withBet(captureDailyPick(chooseDailyPick(context, selectionTime.getTime()).record, selectionTime.getTime()))
      const finishedInput = input(resultTime, [], [{ date: '2026-11-05', home: 'Alpha', away: 'Beta', homeGoals, awayGoals }])
      const finished = updateTracker(data, finishedInput, resultTime, 'github-pages')
      const resultContext = assessDailyData({ ...finishedInput.feed, status: 'community' }, { status: 'ready', data: finished }, resultTime.getTime())
      expect(assessSavedPick(pick, resultContext).state, outcome).toBe('correct')
      expect(estimatedBetResult(pick, assessSavedPick(pick, resultContext)).state, outcome).toBe('won')
    }
  })

  it('does not use a result that appears to have been observed in the future', () => {
    const s = makeScenario()
    const pick = withBet(selected(s))
    const done = completedScenario(s)
    const clock = resultTime.getTime() - 60_000
    const context = assessDailyData(done.feed, done.tracker, clock)
    expect(context.state).toBe('ready') // small clock skew is allowed for health checks
    expect(assessSavedPick(pick, context).state).toBe('unavailable')
    expect(estimatedBetResult(pick, assessSavedPick(pick, context)).state).toBe('pending')
  })

  it('does not estimate a payout for stale data, a mismatched forecast, an exclusion or a changed schedule', () => {
    const s = makeScenario()
    const pick = withBet(selected(s))
    const current = assessDailyData(s.feed, s.tracker, selectionTime.getTime())
    const altered = { ...pick, probability: pick.probability - 1 }
    expect(assessSavedPick(altered, current).state).toBe('review')
    expect(estimatedBetResult(pick, { state: 'unavailable' }).state).toBe('pending')
    const excluded = structuredClone(s.verified)
    excluded.records[0].excludedReason = 'result-unavailable'
    expect(assessSavedPick(pick, assessDailyData(s.feed, { ...s.tracker, data: excluded }, selectionTime.getTime())).state).toBe('review')
    const changed = structuredClone(s.verified)
    changed.records[0].latestKickoff = { date: '2026-11-06', time: '18:30', timestamp: Date.parse('2026-11-06T17:30:00Z') }
    const assessment = assessSavedPick(pick, assessDailyData(s.feed, { ...s.tracker, data: changed }, selectionTime.getTime()))
    expect(assessment).toMatchObject({ state: 'pending', scheduleChanged: true })
    expect(estimatedBetResult(pick, assessment).state).toBe('review')
  })

  it('does not estimate bookmaker settlement when a result date indicates a previously unreported postponement', () => {
    const s = makeScenario()
    const pick = withBet(selected(s))
    const observedAt = new Date('2026-11-07T10:00:00Z')
    const laterResult = { date: '2026-11-06', home: 'Alpha', away: 'Beta', homeGoals: 2, awayGoals: 0 }
    const laterInput = input(observedAt, [], [laterResult])
    const laterLedger = updateTracker(s.verified, laterInput, observedAt, 'github-pages')
    const context = assessDailyData({ ...laterInput.feed, status: 'community' }, { status: 'ready', data: laterLedger }, observedAt.getTime())
    const assessment = assessSavedPick(pick, context)
    expect(assessment).toMatchObject({ state: 'correct', scheduleChanged: true })
    expect(estimatedBetResult(pick, assessment)).toEqual({ state: 'review' })
    expect(summarizeDailyPicks([pick], context)).toMatchObject({ scored: 1, correct: 1, estimatedBets: 0, awaitingBets: 1 })
  })

  it('treats a manually marked void as unverified and excludes it from estimated net', () => {
    const s = makeScenario()
    const pick = withBet(selected(s))
    pick.bet.voidedAt = '2026-11-06T12:00:00.000Z'
    const won = completedScenario(s)
    const context = assessDailyData(won.feed, won.tracker, resultTime.getTime())
    expect(isValidDailyPick(pick)).toBe(true)
    expect(estimatedBetResult(pick, assessSavedPick(pick, context))).toEqual({ state: 'void' })
    expect(summarizeDailyPicks([pick], context)).toMatchObject({ scored: 1, correct: 1, estimatedBets: 0, voidBets: 1, estimatedNetKobo: 0 })
  })
})
