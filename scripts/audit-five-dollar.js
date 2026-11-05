// Read-only audit of the replacement provider against the frozen team roster.
// It answers one question: can every fixture in the four covered competitions be
// mapped onto an existing identity? It never prints scores, odds or raw rows,
// never writes the site or the ledger, and never deploys anything.
import { loadProviderDatasets, ProviderDataError } from '../server/providers/five-dollar.js'

const KEY_HINT = 'Add the key at https://github.com/johnAzani/Match_predictor/settings/secrets/actions/new ' +
  '(Settings > Secrets and variables > Actions, not the Copilot "Agents" page), then re-apply the label.'

const apiKey = process.env.FIVE_DOLLAR_API_KEY
if (!apiKey?.trim()) {
  console.log('::error::No provider key reached this workflow. ' + KEY_HINT)
  process.exitCode = 1
} else {
  try {
    const { datasets, audit } = await loadProviderDatasets({ apiKey })
    const lines = [`Provider mapping audit at ${audit.checkedAt}`, `Requests: ${audit.requests}`, '']
    for (const [index, league] of audit.leagues.entries()) {
      const dataset = datasets[index]
      const seen = new Set([...dataset.results, ...dataset.fixtures].flatMap((row) => [row.home, row.away]))
      lines.push(`${league.competition}: ${league.results} results, ${league.fixtures} fixtures, ` +
        `${seen.size} teams seen, ${league.unknownTeams} unmapped, ${league.pages} pages`)
    }
    if (audit.unmapped.length) {
      lines.push('', 'Unmapped provider names (dropped from any forecast, never guessed):')
      for (const item of audit.unmapped) lines.push(`- ${item.competition}: ${item.name}`)
    } else {
      lines.push('', 'Every provider club in the window mapped onto the frozen roster.')
    }
    const skipped = Object.entries(audit.reasons).map(([reason, count]) => `${reason} ${count}`).join(', ')
    lines.push('', `Skipped rows: ${skipped || 'none'}`)
    lines.push('', 'This audit proves name mapping only. It does not prove accuracy, freshness, migration safety or publication rights.')

    console.log(lines.join('\n'))
    console.log(`::notice::Provider mapping audit: ${audit.leagues.map((league) => `${league.competition} ${league.unknownTeams} unmapped`).join(', ')}`)
  } catch (error) {
    const message = `Provider mapping audit failed: ${error instanceof ProviderDataError ? error.message : 'unexpected error.'}`
    console.error(message)
    console.log(`::error::${message}`)
    process.exitCode = 1
  }
}
