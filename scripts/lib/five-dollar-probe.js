// A small, read-only compatibility probe. It does not create forecasts, write
// provider responses, modify the public ledger or prove data-usage rights.
const API_ORIGIN = 'https://api.5dollarfootballapi.com'
const DAY = 24 * 60 * 60 * 1000
const HISTORY_DAYS = 85 // within the advertised Free plan's three-month window
const FUTURE_DAYS = 14
const MAX_PAGES = 3 // at most 12 requests; within Free's advertised 20/minute
const PAGE_SIZE = 100
const STATUS = new Set(['scheduled', 'in_play', 'finished', 'unknown'])

// IDs published in the provider's league coverage, not the illustrative IDs in
// its example responses. A moved ID stops the probe for a manual review.
export const FIVE_DOLLAR_LEAGUES = [
  { name: 'Premier League', id: 4160026622 },
  { name: 'La Liga', id: 4212821298 },
  { name: 'Bundesliga', id: 686337048 },
  { name: 'Serie A', id: 3405541143 },
]

export class ProviderProbeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProviderProbeError'
  }
}

function invalidResponse(league) {
  return new ProviderProbeError(`${league.name}: unexpected or incomplete provider response.`)
}

function validId(value) {
  return Number.isSafeInteger(value) && value > 0
}

function validTeam(team) {
  return team && validId(team.id) && typeof team.name === 'string' && team.name.trim().length > 0
}

function validGoals(value) {
  return Number.isInteger(value) && value >= 0 && value <= 50
}

function inspectFixture(row, league, start, end, now) {
  if (!row || !validId(row.id) || row.league?.id !== league.id || !validTeam(row.teams?.home) ||
    !validTeam(row.teams?.away) || row.teams.home.id === row.teams.away.id || !STATUS.has(row.status) ||
    typeof row.kickoff_utc !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(row.kickoff_utc)) throw invalidResponse(league)
  const kickoff = Date.parse(row.kickoff_utc)
  if (!Number.isFinite(kickoff) || kickoff < start || kickoff >= end || !Number.isSafeInteger(row.kickoff_ts) ||
    kickoff !== row.kickoff_ts * 1000) throw invalidResponse(league)
  // The provider documents finished/full as the only safe final-score state.
  if (row.status === 'finished' && (row.status_code !== 'full' || kickoff > now ||
    !validGoals(row.goals?.home) || !validGoals(row.goals?.away))) throw invalidResponse(league)
  return {
    id: row.id,
    scheduled: row.status === 'scheduled' && kickoff > now,
    finished: row.status === 'finished',
    unknown: row.status === 'unknown',
  }
}

async function loadPage(league, page, start, end, apiKey, fetchImpl) {
  const url = new URL(`/v1/leagues/${league.id}/fixtures`, API_ORIGIN)
  url.search = new URLSearchParams({
    start_time: String(Math.floor(start / 1000)), end_time: String(Math.floor(end / 1000)),
    order: 'asc', page: String(page), per_page: String(PAGE_SIZE),
  }).toString()
  let response
  try {
    response = await fetchImpl(url.href, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      // Never forward the secret to a redirect destination. League merges are
      // reviewed explicitly rather than treating a redirect as empty data.
      redirect: 'manual', signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new ProviderProbeError(`${league.name}: provider request failed or timed out.`)
  }
  if (response?.status === 301) throw new ProviderProbeError(`${league.name}: provider league ID moved; review it before continuing.`)
  if (response?.status === 401 || response?.status === 403) throw new ProviderProbeError(`${league.name}: the key or plan could not access this league.`)
  if (response?.status === 429) throw new ProviderProbeError(`${league.name}: provider rate limit reached; try again later.`)
  if (!response?.ok) throw new ProviderProbeError(`${league.name}: provider request failed.`)
  let body
  try { body = await response.json() } catch { throw invalidResponse(league) }
  if (body?.success !== 1 || !Array.isArray(body.data) || body.data.length > PAGE_SIZE ||
    body.pagination?.page !== page || typeof body.pagination?.has_more !== 'boolean') throw invalidResponse(league)
  return body
}

// Returns aggregate counts only, never raw fixtures, scores, team names or the
// key. A complete, pinned time window is required; partial pages fail closed.
export async function probeFiveDollar({ apiKey, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) throw new ProviderProbeError('A provider key is required in the server-side secret.')
  if (typeof fetchImpl !== 'function' || !Number.isFinite(now)) throw new ProviderProbeError('Provider probe configuration is invalid.')
  const current = Math.floor(now / 1000) * 1000
  const start = current - HISTORY_DAYS * DAY
  const end = current + FUTURE_DAYS * DAY
  if (![start, current, end].every((time) => Number.isFinite(new Date(time).getTime()))) throw new ProviderProbeError('Provider probe configuration is invalid.')
  const results = []
  let requests = 0
  for (const league of FIVE_DOLLAR_LEAGUES) {
    const seen = new Set()
    const summary = { league: league.name, scheduled: 0, finished: 0, unknown: 0, pages: 0 }
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = await loadPage(league, page, start, end, apiKey.trim(), fetchImpl)
      requests += 1
      summary.pages += 1
      for (const row of body.data) {
        const item = inspectFixture(row, league, start, end, current)
        if (seen.has(item.id)) throw invalidResponse(league)
        seen.add(item.id)
        summary.scheduled += Number(item.scheduled)
        summary.finished += Number(item.finished)
        summary.unknown += Number(item.unknown)
      }
      if (!body.pagination.has_more) break
      if (page === MAX_PAGES || !body.data.length) throw new ProviderProbeError(`${league.name}: response is incomplete; refusing a partial history.`)
    }
    results.push(summary)
  }
  return { checkedAt: new Date(current).toISOString(), historyDays: HISTORY_DAYS, futureDays: FUTURE_DAYS, requests, leagues: results }
}
