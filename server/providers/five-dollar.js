// Read-only adapter for 5DollarFootballAPI.
//
// It converts the provider's fixtures into the same dataset shape the existing
// model, forecast ledger and static Pages snapshot already use, so that a
// migration can keep one identity space:
//
//   * league ids stay this site's ids (`premier-league`, …), never the
//     provider's numeric ids;
//   * season labels come from the existing `seasonFor` helper, so
//     `matchId(season, leagueId, home, away)` is unchanged;
//   * team names are resolved to the frozen roster in `community-teams.json`
//     through `team-aliases.js`, so old forecasts keep matching.
//
// Anything ambiguous fails closed. A match is only published when both clubs
// resolve to a known roster entry; unknown clubs are counted and named for the
// audit rather than guessed.
import { competitions, teamKey } from '../football.js'
import { seasonFor } from '../season.js'
import { COMMUNITY_TEAMS } from './community-teams.js'
import { TEAM_ALIASES } from './team-aliases.js'

export const PROVIDER_ORIGIN = 'https://api.5dollarfootballapi.com'
export const HISTORY_DAYS = 90 // Free plan: three months of results.
export const FUTURE_DAYS = 14
export const PAGE_SIZE = 100
export const MAX_PAGES_PER_LEAGUE = 6

// Provider league ids come from its published coverage page. They are pinned
// here so a silent coverage change shows up as an audit failure.
export const PROVIDER_LEAGUES = Object.freeze([
  Object.freeze({ id: 4160026622, competition: 'premier-league' }),
  Object.freeze({ id: 4212821298, competition: 'la-liga' }),
  Object.freeze({ id: 686337048, competition: 'bundesliga' }),
  Object.freeze({ id: 3405541143, competition: 'serie-a' }),
])

const STATUS = new Set(['scheduled', 'in_play', 'finished', 'unknown'])

export class ProviderDataError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProviderDataError'
  }
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

// Builds a resolver for one league. The canonical spelling always comes from
// the frozen roster, never from the alias table or the provider.
export function createTeamResolver(competition, { aliases = TEAM_ALIASES, keyOf = teamKey } = {}) {
  const names = COMMUNITY_TEAMS[competition]
  if (!Array.isArray(names) || !names.length) throw new ProviderDataError(`No team roster for ${competition}`)
  const byKey = new Map()
  for (const name of names) {
    const key = keyOf(name)
    if (byKey.has(key)) throw new ProviderDataError(`Roster for ${competition} has a duplicate identity`)
    byKey.set(key, name)
  }
  const resolve = (providerName) => {
    const key = keyOf(providerName)
    const alias = aliases ? aliases[key] : undefined
    if (alias) return byKey.get(keyOf(alias)) ?? null
    return byKey.get(key) ?? null
  }
  return { resolve, byKey }
}

// Kick-offs are given in UTC; the site has always displayed approximate UTC+1.
// Nigeria has no daylight saving, so a fixed offset is exact, not approximate.
export function lagosKickoff(kickoffUtc) {
  const timestamp = Date.parse(kickoffUtc)
  if (!Number.isFinite(timestamp)) return null
  const local = new Date(timestamp + 60 * 60 * 1000)
  return { date: local.toISOString().slice(0, 10), time: local.toISOString().slice(11, 16) }
}

// Validates and converts one provider row. Returns `null` for rows that must
// not be published (unknown clubs, in-play or unconfirmed results, malformed
// data, fixtures well outside the window) and a reason for the audit.
export function normalizeRow(row, { leagueId, competition, resolve, now, start, end }) {
  if (!row || !validId(row.id) || row.league?.id !== leagueId) return { reason: 'malformed' }
  if (!validTeam(row.teams?.home) || !validTeam(row.teams?.away)) return { reason: 'malformed' }
  if (row.teams.home.id === row.teams.away.id) return { reason: 'malformed' }
  if (!STATUS.has(row.status)) return { reason: 'malformed' }
  const kickoff = Date.parse(row.kickoff_utc)
  if (typeof row.kickoff_utc !== 'string' || !Number.isFinite(kickoff)) return { reason: 'malformed' }
  if (!Number.isSafeInteger(row.kickoff_ts) || kickoff !== row.kickoff_ts * 1000) return { reason: 'malformed' }
  if (kickoff < start || kickoff >= end) return { reason: 'outside-window' }

  const homeName = row.teams.home.name.trim()
  const awayName = row.teams.away.name.trim()
  const home = resolve(homeName)
  const away = resolve(awayName)
  if (!home || !away) {
    return {
      reason: 'unknown-team', competition,
      unmapped: [...new Set([!home ? homeName : null, !away ? awayName : null].filter(Boolean))],
    }
  }
  const { date, time } = lagosKickoff(row.kickoff_utc)

  if (row.status === 'finished') {
    // `finished` is the only state the provider confirms; a missing full-time
    // mark or a kick-off that has not happened yet is not a result.
    if (row.status_code !== 'full' || kickoff > now) return { reason: 'unconfirmed' }
    if (!validGoals(row.goals?.home) || !validGoals(row.goals?.away)) return { reason: 'unconfirmed' }
    return {
      kind: 'result',
      result: { date, home, away, homeGoals: row.goals.home, awayGoals: row.goals.away },
    }
  }
  if (row.status === 'scheduled' && kickoff > now) {
    return { kind: 'fixture', fixture: { date, time, home, away } }
  }
  // in_play, unknown, and stale "scheduled" rows carry no publishable outcome.
  return { reason: 'not-publishable' }
}

