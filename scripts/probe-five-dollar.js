import { probeFiveDollar, ProviderProbeError } from './lib/five-dollar-probe.js'

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
