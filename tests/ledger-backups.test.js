import { describe, expect, it, vi } from 'vitest'
import { createTracker, isValidTracker } from '../src/lib/tracker.js'
import { assertLedgerContinuity, parsePublishedLedger } from '../scripts/lib/ledger-integrity.js'
import { BACKUP_MARKER, BACKUP_TAG, backupName, backupRetention, confirmPublishedLedger, parseBackupName, publishLedgerBackup, sha256, verifyBackupBytes } from '../scripts/lib/ledger-backups.js'
import { githubApi } from '../scripts/lib/github-api.js'
import { checkBackupContinuity } from '../scripts/lib/backup-continuity.js'
import { prepareRecovery, RECOVERY_CONFIRMATION } from '../scripts/lib/recovery.js'

const start = '2026-10-29T11:00:00.000Z'
const recorded = '2026-10-29T12:00:00.000Z'
const updated = '2026-10-29T13:00:00.000Z'
const team = (name) => ({ name, shortName: name, crest: null, goalsFor: 1.5, goalsAgainst: 1, sampleSize: 5, form: ['W', 'D', 'L', 'W', 'W'] })
const kickoff = (date) => ({ date, time: '18:30', timestamp: Date.parse(`${date}T18:30:00+01:00`) })
function ledger() {
  return {
    ...createTracker(new Date(start), 'github-pages'), updatedAt: updated, sourceUpdatedAt: start, sourceStale: false,
    records: [{
      id: 'community-test', season: '2026-27', league: { id: 'premier-league', name: 'Premier League', country: 'england' },
      home: team('Alpha'), away: team('Beta'), originalKickoff: kickoff('2026-10-30'), latestKickoff: kickoff('2026-10-30'),
      recordedAt: recorded, verifiedAt: null, modelVersion: 'poisson-v1', excludedReason: null, result: null,
      prediction: { pick: 'home', probabilities: { home: 50, draw: 25, away: 25 }, probabilitiesExact: { home: 0.5, draw: 0.25, away: 0.25 }, likelyScore: { home: 1, away: 1 }, expectedGoals: { home: 1.5, away: 1 } },
    }],
  }
}
const bytesOf = (data) => Buffer.from(JSON.stringify(data))
const fileResponse = (bytes, status = 200) => ({ ok: status === 200, status, arrayBuffer: async () => Uint8Array.from(bytes).buffer })

function fakeApi() {
  const state = { release: null, assets: [], data: new Map(), nextId: 1 }
  const request = vi.fn(async (path, options = {}) => {
    if (path === `/releases/tags/${BACKUP_TAG}`) return state.release
    if (path === '/releases' && options.method === 'POST') {
      const body = JSON.parse(options.body)
      state.release = { id: 100, tag_name: body.tag_name, body: body.body, draft: false }
      return state.release
    }
    if (path.startsWith('/releases/100/assets?name=') && options.method === 'POST') {
      const name = decodeURIComponent(path.split('?name=')[1])
      const bytes = Buffer.from(options.body)
      const asset = { id: state.nextId++, name, state: 'uploaded', size: bytes.length, uploader: { login: 'github-actions[bot]' } }
      state.assets.push(asset); state.data.set(asset.id, bytes)
      return asset
    }
    const match = path.match(/^\/releases\/assets\/(\d+)$/)
    if (match && options.method === 'DELETE') {
      state.assets = state.assets.filter((item) => item.id !== Number(match[1])); state.data.delete(Number(match[1])); return null
    }
    if (match && options.accept === 'application/octet-stream') return state.data.get(Number(match[1]))
    throw new Error(`Unexpected API request ${path}`)
  })
  const list = vi.fn(async (path) => {
    if (path !== '/releases/100/assets') throw new Error('Unexpected list path')
    return [...state.assets]
  })
  return { state, request, list }
}

const publish = (api, data, overrides = {}) => publishLedgerBackup({
  bytes: bytesOf(data), baseUrl: 'https://example.github.io/project/', runId: '100', attempt: '1', commit: 'a'.repeat(40), api,
  fetchImpl: vi.fn(async () => fileResponse(bytesOf(data))), sleep: vi.fn(), attempts: 2, delayMs: 0, ...overrides,
})

