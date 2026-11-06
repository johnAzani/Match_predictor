// Dry run: what would switching the live feed to the replacement provider do to
// the published forecast ledger? Read-only — it downloads nothing, writes
// nothing and never touches the site, the ledger or its backups.
import { readFile } from 'node:fs/promises'
import { loadProviderDatasets } from '../server/providers/five-dollar.js'
import { buildMigrationReport, formatMigrationReport } from './lib/migration-report.js'

const KEY_HINT = 'Add the key at https://github.com/johnAzani/Match_predictor/settings/secrets/actions/new ' +
  '(Settings > Secrets and variables > Actions, not the Copilot "Agents" page), then re-apply the label.'
const ledgerPath = process.env.LEDGER_PATH || 'published-ledger.json'

try {
  if (!process.env.FIVE_DOLLAR_API_KEY?.trim()) {
    console.log('::error::No provider key reached this workflow. ' + KEY_HINT)
    process.exitCode = 1
  } else {
    let ledger
    try {
      ledger = JSON.parse(await readFile(ledgerPath, 'utf8'))
    } catch {
      throw new Error(`could not read the published ledger at ${ledgerPath}`)
    }
    const { datasets } = await loadProviderDatasets({ apiKey: process.env.FIVE_DOLLAR_API_KEY })
    const report = buildMigrationReport({ ledger, provider: datasets })
    console.log(formatMigrationReport(report))
    console.log(`::notice::Migration dry run: ${report.wouldResolve} would resolve, ${report.atRisk} at risk, ` +
      `${report.scoreDisagreements.length} contradictions, ${report.newForecasts} new forecasts.`)
    if (report.blocking) process.exitCode = 1
  }
} catch (error) {
  console.log(`::error::Migration dry run failed: ${error.message}`)
  process.exitCode = 1
}
