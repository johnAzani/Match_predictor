import { createDataService } from '../../server/data-service.js'

const CACHE_KEY = 'pitchside-pages-feed-v1'
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000
const STALE_AFTER_MS = 48 * 60 * 60 * 1000
const CLOCK_SKEW_MS = 5 * 60 * 1000

function isFeed(data, now) {
  const fetchedAt = Date.parse(data?.source?.fetchedAt)
  const validTeam = (team) => team && typeof team.name === 'string' && typeof team.shortName === 'string' &&
    Array.isArray(team.form) && team.form.every((result) => ['W', 'D', 'L'].includes(result))
  const report = data?.backtest
  const validReport = !report || report.evaluated === 0 || (Number.isFinite(report.evaluated) &&
    ['accuracy', 'baselineAccuracy', 'brier', 'logLoss', 'skipped'].every((key) => Number.isFinite(report[key])))
  return data?.mode === 'community' && Array.isArray(data.fixtures) && data.source && validReport &&
    Number.isInteger(data.source.availableLeagueCount) &&
    (data.source.unavailableLeagues === undefined || Array.isArray(data.source.unavailableLeagues)) &&
    Number.isFinite(fetchedAt) && fetchedAt <= now + CLOCK_SKEW_MS &&
    data.fixtures.every((fixture) => fixture && typeof fixture.id === 'string' &&
      typeof fixture.day === 'string' && typeof fixture.time === 'string' && Number.isFinite(fixture.kickoffTimestamp) &&
      fixture.league && typeof fixture.league.id === 'string' && typeof fixture.league.name === 'string' &&
      validTeam(fixture.home) && validTeam(fixture.away))
}

function browserStorage() {
  try { return window.localStorage } catch { return null }
}

function readCached(storage, now) {
  try {
    const data = JSON.parse(storage?.getItem(CACHE_KEY) || 'null')
    return isFeed(data, now) ? data : null
  } catch { return null }
}

function saveCached(storage, data) {
  try { storage?.setItem(CACHE_KEY, JSON.stringify(data)) } catch { /* Private mode or full storage. */ }
}

export function prepareStaticFeed(data, now = Date.now()) {
  const fetchedAt = Date.parse(data.source.fetchedAt)
  const updatedAt = Date.parse(data.source.sourceUpdatedAt)
  const stale = Boolean(data.source.stale) || !Number.isFinite(fetchedAt) || !Number.isFinite(updatedAt) ||
    now - fetchedAt > STALE_AFTER_MS || now - updatedAt > STALE_AFTER_MS ||
    fetchedAt > now + CLOCK_SKEW_MS || updatedAt > now + CLOCK_SKEW_MS
  return {
    ...data,
    // A deployed snapshot may outlive individual fixtures; never keep showing
    // a match as upcoming once its approximate kick-off has passed.
    fixtures: data.fixtures.filter((fixture) => Number.isFinite(fixture.kickoffTimestamp) && fixture.kickoffTimestamp >= now),
    source: { ...data.source, stale, delivery: 'github-pages' },
  }
}

// GitHub Pages cannot run our Node endpoint. Start with its bundled snapshot,
// preferring a newer browser cache. If it is over a day old, try the public
// community source directly; on failure keep the snapshot and mark it stale.
export async function loadStaticMatchday({
  signal,
  fetchImpl = globalThis.fetch,
  storage = browserStorage(),
  now = Date.now(),
  url = `${import.meta.env.BASE_URL}data/matchday.json`,
  onCached = () => {},
  serviceFactory = (options) => createDataService(options),
} = {}) {
  const cached = readCached(storage, now)
  if (cached && !signal?.aborted) onCached(prepareStaticFeed(cached, now))

  let bundled = null
  try {
    const response = await fetchImpl(url, { signal, cache: 'no-store' })
    if (response.ok) {
      const data = await response.json()
      if (isFeed(data, now)) bundled = data
    }
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error
  }
  if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError')

  const candidates = [cached, bundled].filter(Boolean).sort((a, b) => Date.parse(b.source.fetchedAt) - Date.parse(a.source.fetchedAt))
  const latest = candidates[0]
  if (latest) {
    onCached(prepareStaticFeed(latest, now))
    if (now - Date.parse(latest.source.fetchedAt) < REFRESH_AFTER_MS) return prepareStaticFeed(latest, now)
  }

  try {
    const data = await serviceFactory({ fetchImpl }).getMatchday()
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
    if (!isFeed(data, now)) throw new Error('Unexpected community feed')
    saveCached(storage, data)
    return prepareStaticFeed(data, now)
  } catch (error) {
    if (signal?.aborted || error.name === 'AbortError') throw error
    if (!latest) throw error
    const fallback = prepareStaticFeed(latest, now)
    return { ...fallback, source: { ...fallback.source, stale: true, refreshFailed: true } }
  }
}
