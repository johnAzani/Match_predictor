import { assertLedgerContinuity, parsePublishedLedger } from './ledger-integrity.js'
import { BACKUP_TAG, latestManagedBackup } from './ledger-backups.js'

export const RECOVERY_CONFIRMATION = 'RESTORE LATEST VERIFIED BACKUP'

// Recovery is explicitly manual and never adds or recalculates forecasts. A
// network/5xx error is not evidence that the published ledger has disappeared.
export async function prepareRecovery({ confirmation, ref, api, baseUrl, runId, fetchImpl = globalThis.fetch }) {
  if (ref !== 'refs/heads/main') throw new Error('Recovery must run from main')
  if (confirmation !== RECOVERY_CONFIRMATION) throw new Error(`Type exactly ${RECOVERY_CONFIRMATION} to acknowledge possible loss of unbacked forecasts`)
  const release = await api.request(`/releases/tags/${BACKUP_TAG}`, { allow404: true })
  if (!release) throw new Error('No managed forecast backup release exists')
  const backup = await latestManagedBackup(api, release)
  let base
  try { base = new URL(baseUrl) } catch { throw new Error('Invalid published Pages URL') }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Invalid published Pages URL')
  const url = new URL(`${base.pathname.replace(/\/+$/, '')}/data/track-record.json`, base.origin)
  url.searchParams.set('recovery-check', String(runId))
  let response
  try { response = await fetchImpl(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, cache: 'no-store', signal: AbortSignal.timeout(15_000) }) }
  catch { throw new Error('The public ledger could not be reached; refusing to treat a network error as missing history') }
  if (!response.ok && response.status !== 404) throw new Error(`The public ledger returned HTTP ${response.status}; refusing recovery`)
  let current = null
  let currentBytes = null
  if (response.ok) {
    currentBytes = Buffer.from(await response.arrayBuffer())
    try { current = parsePublishedLedger(currentBytes) } catch { /* A corrupt public file requires the explicit confirmation above. */ }
  }
  if (current) {
    if (currentBytes.equals(backup.bytes)) throw new Error('The latest verified backup is already published; no recovery is needed')
    if (Date.parse(current.updatedAt) >= Date.parse(backup.ledger.updatedAt)) throw new Error('The public history is as new as or newer than the backup; refusing to overwrite it')
    assertLedgerContinuity(current, backup.ledger)
  }
  return { bytes: backup.bytes, ledger: backup.ledger, assetName: backup.asset.name, previousState: current ? 'older' : response.status === 404 ? 'missing' : 'invalid' }
}
