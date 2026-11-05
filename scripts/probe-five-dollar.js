import { probeFiveDollar, ProviderProbeError } from './lib/five-dollar-probe.js'

// GitHub keeps two similar-looking secret stores. Workflows can only read the
// "Actions" one; the Copilot agents page looks identical but is a separate
// store, so say which page to use instead of failing vaguely.
const KEY_SETUP_HINT = 'Add the key as an Actions secret at ' +
  'https://github.com/johnAzani/Match_predictor/settings/secrets/actions/new ' +
  '(Settings > Secrets and variables > Actions, not the Copilot "Agents" page), then re-apply the label.'

if (!process.env.FIVE_DOLLAR_API_KEY?.trim()) {
  console.log('::error::No provider key reached this workflow. ' + KEY_SETUP_HINT)
  process.exitCode = 1
} else {
  try {
    const report = await probeFiveDollar({ apiKey: process.env.FIVE_DOLLAR_API_KEY })
    console.log(`Replacement-source protocol check at ${report.checkedAt}: ${report.requests} requests, ${report.historyDays} days back and ${report.futureDays} days ahead.`)
    for (const league of report.leagues) {
      console.log(`${league.league}: ${league.finished} finished, ${league.scheduled} future scheduled, ${league.unknown} unknown (${league.pages} pages).`)
    }
    console.log('Football data by 5DollarFootballAPI: https://5dollarfootballapi.com/')
    console.log('Counts are not proof of freshness, accuracy, history-migration compatibility or publication rights. No site data was changed.')
  } catch (error) {
    // Never log a provider response, an arbitrary exception, the key or headers.
    // The same sanitized message is exposed as a workflow annotation so the
    // outcome is visible without downloading logs.
    const message = `Replacement-source check failed: ${error instanceof ProviderProbeError ? error.message : 'unexpected error.'}`
    console.error(message)
    console.log(`::error::${message}`)
    process.exitCode = 1
  }
}
