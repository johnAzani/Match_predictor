import { readFile } from 'node:fs/promises'
import { githubApi } from './lib/github-api.js'
import { checkBackupContinuity } from './lib/backup-continuity.js'

try {
  let ledger = null
  try { ledger = JSON.parse(await readFile('public/data/track-record.json', 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const base = new URL(process.env.PAGES_BASE_URL)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Invalid published Pages URL')
  const url = new URL(`${base.pathname.replace(/\/+$/, '')}/data/matchday.json`, base.origin)
  url.searchParams.set('backup-check', `${process.env.GITHUB_RUN_ID || 'local'}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`)
  const response = await fetch(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`Cannot inspect the published snapshot (HTTP ${response.status})`)
  const snapshot = await response.json()
  if (snapshot?.mode !== 'community' || !Array.isArray(snapshot.fixtures) || !snapshot.source) throw new Error('The published matchday snapshot is invalid')
  const api = githubApi({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN })
  const result = await checkBackupContinuity({ ledger, backupVersion: snapshot.backupVersion, api })
  if (result.status === 'bootstrap') console.log('No managed release backup is expected on the older site; this deployment will create the first one.')
  else console.log(`Verified continuity against ${result.name} (${result.count} forecasts).`)
} catch (error) {
  console.error(`Published backup continuity check failed: ${error.message}`)
  process.exitCode = 1
}
