import { readFile } from 'node:fs/promises'
import { githubApi } from './lib/github-api.js'
import { parsePublishedLedger } from './lib/ledger-integrity.js'
import { confirmPublishedLedger } from './lib/ledger-backups.js'
import { reportOverdueResults } from './lib/overdue-alerts.js'

try {
  if (process.env.BACKUP_RESULT !== 'success') throw new Error('The published ledger backup was not confirmed')
  const bytes = await readFile('overdue-build/track-record.json')
  const ledger = parsePublishedLedger(bytes)
  const repository = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  const attempt = process.env.GITHUB_RUN_ATTEMPT || '1'
  if (!/^\d+$/.test(String(runId)) || !/^\d+$/.test(String(attempt))) throw new Error('Invalid workflow identity')
  const api = githubApi({ repository, token: process.env.GITHUB_TOKEN })
  // A previously successful backup may belong to an older job being retried.
  // Reconfirm the artifact is still the current public ledger before touching
  // issues. This fetch does not send the GitHub token to the Pages host.
  await confirmPublishedLedger({ bytes, baseUrl: process.env.PAGES_BASE_URL, runId, attempt })
  const result = await reportOverdueResults({ api, repository, ledger, confirmedBackup: true, runId, attempt })
  console.log(result.issue ? `Overdue monitor ${result.status} GitHub issue #${result.issue} (${result.count} pending).` : 'Overdue monitor: no pending results over the threshold.')
} catch (error) {
  // A failed check is also reported by the refresh monitor; it must never
  // resolve an overdue issue when the published state could not be confirmed.
  console.error(`Could not check overdue results: ${error.message}`)
  process.exitCode = 1
}
