// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildMigrationReport, formatMigrationReport } from '../scripts/lib/migration-report.js'
import { matchId } from '../server/football.js'

const NOW = Date.parse('2026-11-05T15:00:00Z')
const HOUR = 60 * 60 * 1000

const league = { id: 'premier-league', name: 'Premier League', country: 'england' }
const season = '2026-27'

function record(overrides = {}) {
  return {
    id: matchId(season, league.id, 'Everton', 'Coventry'),
    season, league,
    originalKickoff: { date: '2026-11-04', time: '21:00', timestamp: NOW - 42 * HOUR },
    latestKickoff: { date: '2026-11-04', time: '21:00', timestamp: NOW - 42 * HOUR },
    recordedAt: '2026-11-03T10:00:00.000Z', verifiedAt: '2026-11-03T11:00:00.000Z',
    result: null, excludedReason: null, ...overrides,
  }
}

const dataset = (overrides = {}) => ({ league, season, results: [], fixtures: [], ...overrides })

describe('migration dry run', () => {
  it('counts forecasts the new source would resolve', () => {
    const report = buildMigrationReport({
      ledger: { records: [record()] },
      provider: [dataset({ results: [{ date: '2026-11-04', home: 'Everton', away: 'Coventry', homeGoals: 1, awayGoals: 0 }] })],
      now: NOW,
    })
    expect(report.wouldResolve).toBe(1)
    expect(report.pending).toBe(1)
    expect(report.blocking).toBe(false)
  })

  it('leaves a forecast pending while its match has not been played', () => {
    const future = record({ originalKickoff: { date: '2026-11-06', time: '21:00', timestamp: NOW + 20 * HOUR }, latestKickoff: { date: '2026-11-06', time: '21:00', timestamp: NOW + 20 * HOUR } })
    const report = buildMigrationReport({ ledger: { records: [future] }, provider: [dataset()], now: NOW })
    expect(report.stillPending).toBe(1)
    expect(report.atRisk).toBe(0)
  })

  it('flags a pending forecast stranded past kick-off', () => {
    const stale = record({
      originalKickoff: { date: '2026-11-03', time: '21:00', timestamp: NOW - 50 * HOUR },
      latestKickoff: { date: '2026-11-03', time: '21:00', timestamp: NOW - 50 * HOUR },
    })
    const report = buildMigrationReport({ ledger: { records: [stale] }, provider: [dataset()], now: NOW })
    expect(report.atRisk).toBe(1)
    expect(report.wouldResolve).toBe(0)
  })

  it('confirms an already-published score, and treats a missing one as out of window', () => {
    const scored = record({ result: { date: '2026-11-04', homeGoals: 1, awayGoals: 0, observedAt: '2026-11-05T06:00:00.000Z' } })
    const agreeing = buildMigrationReport({
      ledger: { records: [scored] },
      provider: [dataset({ results: [{ date: '2026-11-04', home: 'Everton', away: 'Coventry', homeGoals: 1, awayGoals: 0 }] })],
      now: NOW,
    })
    expect(agreeing.confirmed).toBe(1)
    expect(agreeing.blocking).toBe(false)

    const absent = buildMigrationReport({ ledger: { records: [scored] }, provider: [dataset()], now: NOW })
    expect(absent.absentFromProvider).toBe(1)
    expect(absent.blocking).toBe(false)
  })

  it('blocks on a contradicting score instead of rewriting history', () => {
    const scored = record({ result: { date: '2026-11-04', homeGoals: 1, awayGoals: 0, observedAt: '2026-11-05T06:00:00.000Z' } })
    const report = buildMigrationReport({
      ledger: { records: [scored] },
      provider: [dataset({ results: [{ date: '2026-11-04', home: 'Everton', away: 'Coventry', homeGoals: 0, awayGoals: 0 }] })],
      now: NOW,
    })
    expect(report.scoreDisagreements).toHaveLength(1)
    expect(report.blocking).toBe(true)
    expect(formatMigrationReport(report)).toContain('BLOCKED')
  })

  it('matches provider spellings through identity, not raw names', () => {
    const cityRecord = record({ id: matchId(season, league.id, 'Man City', 'Spurs') })
    const report = buildMigrationReport({
      ledger: { records: [cityRecord] },
      provider: [dataset({ results: [{ date: '2026-11-04', home: 'Man City', away: 'Spurs', homeGoals: 3, awayGoals: 1 }] })],
      now: NOW,
    })
    expect(report.wouldResolve).toBe(1)
  })

  it('counts new forecasts the provider would add', () => {
    const report = buildMigrationReport({
      ledger: { records: [record()] },
      provider: [dataset({ fixtures: [
        { date: '2026-11-06', time: '21:00', home: 'Everton', away: 'Coventry' },
        { date: '2026-11-07', time: '13:30', home: 'Leeds', away: 'Spurs' },
      ] })],
      now: NOW,
    })
    expect(report.newForecasts).toBe(1)
  })

  it('refuses to run without a ledger or provider data', () => {
    expect(() => buildMigrationReport({ ledger: {}, provider: [] })).toThrow(/ledger/i)
    expect(() => buildMigrationReport({ ledger: { records: [] }, provider: null })).toThrow(/provider/i)
  })
})
