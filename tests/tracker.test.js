import { describe, expect, it, vi } from 'vitest'
import { competitions, matchId } from '../server/football.js'
import { updateTracker } from '../server/tracker.js'
import { isValidTracker, summarizeTracker } from '../src/lib/tracker.js'
import { restorePublishedTracker } from '../scripts/tracker-restore.js'

const hour = 60 * 60 * 1000
const league = competitions[0]
const season = '2026-27'
const firstRun = new Date('2026-10-29T12:00:00Z')
const home = { name: 'Alpha', shortName: 'Alpha', crest: null, goalsFor: 2.2, goalsAgainst: 0.8, sampleSize: 5, form: ['W', 'W', 'D', 'W', 'W'] }
const away = { name: 'Beta', shortName: 'Beta', crest: null, goalsFor: 0.8, goalsAgainst: 2, sampleSize: 5, form: ['L', 'L', 'D', 'L', 'L'] }
const fixture = (overrides = {}) => ({
  id: matchId(season, league.id, home.name, away.name), league, date: '2026-10-30', day: 'FRI 30 OCT', time: '18:30',
  kickoffTimestamp: Date.parse('2026-10-30T17:30:00Z'), home, away, hasEnoughData: true, ...overrides,
})
const input = (now, fixtures = [fixture()], results = [], extraSource = {}) => ({
  feed: { mode: 'community', fixtures, source: { season, stale: false, sourceUpdatedAt: new Date(now.getTime() - hour).toISOString(), ...extraSource } },
  datasets: [{ season, league, results }],
})
const result = (date, homeGoals = 2, awayGoals = 0) => ({ date, home: 'Alpha', away: 'Beta', homeGoals, awayGoals })

