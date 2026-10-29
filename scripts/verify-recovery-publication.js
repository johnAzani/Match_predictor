import { readFile } from 'node:fs/promises'
import { confirmPublishedLedger } from './lib/ledger-backups.js'

try {
  const bytes = await readFile('recovery-ledger/track-record.json')
  await confirmPublishedLedger({ bytes, baseUrl: process.env.PAGES_BASE_URL, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT || '1' })
  console.log('The recovered ledger is observable on the published Pages site, byte for byte.')
} catch (error) {
  console.error(`Could not confirm the recovery deployment: ${error.message}`)
  process.exitCode = 1
}
