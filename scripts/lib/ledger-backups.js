import { createHash } from 'node:crypto'
import { assertLedgerContinuity, parsePublishedLedger } from './ledger-integrity.js'

export const BACKUP_TAG = 'forecast-ledger-backups'
export const BACKUP_MARKER = '<!-- pitchside-forecast-ledger-backups:v1 -->'
const NAME_PATTERN = /^forecast-ledger-(\d{8}T\d{9}Z)-run(\d+)-attempt(\d+)-sha256([a-f0-9]{64})\.json$/

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export function backupName(ledger, bytes, runId, attempt) {
  if (!/^\d+$/.test(String(runId)) || !/^\d+$/.test(String(attempt))) throw new Error('Invalid workflow run identity')
  const stamp = new Date(ledger.updatedAt).toISOString().replace(/[-:.]/g, '')
  return `forecast-ledger-${stamp}-run${runId}-attempt${attempt}-sha256${sha256(bytes)}.json`
}

export function parseBackupName(name) {
  const match = typeof name === 'string' && name.match(NAME_PATTERN)
  if (!match) return null
  const stamp = match[1]
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}.${stamp.slice(15, 18)}Z`
  const time = Date.parse(iso)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== iso) return null
  return { time, hash: match[4], runId: match[2], attempt: match[3], day: iso.slice(0, 10), month: iso.slice(0, 7), year: iso.slice(0, 4) }
}

export function verifyBackupBytes(name, bytes) {
  const metadata = parseBackupName(name)
  if (!metadata || sha256(bytes) !== metadata.hash) throw new Error('The backup filename or SHA-256 checksum is invalid')
  const ledger = parsePublishedLedger(bytes)
  if (Date.parse(ledger.updatedAt) !== metadata.time) throw new Error('The backup timestamp does not match the ledger')
  return ledger
}

// Keep the 10 newest copies, plus the newest copy on each of the latest 30
// backup days, 24 months and 5 years. Never prune unrelated release assets.
function isManagedAsset(asset) {
  return Boolean(parseBackupName(asset?.name)) && Number.isSafeInteger(asset?.id) && asset.id > 0 && asset.state === 'uploaded' && asset.uploader?.login === 'github-actions[bot]'
}

export function backupRetention(assets, mustKeepId) {
  const managed = assets.filter(isManagedAsset).map((asset) => ({ asset, metadata: parseBackupName(asset.name) }))
    .sort((a, b) => b.metadata.time - a.metadata.time || b.asset.id - a.asset.id)
  if (!managed.some(({ asset }) => asset.id === mustKeepId)) throw new Error('New backup is absent from the release listing; refusing to prune')
  const keep = new Set([mustKeepId])
  const days = new Set(), months = new Set(), years = new Set()
  managed.forEach(({ asset, metadata }, index) => {
    if (index < 10) keep.add(asset.id)
    if (!days.has(metadata.day) && days.size < 30) { days.add(metadata.day); keep.add(asset.id) }
    if (!months.has(metadata.month) && months.size < 24) { months.add(metadata.month); keep.add(asset.id) }
    if (!years.has(metadata.year) && years.size < 5) { years.add(metadata.year); keep.add(asset.id) }
  })
  return { keep: managed.filter(({ asset }) => keep.has(asset.id)).map(({ asset }) => asset), remove: managed.filter(({ asset }) => !keep.has(asset.id)).map(({ asset }) => asset) }
}

export async function confirmPublishedLedger({ bytes, baseUrl, runId, attempt, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 12, delayMs = 5000 }) {
  parsePublishedLedger(bytes)
  let base
  try { base = new URL(baseUrl) } catch { throw new Error('Invalid published Pages URL') }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Published Pages URL must be an HTTPS site URL')
  const url = new URL(`${base.pathname.replace(/\/+$/, '')}/data/track-record.json`, base.origin)
  url.searchParams.set('backup', `${runId}-${attempt}`)
  let reason = 'not observed'
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      if (!response.ok) reason = `HTTP ${response.status}`
      else {
        const published = Buffer.from(await response.arrayBuffer())
        if (published.equals(Buffer.from(bytes))) return
        reason = 'the public ledger does not yet match this deployment'
      }
    } catch { reason = 'the published ledger could not be reached' }
    if (index + 1 < attempts) await sleep(delayMs)
  }
  throw new Error(`Cannot confirm the public ledger: ${reason}; no release backup was changed`)
}

async function readVerifiedAsset(api, asset) {
  const bytes = await api.request(`/releases/assets/${asset.id}`, { accept: 'application/octet-stream' })
  if (!Buffer.isBuffer(bytes) || bytes.length !== asset.size) throw new Error('Downloaded backup size does not match its release asset')
  return { bytes, ledger: verifyBackupBytes(asset.name, bytes) }
}

export function assertManagedRelease(release) {
  if (!Number.isSafeInteger(release?.id) || release.id <= 0 || !release.body?.includes(BACKUP_MARKER) || release.tag_name !== BACKUP_TAG || release.draft) {
    throw new Error('The backup release is not the expected managed release; refusing to change it')
  }
}

export async function latestManagedBackup(api, release) {
  assertManagedRelease(release)
  const assets = await api.list(`/releases/${release.id}/assets`)
  const managed = assets.filter(isManagedAsset)
    .sort((a, b) => parseBackupName(b.name).time - parseBackupName(a.name).time || b.id - a.id)
  if (!managed.length) throw new Error('The managed backup release has no verified ledger copies')
  return { asset: managed[0], ...(await readVerifiedAsset(api, managed[0])) }
}

export async function publishLedgerBackup({ bytes, baseUrl, runId, attempt, commit, api, fetchImpl, sleep, attempts, delayMs }) {
  const ledger = parsePublishedLedger(bytes)
  const name = backupName(ledger, bytes, runId, attempt)
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/i.test(commit)) throw new Error('Invalid workflow commit')
  await confirmPublishedLedger({ bytes, baseUrl, runId, attempt, fetchImpl, sleep, attempts, delayMs })

  let release = await api.request(`/releases/tags/${BACKUP_TAG}`, { allow404: true })
  if (!release) {
    release = await api.request('/releases', { method: 'POST', body: JSON.stringify({
      tag_name: BACKUP_TAG, target_commitish: commit, name: 'Forecast ledger backups (automated)', prerelease: true, make_latest: 'false',
      body: `${BACKUP_MARKER}\nAutomated copies are made only after the exact ledger is observed on the published site. The tag is a storage location, not a code release. See the project README for retention and recovery.`,
    }) })
  }
  assertManagedRelease(release)

  const path = `/releases/${release.id}/assets`
  const prior = await api.list(path)
  const priorManaged = prior.filter(isManagedAsset)
    .sort((a, b) => parseBackupName(b.name).time - parseBackupName(a.name).time || b.id - a.id)
  if (priorManaged.length) {
    const previous = await readVerifiedAsset(api, priorManaged[0])
    assertLedgerContinuity(previous.ledger, ledger)
  }

  let asset = prior.find((item) => item.name === name)
  if (!asset) asset = await api.request(`${path}?name=${encodeURIComponent(name)}`, { method: 'POST', upload: true, body: Buffer.from(bytes) })
  if (!isManagedAsset(asset) || asset.name !== name || asset.size !== bytes.length) {
    throw new Error('GitHub did not confirm the expected backup upload')
  }
  const uploaded = await readVerifiedAsset(api, asset)
  if (!uploaded.bytes.equals(Buffer.from(bytes))) throw new Error('Downloaded backup does not match the published ledger')

  const latestAssets = await api.list(path)
  const { remove } = backupRetention(latestAssets, asset.id)
  for (const old of remove) await api.request(`/releases/assets/${old.id}`, { method: 'DELETE' })
  return { name, sha256: sha256(bytes), releaseId: release.id, assetId: asset.id, pruned: remove.length }
}