describe('ledger integrity', () => {
  it('accepts a verified publication, reschedule and correction without changing the original pick', () => {
    const before = ledger(), after = structuredClone(before)
    expect(isValidTracker(before)).toBe(true)
    after.updatedAt = '2026-11-01T08:00:00.000Z'
    after.records[0].verifiedAt = '2026-10-29T14:00:00.000Z'
    after.records[0].latestKickoff = kickoff('2026-10-31')
    after.records[0].result = { date: '2026-10-31', homeGoals: 1, awayGoals: 0, observedAt: '2026-11-01T08:00:00.000Z' }
    expect(() => assertLedgerContinuity(before, after)).not.toThrow()
  })

  it('refuses lost records, changed frozen inputs, verification regressions and invalid or preview backups', () => {
    const before = ledger()
    const lost = { ...before, records: [] }
    expect(() => assertLedgerContinuity(before, lost)).toThrow('disappeared')
    const changed = structuredClone(before); changed.records[0].prediction.expectedGoals.home = 2
    expect(() => assertLedgerContinuity(before, changed)).toThrow('Frozen prediction')
    const verified = structuredClone(before); verified.updatedAt = '2026-10-29T14:00:00.000Z'; verified.records[0].verifiedAt = verified.updatedAt
    const reverted = structuredClone(verified); reverted.records[0].verifiedAt = null
    expect(() => assertLedgerContinuity(verified, reverted)).toThrow('verification changed')
    expect(() => parsePublishedLedger(Buffer.from('{'))).toThrow('not valid JSON')
    expect(() => parsePublishedLedger(bytesOf({ ...before, publication: 'local-preview' }))).toThrow('valid published ledger')
  })
})

