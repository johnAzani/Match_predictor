import { parse } from 'csv-parse/browser/esm/sync'
import { seasonFor } from './season.js'
import { backtest, buildUpcomingFixtures, competitions, normalizeCommunityResults, normalizeHistoricalResults, WINDOW_DAYS } from './football.js'
import { loadProviderDatasets } from './providers/five-dollar.js'

const COMMUNITY_REPO = 'oladeeayo/open-matchday'
const HISTORY_REPO = 'openfootball/football.json'
const COMMUNITY_URL = 'https://github.com/oladeeayo/open-matchday'
const PROVIDER_URL = 'https://5dollarfootballapi.com/'
export const PROVIDER_SOURCE_NAME = 'five-dollar-football'
const HISTORY_URL = 'https://github.com/openfootball/football.json'
export { seasonFor }

const CACHE_MS = 30 * 60 * 1000
const FAILURE_RETRY_MS = 60 * 1000
const STALE_AFTER_MS = 48 * 60 * 60 * 1000

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

async function loadHistorical(season, fetchImpl) {
  const historyPromises = competitions.map(async (league) => {
    const text = await githubContent(HISTORY_REPO, `${season.previous}/${league.historicalFile}`, fetchImpl)
    const document = JSON.parse(text)
    return { league, season: season.previous, results: normalizeHistoricalResults(document), trackingResults: normalizeHistoricalResults(document, { keepConflicts: true }) }
  })
  const historical = await Promise.allSettled(historyPromises)
  return historical.filter((result) => result.status === 'fulfilled').map((result) => result.value)
}

async function loadSnapshot(now, fetchImpl) {
  const season = seasonFor(now)
  const leaguePromises = competitions.map(async (league) => {
    const base = `data/${league.directory}`
    const [fixturesCsv, resultsCsv] = await Promise.all([
      githubContent(COMMUNITY_REPO, `${base}/fixtures_${season.code}.csv`, fetchImpl),
      githubContent(COMMUNITY_REPO, `${base}/results_${season.code}.csv`, fetchImpl),
    ])
    const results = readCsv(resultsCsv, ['date', 'home', 'away', 'ft_home', 'ft_away'])
    return {
      league, season: season.label,
      fixtures: readCsv(fixturesCsv, ['date', 'time', 'home', 'away']),
      results: normalizeCommunityResults(results),
      trackingResults: normalizeCommunityResults(results, { keepConflicts: true }),
    }
  })
  const summaryPromise = githubContent(COMMUNITY_REPO, 'build_summary.json', fetchImpl).then((text) => JSON.parse(text))
  const [current, allHistorical, summary] = await Promise.all([
    Promise.allSettled(leaguePromises), loadHistorical(season, fetchImpl), summaryPromise.catch(() => null),
  ])
  const currentDatasets = current.filter((result) => result.status === 'fulfilled').map((result) => result.value)
  if (!currentDatasets.length) throw new Error('No community leagues are available')
  const available = new Set(currentDatasets.map((item) => item.league.id))
  const historicalDatasets = allHistorical.filter((dataset) => available.has(dataset.league.id))
  const updated = summary?.season === season.code && Number.isFinite(Date.parse(summary.generated_utc)) ? new Date(summary.generated_utc).toISOString() : null
  return {
    currentDatasets, historicalDatasets, season, sourceUpdatedAt: updated, fetchedAt: now.toISOString(),
    unavailableLeagues: competitions.filter((league) => !available.has(league.id)).map((league) => league.name),
    historicalLeagueCount: historicalDatasets.length,
    report: null, reportDate: null,
  }
}

