// Read-only evidence for a source migration. Given the published forecast
// ledger and provider datasets, it answers three questions without writing
// anything:
//
//   1. would the new source resolve forecasts that are still awaiting a result?
//   2. would it leave any pending forecast stranded (past kick-off, no result)?
//   3. does it ever contradict a result the ledger already published?
//
// A contradiction is the one hard blocker: publishing a different score for an
// already-scored forecast would rewrite history.
import { matchId } from '../../server/football.js'

const HOUR = 60 * 60 * 1000
const AT_RISK_HOURS = 48

function indexResults(datasets) {
  const index = new Map()
  for (const dataset of datasets) {
    for (const result of dataset.results) {
      const id = matchId(dataset.season, dataset.league.id, result.home, result.away)
      if (!index.has(id)) index.set(id, [])
      index.get(id).push(result)
    }
  }
  return index
}

export function buildMigrationReport({ ledger, provider, now = Date.now() }) {
  if (!ledger || !Array.isArray(ledger.records)) throw new Error('A published forecast ledger is required')
  if (!Array.isArray(provider)) throw new Error('Provider datasets are required')
  const today = new Date(now).toISOString().slice(0, 10)
  const resultById = indexResults(provider)
  const fixtures = provider.flatMap((dataset) => dataset.fixtures.map((fixture) => ({
    id: matchId(dataset.season, dataset.league.id, fixture.home, fixture.away), league: dataset.league.id,
  })))
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.id))

  const report = {
    checkedAt: new Date(now).toISOString(), total: ledger.records.length,
    scored: 0, pending: 0, wouldResolve: 0, stillPending: 0, atRisk: 0,
    confirmed: 0, absentFromProvider: 0, scoreDisagreements: [], newForecasts: 0,
  }

  for (const record of ledger.records) {
    const candidates = resultById.get(record.id) ?? []
    if (record.result) {
      report.scored += 1
      if (!candidates.length) { report.absentFromProvider += 1; continue }
      const score = candidates[0]
      if (score.homeGoals === record.result.homeGoals && score.awayGoals === record.result.awayGoals) report.confirmed += 1
      else report.scoreDisagreements.push({ id: record.id, league: record.league.id })
      continue
    }
    report.pending += 1
    const resolved = candidates.find((candidate) => candidate.date < today)
    if (resolved) { report.wouldResolve += 1; continue }
    const kickoff = record.latestKickoff?.timestamp ?? record.originalKickoff?.timestamp
    if (Number.isFinite(kickoff) && now - kickoff > AT_RISK_HOURS * HOUR) { report.atRisk += 1; continue }
    report.stillPending += 1
  }

  const recorded = new Set(ledger.records.map((record) => record.id))
  report.newForecasts = [...fixtureIds].filter((id) => !recorded.has(id)).length
  report.blocking = report.scoreDisagreements.length > 0
  return report
}

export function formatMigrationReport(report) {
  const lines = [
    `Source-migration dry run at ${report.checkedAt}`,
    `Published forecasts: ${report.total} (${report.scored} scored, ${report.pending} awaiting a result)`,
    '',
    `Would resolve from the new source: ${report.wouldResolve}`,
    `Still awaiting (kick-off not yet past): ${report.stillPending}`,
    `Past kick-off with no result on the new source: ${report.atRisk}`,
    '',
    `Already-scored forecasts confirmed by the new source: ${report.confirmed}`,
    `Scored forecasts older than the provider window (not retractions): ${report.absentFromProvider}`,
    `Contradicting scores: ${report.scoreDisagreements.length}`,
    `New forecasts the provider's fixtures would add: ${report.newForecasts}`,
    '',
    report.blocking
      ? 'BLOCKED: the new source disagrees with scores this ledger already published.'
      : 'No contradictions found. This is evidence for a migration, not a licence or accuracy check.',
  ]
  return lines.join('\n')
}
