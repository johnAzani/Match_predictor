import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { createDataService } from '../server/data-service.js'
import { TRACKER_VERSION } from '../src/lib/tracker.js'
import { githubApi } from './lib/github-api.js'
import { prepareRecovery } from './lib/recovery.js'

async function writeAtomically(path, data) {
  await writeFile(`${path}.tmp`, data)
  await rename(`${path}.tmp`, path)
}

try {
  const token = process.env.GITHUB_TOKEN
  const api = githubApi({ repository: process.env.GITHUB_REPOSITORY, token })
  const recovered = await prepareRecovery({ confirmation: process.env.RECOVERY_CONFIRMATION, ref: process.env.GITHUB_REF, api, baseUrl: process.env.PAGES_BASE_URL, runId: process.env.GITHUB_RUN_ID })
  const fetchImpl = (url, options = {}) => {
    const headers = new Headers(options.headers)
    if (token && new URL(url).origin === 'https://api.github.com') headers.set('Authorization', `Bearer ${token}`)
    return fetch(url, { ...options, headers })
  }
  const { feed } = await createDataService({ fetchImpl }).getTrackingInput()
  if (feed?.mode !== 'community' || !feed.source || !Array.isArray(feed.fixtures)) throw new Error('Cannot prepare a valid community snapshot for recovery')
  await mkdir('public/data', { recursive: true })
  // Copy the verified public backup exactly. Do not generate or verify any
  // forecast during recovery; normal scheduled builds resume afterwards.
  await writeAtomically('public/data/track-record.json', recovered.bytes)
  await writeAtomically('public/data/matchday.json', JSON.stringify({ ...feed, trackerVersion: TRACKER_VERSION, backupVersion: 1 }))
  console.log(`Prepared ${recovered.assetName}: ${recovered.ledger.records.length} forecasts, previous public ledger ${recovered.previousState}. No forecasts were generated.`)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Manual forecast history recovery\n\nPrepared verified backup \`${recovered.assetName}\` containing ${recovered.ledger.records.length} forecasts. Previous public ledger: ${recovered.previousState}. No new forecasts were generated during recovery.\n`)
} catch (error) {
  console.error(`Forecast recovery was not prepared: ${error.message}`)
  process.exitCode = 1
}
