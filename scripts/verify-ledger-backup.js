import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { verifyBackupBytes } from './lib/ledger-backups.js'

try {
  const file = process.argv[2]
  if (!file) throw new Error('Usage: npm run verify-backup -- /path/to/forecast-ledger-...json')
  const ledger = verifyBackupBytes(basename(file), await readFile(file))
  console.log(`Verified SHA-256 and schema: ${ledger.records.length} forecasts, tracking since ${ledger.startedAt}, ledger updated ${ledger.updatedAt}.`)
  console.log('This only verifies the saved copy. A later published ledger may contain forecasts not present here; never silently replace it with an older backup.')
} catch (error) {
  console.error(`Backup verification failed: ${error.message}`)
  process.exitCode = 1
}