describe('prospective forecast ledger', () => {
  it('records an eligible forecast once and never rewrites its prediction', () => {
    const initial = updateTracker(null, input(firstRun), firstRun, 'github-pages')
    expect(isValidTracker(initial)).toBe(true)
    expect(initial.records).toHaveLength(1)
    expect(initial.records[0].prediction.pick).toBe('home')
    const rerun = new Date(firstRun.getTime() + hour)
    const modified = fixture({ home: { ...home, goalsFor: 0.3, form: ['L'] }, away: { ...away, goalsFor: 3, form: ['W'] }, date: '2026-10-31', kickoffTimestamp: Date.parse('2026-10-31T17:30:00Z') })
    const next = updateTracker(initial, input(rerun, [modified]), rerun, 'github-pages')
    expect(next.records[0].prediction).toEqual(initial.records[0].prediction)
    expect(next.records[0].recordedAt).toBe(initial.records[0].recordedAt)
    expect(next.records[0].originalKickoff.date).toBe('2026-10-30')
    expect(next.records[0].latestKickoff.date).toBe('2026-10-31')
  })

  it('only records known, future-day kick-offs within the 48-hour window with sufficient history', () => {
    const items = [
      fixture({ id: 'community-same-day', date: '2026-10-29', kickoffTimestamp: firstRun.getTime() + 6 * hour }),
      fixture({ id: 'community-too-close', date: '2026-10-30', kickoffTimestamp: firstRun.getTime() + hour }),
      fixture({ id: 'community-too-far', date: '2026-11-01', kickoffTimestamp: firstRun.getTime() + 60 * hour }),
      fixture({ id: 'community-tbc', time: 'TBC' }),
      fixture({ id: 'community-no-history', hasEnoughData: false }),
      fixture({ id: 'community-eligible' }),
    ]
    const next = updateTracker(null, input(firstRun, items), firstRun)
    expect(next.records.map((record) => record.id)).toEqual(['community-eligible'])
    const stale = updateTracker(null, input(firstRun, [fixture()], [], { stale: true }), firstRun)
    expect(stale.records).toHaveLength(0)
    expect(stale.sourceStale).toBe(true)
  })

  it('does not record a fixture that already has a result or use demo data', () => {
    const next = updateTracker(null, input(firstRun, [fixture()], [result('2026-10-28')]), firstRun)
    expect(next.records).toHaveLength(0)
    expect(() => updateTracker(null, { ...input(firstRun), feed: { mode: 'demo', fixtures: [], source: {} } }, firstRun)).toThrow('Community')
  })

  it('settles later final scores and summarizes accuracy by league and month', () => {
    const initial = updateTracker(null, input(firstRun), firstRun)
    const later = new Date('2026-10-31T10:00:00Z')
    const complete = updateTracker(initial, input(later, [], [result('2026-10-30')]), later)
    const summary = summarizeTracker(complete)
    expect(complete.records[0].result).toMatchObject({ date: '2026-10-30', homeGoals: 2, awayGoals: 0 })
    expect(summary).toMatchObject({ evaluated: 1, correct: 1, pending: 0, accuracy: 1 })
    expect(summary.byLeague[0]).toMatchObject({ id: league.id, correct: 1, evaluated: 1 })
    expect(summary.byMonth[0]).toEqual({ month: '2026-10', correct: 1, evaluated: 1 })
  })

  it('groups home, draw and away outcomes correctly across months and leagues', () => {
    const base = updateTracker(null, input(firstRun), firstRun).records[0]
    const scored = (id, league, pick, date, homeGoals, awayGoals) => ({ ...base, id, league, prediction: { ...base.prediction, pick }, result: { date, homeGoals, awayGoals } })
    const records = [
      scored('a', league, 'home', '2026-10-30', 2, 0),
      scored('b', league, 'draw', '2026-10-31', 1, 1),
      scored('c', competitions[1], 'home', '2026-11-01', 0, 1),
      { ...base, id: 'd' },
    ]
    const summary = summarizeTracker({ records })
    expect(summary).toMatchObject({ evaluated: 3, correct: 2, pending: 1, accuracy: 2 / 3 })
    expect(summary.byMonth).toEqual([{ month: '2026-10', evaluated: 2, correct: 2 }, { month: '2026-11', evaluated: 1, correct: 0 }])
    expect(summary.byLeague.find((item) => item.id === league.id)).toMatchObject({ evaluated: 2, correct: 2, pending: 1 })
    expect(summary.byLeague.find((item) => item.id === competitions[1].id)).toMatchObject({ evaluated: 1, correct: 0 })
    expect(summary.recent[0]).toMatchObject({ id: 'c', correct: false })
  })

  it('waits until the day after a result and never scores a result from before the forecast', () => {
    const initial = updateTracker(null, input(firstRun), firstRun)
    const matchday = new Date('2026-10-30T22:00:00Z')
    const pending = updateTracker(initial, input(matchday, [], [result('2026-10-30')]), matchday)
    expect(pending.records[0].result).toBeNull()
    const later = new Date('2026-10-31T10:00:00Z')
    const invalid = updateTracker(initial, input(later, [], [result('2026-10-29')]), later)
    expect(invalid.records[0].excludedReason).toBe('result-before-forecast')
    expect(summarizeTracker(invalid)).toMatchObject({ evaluated: 0, excluded: 1, accuracy: null })
  })

  it('excludes ambiguous results, accepts later corrections, and preserves data during partial failures', () => {
    const initial = updateTracker(null, input(firstRun), firstRun)
    const later = new Date('2026-10-31T10:00:00Z')
    const ambiguous = updateTracker(initial, input(later, [], [result('2026-10-30'), result('2026-10-28')]), later)
    expect(ambiguous.records[0].excludedReason).toBe('ambiguous-result')
    expect(summarizeTracker(ambiguous).evaluated).toBe(0)
    const corrected = updateTracker(ambiguous, input(later, [], [result('2026-10-30', 0, 1)]), later)
    expect(corrected.records[0].excludedReason).toBeNull()
    expect(summarizeTracker(corrected)).toMatchObject({ evaluated: 1, correct: 0 })
    const unavailable = updateTracker(corrected, { ...input(later, []), datasets: [] }, later)
    expect(unavailable.records[0].result).toEqual(corrected.records[0].result)
    expect(summarizeTracker(unavailable).evaluated).toBe(1)
    const removedResult = updateTracker(corrected, input(later, [], []), later)
    expect(removedResult.records[0].excludedReason).toBe('result-unavailable')
    expect(summarizeTracker(removedResult)).toMatchObject({ evaluated: 0, excluded: 1 })
    const restored = updateTracker(removedResult, input(later, [], [result('2026-10-30', 0, 1)]), later)
    expect(summarizeTracker(restored)).toMatchObject({ evaluated: 1, correct: 0, excluded: 0 })
    const conflictAfterScoring = updateTracker(corrected, input(later, [], [result('2026-10-30', 0, 1), result('2026-10-30', 1, 0)]), later)
    expect(summarizeTracker(conflictAfterScoring)).toMatchObject({ evaluated: 0, excluded: 1 })
    const resolved = updateTracker(conflictAfterScoring, input(later, [], [result('2026-10-30', 0, 1)]), later)
    expect(summarizeTracker(resolved)).toMatchObject({ evaluated: 1, correct: 0, excluded: 0 })
  })

  it('scores only forecasts that were re-observed on the public site before kick-off', () => {
    const initial = updateTracker(null, input(firstRun), firstRun, 'github-pages')
    expect(initial.records[0].verifiedAt).toBeNull()
    const beforeKickoff = new Date('2026-10-30T06:17:00Z')
    const verified = updateTracker(initial, input(beforeKickoff), beforeKickoff, 'github-pages')
    expect(verified.records[0].verifiedAt).toBe(beforeKickoff.toISOString())
    const later = new Date('2026-10-31T10:00:00Z')
    const scored = updateTracker(verified, input(later, [], [result('2026-10-30')]), later, 'github-pages')
    expect(summarizeTracker(scored)).toMatchObject({ evaluated: 1, correct: 1 })
    const firstObservedLate = updateTracker(initial, input(later, [], [result('2026-10-30')]), later, 'github-pages')
    expect(firstObservedLate.records[0]).toMatchObject({ excludedReason: 'unverified-publication', result: null })
    expect(summarizeTracker(firstObservedLate)).toMatchObject({ evaluated: 0, excluded: 1 })
    expect(updateTracker(firstObservedLate, input(later, [], [result('2026-10-30')]), later, 'github-pages').records[0].excludedReason).toBe('unverified-publication')
  })

  it('excludes a newly reported result dated before publication verification', () => {
    const laterFixture = fixture({ date: '2026-10-31', time: '11:00', kickoffTimestamp: Date.parse('2026-10-31T10:00:00Z') })
    const initial = updateTracker(null, input(firstRun, [laterFixture]), firstRun, 'github-pages')
    const verification = new Date('2026-10-31T06:17:00Z')
    const verified = updateTracker(initial, input(verification, [laterFixture]), verification, 'github-pages')
    expect(verified.records[0].verifiedAt).toBe(verification.toISOString())
    const later = new Date('2026-11-01T10:00:00Z')
    const discovered = updateTracker(verified, input(later, [], [result('2026-10-30')]), later, 'github-pages')
    expect(discovered.records[0].excludedReason).toBe('result-before-verification')
    expect(summarizeTracker(discovered)).toMatchObject({ evaluated: 0, excluded: 1 })
  })

  it('does not verify against stale data, a missing fixture, an existing result or an earlier reschedule', () => {
    const initial = updateTracker(null, input(firstRun), firstRun, 'github-pages')
    const check = new Date('2026-10-30T06:17:00Z')
    const stale = updateTracker(initial, input(check, [fixture()], [], { stale: true }), check, 'github-pages')
    expect(stale.records[0].verifiedAt).toBeNull()
    const missing = updateTracker(initial, input(check, []), check, 'github-pages')
    expect(missing.records[0].verifiedAt).toBeNull()
    const alreadyHasResult = updateTracker(initial, input(check, [fixture()], [result('2026-10-30')]), check, 'github-pages')
    expect(alreadyHasResult.records[0].excludedReason).toBe('unverified-publication')
    const early = fixture({ date: '2026-10-30', time: '07:00', kickoffTimestamp: Date.parse('2026-10-30T06:00:00Z') })
    const moved = updateTracker(initial, input(check, [early]), check, 'github-pages')
    expect(moved.records[0].excludedReason).toBe('unverified-publication')
  })

  it('refuses a corrupt ledger or a local preview rather than silently resetting it', () => {
    expect(() => updateTracker({ version: 1, records: [] }, input(firstRun), firstRun)).toThrow('refusing to reset')
    const preview = updateTracker(null, input(firstRun), firstRun)
    expect(() => updateTracker(preview, input(firstRun), firstRun, 'github-pages')).toThrow('local preview')
    const corrupted = structuredClone(updateTracker(null, input(firstRun), firstRun, 'github-pages'))
    corrupted.records[0].verifiedAt = '2026-10-31T00:00:00.000Z'
    expect(isValidTracker(corrupted)).toBe(false)
  })
})

