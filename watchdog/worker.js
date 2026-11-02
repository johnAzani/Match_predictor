import { checkPublishedLedger } from './ledger-health.js'

export default {
  async scheduled(_controller, env) {
    let result
    try {
      result = await checkPublishedLedger({ pingUrl: env.FRESHNESS_HEALTHCHECK_URL })
    } catch {
      // Unexpected exceptions may contain a secret URL or untrusted data.
      throw new Error('Ledger watchdog: unexpected-error')
    }
    // Reason codes contain no URL, credential, or match data. An unsuccessful
    // check intentionally sends no success ping; Healthchecks will time out.
    if (!result.ok) throw new Error(`Ledger watchdog: ${result.reason}`)
    console.log('Ledger watchdog: fresh published ledger confirmed.')
  },
}