describe('durable ledger backups', () => {
  it('verifies a release filename, timestamp and checksum, rejecting tampering', () => {
    const data = ledger(), bytes = bytesOf(data), name = backupName(data, bytes, '123', '2')
    expect(parseBackupName(name)).toMatchObject({ runId: '123', attempt: '2', hash: sha256(bytes) })
    expect(verifyBackupBytes(name, bytes)).toEqual(data)
    expect(() => verifyBackupBytes(name, Buffer.concat([bytes, Buffer.from(' ')]))).toThrow('SHA-256')
    expect(() => verifyBackupBytes('forecast-ledger.json', bytes)).toThrow('filename')
    expect(() => backupName(data, bytes, '123/evil', '1')).toThrow('identity')
  })

  it('waits for the exact public bytes and never sends the GitHub token to Pages', async () => {
    const bytes = bytesOf(ledger())
    const fetchImpl = vi.fn().mockResolvedValueOnce(fileResponse(Buffer.from('{}'))).mockResolvedValueOnce(fileResponse(bytes))
    const sleep = vi.fn()
    await confirmPublishedLedger({ bytes, baseUrl: 'https://example.github.io/project/', runId: '5', attempt: '1', fetchImpl, sleep, attempts: 2 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0].href).toBe('https://example.github.io/project/data/track-record.json?backup=5-1')
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined()
    expect(sleep).toHaveBeenCalledTimes(1)
    await expect(confirmPublishedLedger({ bytes, baseUrl: 'http://example.test/', runId: '1', attempt: '1' })).rejects.toThrow('HTTPS')
  })

  it('creates a managed release only after public confirmation and verifies the uploaded bytes', async () => {
    const api = fakeApi(), data = ledger()
    const result = await publish(api, data)
    expect(api.state.release.body).toContain(BACKUP_MARKER)
    expect(api.state.assets).toHaveLength(1)
    expect(result.sha256).toBe(sha256(bytesOf(data)))
    expect(verifyBackupBytes(result.name, api.state.data.get(result.assetId))).toEqual(data)
    expect(result.pruned).toBe(0)
    // A retry of the same run verifies the existing copy instead of overwriting it.
    await publish(api, data)
    expect(api.state.assets).toHaveLength(1)
  })

  it('does not touch releases when deployment is missing, and never prunes after a failed verification', async () => {
    const api = fakeApi(), data = ledger()
    await expect(publish(api, data, { fetchImpl: vi.fn(async () => fileResponse(Buffer.from('{}'))), attempts: 1 })).rejects.toThrow('Cannot confirm')
    expect(api.request).not.toHaveBeenCalled()
    const failing = fakeApi()
    const original = failing.request
    failing.request = vi.fn(async (path, options = {}) => {
      if (options.accept === 'application/octet-stream') return Buffer.alloc(bytesOf(data).length, 1)
      return original(path, options)
    })
    await expect(publish(failing, data)).rejects.toThrow('SHA-256')
    expect(failing.request.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
  })

  it('refuses an unmanaged release and a public history that lost older forecasts', async () => {
    const api = fakeApi(), before = ledger()
    api.state.release = { id: 100, tag_name: BACKUP_TAG, draft: false, body: 'Not managed by this application' }
    await expect(publish(api, before)).rejects.toThrow('expected managed release')
    api.state.release = null
    await publish(api, before)
    const lost = { ...before, updatedAt: '2026-10-29T15:00:00.000Z', records: [] }
    await expect(publish(api, lost, { runId: '101' })).rejects.toThrow('disappeared')
    expect(api.state.assets).toHaveLength(1)
  })

  it('checks restored public history against a verified backup before allowing the next build', async () => {
    const api = fakeApi(), data = ledger()
    expect(await checkBackupContinuity({ ledger: data, backupVersion: undefined, api })).toEqual({ status: 'bootstrap' })
    await expect(checkBackupContinuity({ ledger: data, backupVersion: 1, api })).rejects.toThrow('release is missing')
    await expect(checkBackupContinuity({ ledger: data, backupVersion: 2, api })).rejects.toThrow('Unknown backup marker')
    await publish(api, data)
    expect(await checkBackupContinuity({ ledger: data, backupVersion: 1, api })).toMatchObject({ status: 'verified', count: 1 })
    const regressed = { ...data, updatedAt: '2026-10-29T15:00:00.000Z', records: [] }
    await expect(checkBackupContinuity({ ledger: regressed, backupVersion: 1, api })).rejects.toThrow('disappeared')
    await expect(checkBackupContinuity({ ledger: null, backupVersion: undefined, api })).rejects.toThrow('refusing to start over')
    expect(api.request.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
  })

  it('keeps recent, daily, monthly and yearly copies and never selects unrelated assets', () => {
    const assets = []
    for (let i = 0; i < 90; i += 1) {
      const time = new Date(Date.parse('2026-10-29T12:00:00.000Z') - i * 24 * 60 * 60 * 1000)
      const data = { ...ledger(), updatedAt: time.toISOString() }
      assets.push({ id: i + 1, name: backupName(data, Buffer.from('test'), String(i + 1), '1'), state: 'uploaded', size: 4, uploader: { login: 'github-actions[bot]' } })
    }
    assets.push({ id: 999, name: 'personal-notes.txt', state: 'uploaded' })
    const plan = backupRetention(assets, 1)
    expect(plan.keep.map((item) => item.id)).toContain(1)
    expect(plan.keep.length).toBeGreaterThanOrEqual(30)
    expect(plan.remove.length).toBeGreaterThan(0)
    expect(plan.remove.map((item) => item.id)).not.toContain(999)
    expect(() => backupRetention(assets, 1000)).toThrow('refusing to prune')
  })
})

describe('manual recovery safeguards', () => {
  async function recoveredApi() { const api = fakeApi(); await publish(api, ledger()); return api }
  const options = (api, fetchImpl) => ({ api, fetchImpl, baseUrl: 'https://example.github.io/project', ref: 'refs/heads/main', confirmation: RECOVERY_CONFIRMATION, runId: '42' })

  it('requires explicit confirmation and the main branch before touching a backup', async () => {
    const api = fakeApi()
    await expect(prepareRecovery({ ...options(api, vi.fn()), confirmation: 'yes' })).rejects.toThrow('Type exactly')
    await expect(prepareRecovery({ ...options(api, vi.fn()), ref: 'refs/heads/other' })).rejects.toThrow('from main')
    expect(api.request).not.toHaveBeenCalled()
  })

  it('recovers only a checksum-verified backup when the public file is missing or invalid', async () => {
    const api = await recoveredApi()
    const missing = await prepareRecovery(options(api, vi.fn(async () => fileResponse(Buffer.from(''), 404))))
    expect(missing.previousState).toBe('missing')
    expect(missing.bytes).toEqual(bytesOf(ledger()))
    const corrupt = await prepareRecovery(options(api, vi.fn(async () => fileResponse(Buffer.from('not a ledger')))))
    expect(corrupt.previousState).toBe('invalid')
  })

  it('never treats a network failure or 5xx as evidence of missing history', async () => {
    const api = await recoveredApi()
    await expect(prepareRecovery(options(api, vi.fn().mockRejectedValue(new Error('offline'))))).rejects.toThrow('network error')
    await expect(prepareRecovery(options(api, vi.fn(async () => fileResponse(Buffer.from(''), 503))))).rejects.toThrow('HTTP 503')
  })

  it('refuses to overwrite a newer, equal or conflicting valid public ledger', async () => {
    const api = await recoveredApi(), data = ledger()
    await expect(prepareRecovery(options(api, vi.fn(async () => fileResponse(bytesOf(data)))))).rejects.toThrow('already published')
    const newer = { ...data, updatedAt: '2026-10-29T14:00:00.000Z' }
    await expect(prepareRecovery(options(api, vi.fn(async () => fileResponse(bytesOf(newer)))))).rejects.toThrow('newer than the backup')
    const sameTimeDifferent = structuredClone(data); sameTimeDifferent.records[0].latestKickoff = kickoff('2026-10-31')
    await expect(prepareRecovery(options(api, vi.fn(async () => fileResponse(bytesOf(sameTimeDifferent)))))).rejects.toThrow('as new as or newer')
    const older = { ...data, updatedAt: recorded, records: [] }
    expect((await prepareRecovery(options(api, vi.fn(async () => fileResponse(bytesOf(older)))))).previousState).toBe('older')
    const conflictingOlder = structuredClone(data); conflictingOlder.updatedAt = '2026-10-29T12:30:00.000Z'; conflictingOlder.records[0].home.goalsFor = 9
    await expect(prepareRecovery(options(api, vi.fn(async () => fileResponse(bytesOf(conflictingOlder)))))).rejects.toThrow('Frozen home changed')
  })
})

describe('GitHub API boundary', () => {
  it('runs the complete release protocol through the GitHub HTTP client without external access', async () => {
    const data = ledger(), bytes = bytesOf(data), state = { release: null, assets: [], blobs: new Map() }
    const json = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value })
    const githubFetch = vi.fn(async (url, options = {}) => {
      const path = url.pathname
      if (path.endsWith(`/releases/tags/${BACKUP_TAG}`)) return state.release ? json(state.release) : json({}, 404)
      if (path.endsWith('/releases') && options.method === 'POST') {
        const body = JSON.parse(options.body)
        state.release = { id: 100, tag_name: body.tag_name, body: body.body, draft: false }
        return json(state.release, 201)
      }
      if (path.endsWith('/releases/100/assets') && options.method === 'POST') {
        expect(url.origin).toBe('https://uploads.github.com')
        const asset = { id: 1, name: url.searchParams.get('name'), state: 'uploaded', size: options.body.length, uploader: { login: 'github-actions[bot]' } }
        state.assets.push(asset); state.blobs.set(asset.id, Buffer.from(options.body)); return json(asset, 201)
      }
      if (path.endsWith('/releases/100/assets')) return json(state.assets)
      if (path.endsWith('/releases/assets/1')) return fileResponse(state.blobs.get(1))
      throw new Error(`Unexpected mocked URL ${url.href}`)
    })
    const api = githubApi({ repository: 'owner/repo', token: 'test-token', fetchImpl: githubFetch })
    const result = await publish(api, data)
    expect(result.assetId).toBe(1)
    expect(await checkBackupContinuity({ ledger: data, backupVersion: 1, api })).toMatchObject({ status: 'verified' })
    expect(githubFetch.mock.calls.every(([url]) => ['https://api.github.com', 'https://uploads.github.com'].includes(url.origin))).toBe(true)
    expect(githubFetch.mock.calls.every(([, options]) => options.headers.Authorization === 'Bearer test-token')).toBe(true)
  })

  it('uses only the official API and upload origins and never logs the token', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 1 }) }))
    const api = githubApi({ repository: 'owner/repository', token: 'fake-token', fetchImpl })
    await api.request('/releases')
    await api.request('/releases/1/assets?name=file', { method: 'POST', upload: true, body: Buffer.from('{}') })
    expect(fetchImpl.mock.calls.map(([url]) => url.origin)).toEqual(['https://api.github.com', 'https://uploads.github.com'])
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer fake-token')
    expect(() => githubApi({ repository: 'bad/repo/extra', token: 'fake-token' })).toThrow('repository')
  })
})
