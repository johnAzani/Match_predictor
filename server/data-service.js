import { parse } from 'csv-parse/browser/esm/sync'
import { backtest, buildUpcomingFixtures, competitions, normalizeCommunityResults, normalizeHistoricalResults, WINDOW_DAYS } from './football.js'

const COMMUNITY_REPO = 'oladeeayo/open-matchday'
const HISTORY_REPO = 'openfootball/football.json'
const COMMUNITY_URL = 'https://github.com/oladeeayo/open-matchday'
const HISTORY_URL = 'https://github.com/openfootball/football.json'
const CACHE_MS = 30 * 60 * 1000
const FAILURE_RETRY_MS = 60 * 1000
const STALE_AFTER_MS = 48 * 60 * 60 * 1000

export function seasonFor(date) {
  const year = date.getUTCFullYear()
  const start = date.getUTCMonth() >= 6 ? year : year - 1
  const end = start + 1
  return { label: `${start}-${String(end).slice(-2)}`, code: `${String(start).slice(-2)}${String(end).slice(-2)}`, previous: `${start - 1}-${String(start).slice(-2)}` }
}

function readCsv(text, required) {
  const rows = parse(text, { bom: true, skip_empty_lines: true, relax_column_count: true })
  const header = rows.shift()
  if (!header || required.some((column) => !header.includes(column))) throw new Error('Unexpected CSV format')
  const indexes = required.map((column) => header.indexOf(column))
  // Only use known columns: upstream headers never become object keys.
  return rows.map((row) => Object.fromEntries(required.map((column, index) => [column, row[indexes[index]] ?? ''])))
}

async function githubContent(repo, path, fetchImpl) {
  const headers = { Accept: 'application/vnd.github+json' }
  // Browsers set their own User-Agent and do not allow scripts to override it.
  if (typeof window === 'undefined') headers['User-Agent'] = 'Pitchside-matchday'
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/contents/${path}?ref=master`, {
    headers,
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`Source request failed (${response.status})`)
  const body = await response.json()
  if (body.encoding !== 'base64' || typeof body.content !== 'string') throw new Error('Unexpected source response')
  const binary = atob(body.content.replace(/\s/g, ''))
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

async function loadSnapshot(now, fetchImpl) {
  const season = seasonFor(now)
  const leaguePromises = competitions.map(async (league) => {
    const base = `data/${league.directory}`
    const [fixturesCsv, resultsCsv] = await Promise.all([
      githubContent(COMMUNITY_REPO, `${base}/fixtures_${season.code}.csv`, fetchImpl),
      githubContent(COMMUNITY_REPO, `${base}/results_${season.code}.csv`, fetchImpl),
    ])
    return {
      league, season: season.label,
      fixtures: readCsv(fixturesCsv, ['date', 'time', 'home', 'away']),
      results: normalizeCommunityResults(readCsv(resultsCsv, ['date', 'home', 'away', 'ft_home', 'ft_away'])),
    }
  })
  const historyPromises = competitions.map(async (league) => {
    const text = await githubContent(HISTORY_REPO, `${season.previous}/${league.historicalFile}`, fetchImpl)
    return { league, season: season.previous, results: normalizeHistoricalResults(JSON.parse(text)) }
  })
  const summaryPromise = githubContent(COMMUNITY_REPO, 'build_summary.json', fetchImpl).then((text) => JSON.parse(text))
  const [current, historical, summary] = await Promise.all([
    Promise.allSettled(leaguePromises), Promise.allSettled(historyPromises), summaryPromise.catch(() => null),
  ])
  const currentDatasets = current.filter((result) => result.status === 'fulfilled').map((result) => result.value)
  if (!currentDatasets.length) throw new Error('No community leagues are available')
  const available = new Set(currentDatasets.map((item) => item.league.id))
  const historicalDatasets = historical.filter((result) => result.status === 'fulfilled' && available.has(result.value.league.id)).map((result) => result.value)
  const updated = summary?.season === season.code && Number.isFinite(Date.parse(summary.generated_utc)) ? new Date(summary.generated_utc).toISOString() : null
  return {
    currentDatasets, historicalDatasets, season, sourceUpdatedAt: updated, fetchedAt: now.toISOString(),
    unavailableLeagues: competitions.filter((league) => !available.has(league.id)).map((league) => league.name),
    historicalLeagueCount: historicalDatasets.length,
    report: null, reportDate: null,
  }
}

function responseFromSnapshot(snapshot, now, refreshFailed) {
  const today = now.toISOString().slice(0, 10)
  if (snapshot.reportDate !== today) {
    snapshot.report = backtest([...snapshot.historicalDatasets, ...snapshot.currentDatasets], today)
    snapshot.reportDate = today
  }
  const updatedAt = snapshot.sourceUpdatedAt
  // Without a trustworthy update timestamp, freshness cannot be verified.
  const stale = refreshFailed || !updatedAt || now.getTime() - Date.parse(updatedAt) > STALE_AFTER_MS
  return {
    mode: 'community',
    fixtures: buildUpcomingFixtures(snapshot.currentDatasets, now),
    backtest: snapshot.report,
    source: {
      name: 'open-matchday', url: COMMUNITY_URL, historyUrl: HISTORY_URL,
      season: snapshot.season.label, previousSeason: snapshot.season.previous,
      sourceUpdatedAt: updatedAt, fetchedAt: snapshot.fetchedAt, stale, refreshFailed,
      unavailableLeagues: snapshot.unavailableLeagues,
      historicalLeagueCount: snapshot.historicalLeagueCount,
      availableLeagueCount: snapshot.currentDatasets.length,
      windowDays: WINDOW_DAYS,
    },
  }
}

// The server shares a cache across visitors and coalesces concurrent refreshes.
// If the provider goes down after a successful fetch, serve the last snapshot
// with an explicit stale warning. Never silently substitute demo statistics.
export function createDataService({ fetchImpl = globalThis.fetch, clock = () => new Date(), cacheMs = CACHE_MS } = {}) {
  let snapshot = null
  let expiresAt = 0
  let refreshFailed = false
  let pending = null

  async function getMatchday() {
    const now = clock()
    if (snapshot && now.getTime() < expiresAt) return responseFromSnapshot(snapshot, now, refreshFailed)
    if (!pending) {
      pending = loadSnapshot(now, fetchImpl).then((data) => {
        snapshot = data
        expiresAt = clock().getTime() + cacheMs
        refreshFailed = false
      }).catch((error) => {
        if (!snapshot) throw error
        expiresAt = clock().getTime() + FAILURE_RETRY_MS
        refreshFailed = true
      }).finally(() => { pending = null })
    }
    await pending
    return responseFromSnapshot(snapshot, clock(), refreshFailed)
  }

  return { getMatchday }
}
