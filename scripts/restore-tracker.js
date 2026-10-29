import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { restorePublishedTracker } from './tracker-restore.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = resolve(root, 'public/data/track-record.json')

try {
  const ledger = await restorePublishedTracker(process.env.PAGES_BASE_URL, { runId: process.env.GITHUB_RUN_ID || 'local' })
  if (ledger) {
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, JSON.stringify(ledger))
    console.log(`Restored ${ledger.records.length} previously published forecasts.`)
  } else {
    // Never overwrite a local ledger when the public site is at bootstrap.
    try {
      await readFile(destination)
      throw new Error('A local tracker ledger already exists; refusing to replace it during bootstrap')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    console.log('No previous tracker exists on the verified older site; starting a new forward record.')
  }
  if (!process.env.GITHUB_ENV) throw new Error('GitHub Actions environment is required for a published ledger')
  await appendFile(process.env.GITHUB_ENV, 'TRACKER_RESTORED=1\n')
} catch (error) {
  console.error(`Could not safely restore the forecast ledger: ${error.message}`)
  process.exitCode = 1
}