describe('published ledger restore', () => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body })
  const missing = { ok: false, status: 404 }
  it('restores a valid published archive', async () => {
    const ledger = updateTracker(null, input(firstRun), firstRun, 'github-pages')
    const fetchImpl = vi.fn(async () => ok(ledger))
    expect(await restorePublishedTracker('https://example.com/repo/', { fetchImpl, runId: '123' })).toEqual(ledger)
    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/repo/data/track-record.json?build=123', expect.any(Object))
  })
  it('only bootstraps from a valid old deployment that has no tracker marker', async () => {
    const old = { mode: 'community', fixtures: [], source: {} }
    const fetchImpl = vi.fn().mockResolvedValueOnce(missing).mockResolvedValueOnce(ok(old))
    expect(await restorePublishedTracker('https://example.com/repo', { fetchImpl })).toBeNull()
    const missingLedger = vi.fn().mockResolvedValueOnce(missing).mockResolvedValueOnce(ok({ ...old, trackerVersion: 1 }))
    await expect(restorePublishedTracker('https://example.com/repo', { fetchImpl: missingLedger })).rejects.toThrow('refusing to reset')
  })
  it('fails closed for unavailable or corrupt public data', async () => {
    await expect(restorePublishedTracker('https://example.com/repo', { fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503 }) })).rejects.toThrow('503')
    await expect(restorePublishedTracker('https://example.com/repo', { fetchImpl: vi.fn().mockResolvedValue(ok({ version: 1 })) })).rejects.toThrow('invalid')
    const noSite = vi.fn().mockResolvedValueOnce(missing).mockResolvedValueOnce(missing)
    await expect(restorePublishedTracker('https://example.com/repo', { fetchImpl: noSite })).rejects.toThrow('Cannot verify')
  })
})
