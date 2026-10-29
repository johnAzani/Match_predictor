import { appendFile, readFile } from 'node:fs/promises'
import { githubApi } from './lib/github-api.js'
import { publishLedgerBackup } from './lib/ledger-backups.js'

try {
  const repository = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  const attempt = process.env.GITHUB_RUN_ATTEMPT || '1'
  const bytes = await readFile(process.env.BUILD_LEDGER_PATH || 'backup-build/track-record.json')
  const api = githubApi({ repository, token: process.env.GITHUB_TOKEN })
  const backup = await publishLedgerBackup({ bytes, baseUrl: process.env.PAGES_BASE_URL, runId, attempt, commit: process.env.GITHUB_SHA, api })
  console.log(`Confirmed public ledger backup: ${backup.name} (SHA-256 ${backup.sha256}); pruned ${backup.pruned} older managed copies.`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Forecast ledger backup\n\nThe uploaded copy matched the public Pages ledger and was downloaded and SHA-256 verified.\n\n- Backup: \`${backup.name}\`\n- SHA-256: \`${backup.sha256}\`\n- [Open backup release](https://github.com/${repository}/releases/tag/forecast-ledger-backups)\n`)
  }
} catch (error) {
  console.error(`Forecast ledger backup failed: ${error.message}`)
  process.exitCode = 1
}