// Same dataset shape and the same historical (CC0) backtest input, but the
// current season comes from the replacement provider. Freshness is proven by
// the data itself: if no covered competition has a single upcoming fixture,
// the feed is treated as stale rather than quietly published.
async function loadProviderSnapshot(now, provider, fetchImpl) {
  const season = seasonFor(now)
  const { datasets, audit } = await loadProviderDatasets({
    apiKey: provider.apiKey, fetchImpl: provider.fetchImpl ?? fetchImpl, now: now.getTime(),
  })
  const currentDatasets = datasets.filter((dataset) => dataset.results.length || dataset.fixtures.length)
  if (!currentDatasets.length) throw new Error('No provider leagues are available')
  const available = new Set(currentDatasets.map((dataset) => dataset.league.id))
  const historicalDatasets = (await loadHistorical(season, fetchImpl)).filter((dataset) => available.has(dataset.league.id))
  const scheduled = currentDatasets.reduce((total, dataset) => total + dataset.fixtures.length, 0)
  return {
    currentDatasets, historicalDatasets, season, sourceUpdatedAt: now.toISOString(), fetchedAt: now.toISOString(),
    providerStale: scheduled === 0, providerRequests: audit.requests,
    unavailableLeagues: competitions.filter((league) => !available.has(league.id)).map((league) => league.name),
    historicalLeagueCount: historicalDatasets.length,
    report: null, reportDate: null,
  }
}

function responseFromSnapshot(snapshot, now, refreshFailed, provider) {
  const today = now.toISOString().slice(0, 10)
  if (snapshot.reportDate !== today) {
    snapshot.report = backtest([...snapshot.historicalDatasets, ...snapshot.currentDatasets], today)
    snapshot.reportDate = today
  }
  const updatedAt = snapshot.sourceUpdatedAt
  // Without a trustworthy update timestamp, freshness cannot be verified.
  const stale = refreshFailed || !updatedAt || now.getTime() - Date.parse(updatedAt) > STALE_AFTER_MS ||
    Boolean(snapshot.providerStale)
  return {
    mode: 'community',
    fixtures: buildUpcomingFixtures(snapshot.currentDatasets, now),
    backtest: snapshot.report,
    source: {
      name: provider ? PROVIDER_SOURCE_NAME : 'open-matchday',
      url: provider ? PROVIDER_URL : COMMUNITY_URL,
      historyUrl: HISTORY_URL,
      season: snapshot.season.label, previousSeason: snapshot.season.previous,
      sourceUpdatedAt: updatedAt, fetchedAt: snapshot.fetchedAt, stale, refreshFailed,
      unavailableLeagues: snapshot.unavailableLeagues,
      historicalLeagueCount: snapshot.historicalLeagueCount,
      availableLeagueCount: snapshot.currentDatasets.length,
      windowDays: WINDOW_DAYS,
      ...(provider ? { attribution: { text: 'Football data by 5DollarFootballAPI', url: PROVIDER_URL } } : {}),
    },
  }
}

// The server shares a cache across visitors and coalesces concurrent refreshes.
// If the provider goes down after a successful fetch, serve the last snapshot
// with an explicit stale warning. Never silently substitute demo statistics.
export function createDataService({ fetchImpl = globalThis.fetch, clock = () => new Date(), cacheMs = CACHE_MS, provider = null } = {}) {
  if (provider && (typeof provider.apiKey !== 'string' || !provider.apiKey.trim())) {
    throw new Error('The replacement provider needs a server-side key')
  }
  let snapshot = null
  let expiresAt = 0
  let refreshFailed = false
  let pending = null

  async function getMatchday() {
    const now = clock()
    if (snapshot && now.getTime() < expiresAt) return responseFromSnapshot(snapshot, now, refreshFailed, provider)
    if (!pending) {
      const load = provider ? loadProviderSnapshot(now, provider, fetchImpl) : loadSnapshot(now, fetchImpl)
      pending = load.then((data) => {
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
    return responseFromSnapshot(snapshot, clock(), refreshFailed, provider)
  }

  // The scheduled tracker needs the same normalized results, but they are not
  // sent to visitors as part of the matchday API.
  async function getTrackingInput() {
    const feed = await getMatchday()
    const datasets = [...snapshot.historicalDatasets, ...snapshot.currentDatasets]
      .map((dataset) => ({ ...dataset, results: dataset.trackingResults }))
    return { feed, datasets }
  }

  return { getMatchday, getTrackingInput }
}
