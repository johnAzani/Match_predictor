import { describe, expect, it, vi } from 'vitest'
import { backtest, buildUpcomingFixtures, competitions, normalizeCommunityResults, normalizeHistoricalResults } from '../server/football.js'
import { createDataService, seasonFor } from '../server/data-service.js'

const league = competitions[0]
const result = (date, homeGoals = 1, awayGoals = 0) => ({ date, home: 'Alpha', away: 'Beta', homeGoals, awayGoals })
const fixture = { date: '2026-10-30', time: '15:00', home: 'Alpha', away: 'Beta' }

describe('community data and walk-forward evaluation', () => {
  it('accepts zero scores, rejects missing scores, and understands both historical score formats', () => {
    const rows = normalizeCommunityResults([
      { date: '2026-10-01', home: 'A', away: 'B', ft_home: '0', ft_away: '0' },
      { date: '2026-10-02', home: 'A', away: 'B', ft_home: '', ft_away: '1' },
      { date: '2026-10-03', home: 'A', away: 'B', ft_home: '   ', ft_away: '1' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].homeGoals).toBe(0)
    const history = normalizeHistoricalResults({ matches: [
      { date: '2025-08-01', team1: 'A', team2: 'B', score: [1, 2] },
      { date: '2025-08-02', team1: 'A', team2: 'B', score: { ft: [0, 0] } },
      { date: '2025-08-03', team1: 'A', team2: 'B' },
    ] })
    expect(history).toHaveLength(2)
    expect(history[1].awayGoals).toBe(0)
  })

  it('deduplicates repeated results and excludes conflicting scores', () => {
    const same = { date: '2026-10-01', home: 'A', away: 'B', ft_home: '1', ft_away: '0' }
    expect(normalizeCommunityResults([same, same])).toHaveLength(1)
    expect(normalizeCommunityResults([same, { ...same, ft_home: '2' }])).toHaveLength(0)
  })

  it('does not use any results from the same day when backtesting', () => {
    const results = [result('2026-09-01'), result('2026-09-01'), result('2026-09-01'), result('2026-09-01'), result('2026-09-02')]
    const report = backtest([{ league, season: '2026-27', results }], '2026-10-01')
    expect(report.completed).toBe(5)
    expect(report.evaluated).toBe(1)
    expect(report.skipped).toBe(4)
    expect(report.firstDate).toBe('2026-09-02')
    expect(report.accuracy).toBeGreaterThanOrEqual(0)
    expect(report.brier).toBeGreaterThanOrEqual(0)
  })

  it('uses only earlier dates for the upcoming slate and leaves insufficient data unpredicted', () => {
    const rows = [result('2026-10-01'), result('2026-10-08'), result('2026-10-15'), result('2026-10-29', 20, 0)]
    const dataset = { league, season: '2026-27', results: rows, fixtures: [fixture, { ...fixture, home: 'New Team' }] }
    const matches = buildUpcomingFixtures([dataset], new Date('2026-10-29T10:00:00Z'))
    expect(matches).toHaveLength(2)
    const established = matches.find((match) => match.home.name === 'Alpha')
    const newcomer = matches.find((match) => match.home.name === 'New Team')
    expect(established.home.sampleSize).toBe(3)
    expect(established.home.goalsFor).toBe(1)
    expect(established.hasEnoughData).toBe(true)
    expect(newcomer.home.sampleSize).toBe(0)
    expect(newcomer.hasEnoughData).toBe(false)
    const moved = buildUpcomingFixtures([{ ...dataset, fixtures: [{ ...fixture, date: '2026-10-31' }] }], new Date('2026-10-29T10:00:00Z'))[0]
    expect(moved.id).toBe(established.id)
    const ambiguous = buildUpcomingFixtures([{ ...dataset, fixtures: [fixture, { ...fixture, date: '2026-10-31' }] }], new Date('2026-10-29T10:00:00Z'))
    expect(ambiguous).toHaveLength(0)
  })

  it('derives season codes around the July season boundary', () => {
    expect(seasonFor(new Date('2026-10-29T00:00:00Z'))).toEqual({ label: '2026-27', code: '2627', previous: '2025-26' })
    expect(seasonFor(new Date('2027-02-01T00:00:00Z')).code).toBe('2627')
  })
})

function githubResponse(content, status = 200) {
  return { ok: status === 200, status, json: async () => ({ encoding: 'base64', content: Buffer.from(content).toString('base64') }) }
}

function mockProvider({ shouldFail = () => false } = {}) {
  const fixturesCsv = 'gw,date,time,home,away\n1,2026-10-30,15:00,Alpha,Beta\n'
  const resultsCsv = 'date,home,away,ft_home,ft_away,goal_minutes\n2026-10-01,Alpha,Beta,1,0,"5,23"\n2026-10-08,Alpha,Beta,0,0,\n2026-10-15,Alpha,Beta,2,1,\n'
  const historic = JSON.stringify({ matches: [{ date: '2025-08-01', team1: 'Alpha', team2: 'Beta', score: [1, 0] }] })
  return vi.fn(async (url) => {
    if (shouldFail(url)) return githubResponse('', 503)
    if (url.includes('build_summary.json')) return githubResponse(JSON.stringify({ season: '2627', generated_utc: '2026-10-29T05:00:00Z' }))
    if (url.includes('openfootball/football.json')) return githubResponse(historic)
    return githubResponse(url.includes('fixtures_') ? fixturesCsv : resultsCsv)
  })
}

describe('shared provider cache', () => {
  it('coalesces concurrent loads, caches the feed, and marks a failed refresh as stale', async () => {
    let fail = false
    let now = new Date('2026-10-29T10:00:00Z')
    const provider = mockProvider({ shouldFail: () => fail })
    const service = createDataService({ fetchImpl: provider, clock: () => now, cacheMs: 1000 })
    const [first, second] = await Promise.all([service.getMatchday(), service.getMatchday()])
    expect(first.mode).toBe('community')
    expect(first.fixtures).toHaveLength(4)
    expect(first.source.sourceUpdatedAt).toBe('2026-10-29T05:00:00.000Z')
    expect(second.source.stale).toBe(false)
    expect(provider).toHaveBeenCalledTimes(13)
    await service.getMatchday()
    expect(provider).toHaveBeenCalledTimes(13)
    now = new Date('2026-10-29T10:00:02Z')
    fail = true
    const stale = await service.getMatchday()
    expect(stale.fixtures).toHaveLength(4)
    expect(stale.source.stale).toBe(true)
    expect(stale.source.refreshFailed).toBe(true)
  })

  it('reports an unavailable league rather than inventing its fixtures', async () => {
    const provider = mockProvider({ shouldFail: (url) => url.includes('ITA_1_serie-a/fixtures_') })
    const data = await createDataService({ fetchImpl: provider, clock: () => new Date('2026-10-29T10:00:00Z') }).getMatchday()
    expect(data.source.unavailableLeagues).toEqual(['Serie A'])
    expect(data.source.availableLeagueCount).toBe(3)
    expect(data.fixtures.every((match) => match.league.id !== 'serie-a')).toBe(true)
  })

  it('marks unverifiable freshness and reports partial historical coverage', async () => {
    const provider = mockProvider({ shouldFail: (url) => url.includes('build_summary.json') || url.includes('openfootball/football.json/contents/2025-26/en.1.json') })
    const data = await createDataService({ fetchImpl: provider, clock: () => new Date('2026-10-29T10:00:00Z') }).getMatchday()
    expect(data.source.sourceUpdatedAt).toBeNull()
    expect(data.source.stale).toBe(true)
    expect(data.source.historicalLeagueCount).toBe(3)
  })

  it('fails cleanly when no source has ever loaded', async () => {
    const provider = mockProvider({ shouldFail: () => true })
    const service = createDataService({ fetchImpl: provider, clock: () => new Date('2026-10-29T10:00:00Z') })
    await expect(service.getMatchday()).rejects.toThrow('No community leagues are available')
  })
})