async function fetchPage({ leagueId, page, start, end, apiKey, fetchImpl }) {
  const url = new URL(`/v1/leagues/${leagueId}/fixtures`, PROVIDER_ORIGIN)
  url.search = new URLSearchParams({
    start_time: String(Math.floor(start / 1000)),
    end_time: String(Math.floor(end / 1000)),
    order: 'asc',
    page: String(page),
    per_page: String(PAGE_SIZE),
  }).toString()
  let response
  try {
    response = await fetchImpl(url.href, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new ProviderDataError('provider request failed or timed out')
  }
  if (response.status === 301) throw new ProviderDataError('a provider league id moved; review it before continuing')
  if (response.status === 401 || response.status === 403) throw new ProviderDataError('the key or plan cannot read this league')
  if (response.status === 429) throw new ProviderDataError('provider rate limit reached')
  if (!response.ok) throw new ProviderDataError(`provider request failed (${response.status})`)
  let body
  try { body = await response.json() } catch { throw new ProviderDataError('provider returned invalid JSON') }
  if (body?.success !== 1 || !Array.isArray(body.data) || body.data.length > PAGE_SIZE ||
    body.pagination?.page !== page || typeof body.pagination?.has_more !== 'boolean') {
    throw new ProviderDataError('unexpected provider response')
  }
  return body
}

// Loads all four competitions. Returns datasets in the shape `buildUpcomingFixtures`,
// `backtest`, the tracker and the static snapshot already expect, plus an audit
// summary that contains no scores, odds or raw rows.
export async function loadProviderDatasets({ apiKey, fetchImpl = globalThis.fetch, now = Date.now(), competitionsById = competitions } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) throw new ProviderDataError('a provider key is required')
  if (typeof fetchImpl !== 'function' || !Number.isFinite(now)) throw new ProviderDataError('provider configuration is invalid')
  const current = Math.floor(now / 1000) * 1000
  const start = current - HISTORY_DAYS * 24 * 60 * 60 * 1000
  const end = current + FUTURE_DAYS * 24 * 60 * 60 * 1000
  const season = seasonFor(new Date(current))
  const datasets = []
  const audit = { requests: 0, checkedAt: new Date(current).toISOString(), leagues: [], unmapped: [], reasons: {} }

  for (const providerLeague of PROVIDER_LEAGUES) {
    const league = competitionsById.find((item) => item.id === providerLeague.competition)
    if (!league) throw new ProviderDataError(`no site competition for ${providerLeague.competition}`)
    const { resolve } = createTeamResolver(providerLeague.competition)
    const results = []
    const fixtures = []
    const leagueAudit = { competition: providerLeague.competition, pages: 0, results: 0, fixtures: 0, unknownTeams: new Set() }
    for (let page = 1; page <= MAX_PAGES_PER_LEAGUE; page += 1) {
      const body = await fetchPage({ leagueId: providerLeague.id, page, start, end, apiKey: apiKey.trim(), fetchImpl })
      audit.requests += 1
      leagueAudit.pages += 1
      for (const row of body.data) {
        const normalized = normalizeRow(row, { leagueId: providerLeague.id, competition: providerLeague.competition, resolve, now: current, start, end })
        if (normalized?.kind === 'result') { results.push(normalized.result); leagueAudit.results += 1 }
        else if (normalized?.kind === 'fixture') { fixtures.push(normalized.fixture); leagueAudit.fixtures += 1 }
        else if (normalized?.reason) {
          audit.reasons[normalized.reason] = (audit.reasons[normalized.reason] ?? 0) + 1
          for (const name of normalized.unmapped ?? []) leagueAudit.unknownTeams.add(name)
        }
      }
      if (!body.pagination.has_more) break
      if (page === MAX_PAGES_PER_LEAGUE) throw new ProviderDataError(`provider history for ${providerLeague.competition} is incomplete`)
    }
    audit.unmapped.push(...[...leagueAudit.unknownTeams].sort().map((name) => ({ competition: providerLeague.competition, name })))
    audit.leagues.push({ ...leagueAudit, unknownTeams: leagueAudit.unknownTeams.size })
    datasets.push({ league, season: season.label, results, trackingResults: results, fixtures })
  }

  return { datasets, audit, season }
}
