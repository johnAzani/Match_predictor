import { APPROVED_FEED_SOURCE } from '../../server/ledger-source.js'
import { competitions, matchId } from '../../server/football.js'
import { updateTracker } from '../../server/tracker.js'

export const HOUR = 60 * 60 * 1000
export const season = '2026-27'
export const league = competitions[0]
export const firstRun = new Date('2026-11-04T10:00:00Z')
export const verificationTime = new Date('2026-11-05T06:00:00Z')
export const selectionTime = new Date('2026-11-05T09:00:00Z')
export const resultTime = new Date('2026-11-06T10:00:00Z')

export function fixture({ homeName = 'Alpha', awayName = 'Beta', homeGoals = 2.2, awayGoals = 0.8, date = '2026-11-05', time = '18:30', ...overrides } = {}) {
  const home = { name: homeName, shortName: homeName, crest: null, goalsFor: homeGoals, goalsAgainst: 0.8, sampleSize: 5, form: ['W', 'W', 'D', 'W', 'W'] }
  const away = { name: awayName, shortName: awayName, crest: null, goalsFor: awayGoals, goalsAgainst: 2, sampleSize: 5, form: ['L', 'L', 'D', 'L', 'L'] }
  return { id: matchId(season, league.id, homeName, awayName), league, date, day: 'THU 05 NOV', time, kickoffTimestamp: Date.parse(`${date}T${time}:00+01:00`), home, away, hasEnoughData: true, ...overrides }
}

export function input(now, fixtures = [fixture()], results = [], sourceOverrides = {}) {
  return {
    feed: { mode: 'community', fixtures, source: { name: APPROVED_FEED_SOURCE, season, stale: false, sourceUpdatedAt: new Date(now.getTime() - HOUR).toISOString(), fetchedAt: now.toISOString(), unavailableLeagues: [], ...sourceOverrides } },
    datasets: [{ season, league, results }],
  }
}

export function makeScenario(fixtures = [fixture()]) {
  const initial = updateTracker(null, input(firstRun, fixtures), firstRun, 'github-pages')
  const verified = updateTracker(initial, input(verificationTime, fixtures), verificationTime, 'github-pages')
  const data = input(selectionTime, fixtures).feed
  return { initial, verified, fixtures, feed: { ...data, status: 'community' }, tracker: { status: 'ready', data: verified, loadFailed: false } }
}

export function completedScenario(scenario, homeGoals = 2, awayGoals = 0, resultsAt = resultTime) {
  const [match] = scenario.fixtures
  const result = { date: match.date, home: match.home.name, away: match.away.name, homeGoals, awayGoals }
  const nextInput = input(resultsAt, [], [result])
  const completed = updateTracker(scenario.verified, nextInput, resultsAt, 'github-pages')
  return { feed: { ...nextInput.feed, status: 'community' }, tracker: { status: 'ready', data: completed, loadFailed: false }, result, completed }
}
