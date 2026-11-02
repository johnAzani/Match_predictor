import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { createTracker } from '../src/lib/tracker.js'
import { sendSuccessPing, validPingUrl } from '../watchdog/healthchecks.js'
import * as workerEntrypoint from '../watchdog/worker.js'
import { assessPublishedLedger, checkPublishedLedger, MAX_LEDGER_AGE_MS, PUBLIC_LEDGER_URL } from '../watchdog/ledger-health.js'
import { reportScheduledHeartbeat } from '../scripts/lib/schedule-heartbeat.js'

const now = Date.parse('2026-10-31T10:00:00.000Z')
const hour = 60 * 60 * 1000
const pingUrl = 'https://hc-ping.com/test-only-secret'
const ledger = (updated = now) => ({
  ...createTracker(new Date(now - 10 * 24 * hour), 'github-pages'),
  updatedAt: new Date(updated).toISOString(), sourceUpdatedAt: new Date(now - hour).toISOString(), sourceStale: false,
})
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
function fetcher(data = ledger(), ping = { ok: true, text: async () => 'OK' }) {
  return vi.fn(async (url) => {
    if (String(url).startsWith(PUBLIC_LEDGER_URL)) return reply(data)
    if (url === pingUrl) return ping
    throw new Error('Unexpected destination')
  })
}
const schedule = { event: 'schedule', attempt: '1', build: 'success', deploy: 'success', backup: 'success', notify: 'success', pingUrl }

describe('Healthchecks ping security', () => {
  it('accepts the two ordinary secret URL formats and refuses redirects or other origins', async () => {
    expect(validPingUrl(pingUrl)).toBe(true)
    expect(validPingUrl('https://hc-ping.com/project-key/my-check')).toBe(true)
    for (const value of ['', 'http://hc-ping.com/key', 'https://hc-ping.com.evil.example/key', 'https://hc-ping.com:444/key',
      'https://user:password@hc-ping.com/key', 'https://hc-ping.com/key?token=other', 'https://hc-ping.com/key#fragment',
      'https://hc-ping.com/key/fail', 'https://hc-ping.com/key/start', 'https://hc-ping.com/key/1',
      'https://hc-ping.com/key/extra/path', '  https://hc-ping.com/key']) {
      expect(validPingUrl(value), value).toBe(false)
    }
    const mock = vi.fn(async () => ({ ok: false, status: 302 }))
    expect(await sendSuccessPing(pingUrl, { fetchImpl: mock })).toEqual({ ok: false, reason: 'ping-unavailable' })
    expect(mock).toHaveBeenCalledTimes(2)
    expect(mock.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'manual' })
  })

  it.each(['OK (not found)', 'OK (rate limited)', '', 'ok', pingUrl])('does not mistake an unconfirmed 200 response for success', async (body) => {
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => body }))
    expect(await sendSuccessPing(pingUrl, { fetchImpl })).toEqual({ ok: false, reason: 'ping-unavailable' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('retries a transient failure and never returns a secret or raw error', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error(`sensitive ${pingUrl}`)).mockResolvedValueOnce({ ok: true, text: async () => 'OK\n' })
    expect(await sendSuccessPing(pingUrl, { fetchImpl })).toEqual({ ok: true, reason: 'sent' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const failed = await sendSuccessPing(pingUrl, { fetchImpl: vi.fn(async () => { throw new Error(pingUrl) }) })
    expect(failed).toEqual({ ok: false, reason: 'ping-unavailable' })
    expect(JSON.stringify(failed)).not.toContain(pingUrl)
    const notCalled = vi.fn()
    expect(await sendSuccessPing('https://elsewhere.example/secret', { fetchImpl: notCalled })).toEqual({ ok: false, reason: 'invalid-ping-url' })
    expect(notCalled).not.toHaveBeenCalled()
  })
})

describe('independent published-ledger freshness', () => {
  it('uses a strict 36-hour threshold and rejects invalid or suspicious clocks', () => {
    expect(assessPublishedLedger(ledger(now - MAX_LEDGER_AGE_MS), now)).toEqual({ ok: true, reason: 'fresh-ledger' })
    expect(assessPublishedLedger(ledger(now - MAX_LEDGER_AGE_MS - 1), now).reason).toBe('stale-ledger')
    expect(assessPublishedLedger(ledger(now + 5 * 60 * 1000), now).ok).toBe(true)
    expect(assessPublishedLedger(ledger(now + 5 * 60 * 1000 + 1), now).reason).toBe('future-ledger')
    expect(assessPublishedLedger(ledger(), NaN).reason).toBe('invalid-clock')
    expect(assessPublishedLedger(ledger(), 1e100).reason).toBe('invalid-clock')
  })

  it('checks ledger freshness only, not community-source health or football accuracy', () => {
    expect(assessPublishedLedger({ ...ledger(), sourceStale: true, sourceUpdatedAt: null }, now)).toEqual({ ok: true, reason: 'fresh-ledger' })
  })

  it('rejects corrupt, partial and local-preview history rather than claiming it is healthy', () => {
    expect(assessPublishedLedger(null, now).reason).toBe('invalid-ledger')
    expect(assessPublishedLedger({ ...ledger(), records: null }, now).reason).toBe('invalid-ledger')
    expect(assessPublishedLedger({ ...ledger(), records: [{ id: 'bad' }] }, now).reason).toBe('invalid-ledger')
    expect(assessPublishedLedger({ ...ledger(), publication: 'local-preview' }, now).reason).toBe('invalid-ledger')
  })

  it('checks the public ledger without credentials, then sends a body-free success ping', async () => {
    const fetchImpl = fetcher()
    expect(await checkPublishedLedger({ pingUrl, fetchImpl, now })).toEqual({ ok: true, reason: 'fresh-ledger' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [publicUrl, readOptions] = fetchImpl.mock.calls[0]
    expect(publicUrl).toBe(`${PUBLIC_LEDGER_URL}?watchdog=${now}`)
    expect(readOptions).toMatchObject({ cache: 'no-store', redirect: 'manual', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } })
    expect(readOptions.headers.Authorization).toBeUndefined()
    const [destination, pingOptions] = fetchImpl.mock.calls[1]
    expect(destination).toBe(pingUrl)
    expect(pingOptions).toMatchObject({ method: 'POST', redirect: 'manual' })
    expect(pingOptions.body).toBeUndefined()
  })

  it.each([
    ['stale', ledger(now - MAX_LEDGER_AGE_MS - 1), 'stale-ledger'],
    ['future', ledger(now + 6 * 60 * 1000), 'future-ledger'],
    ['local', { ...ledger(), publication: 'local-preview' }, 'invalid-ledger'],
    ['invalid', { ...ledger(), version: 0 }, 'invalid-ledger'],
  ])('never signals success for %s data', async (_name, data, reason) => {
    const fetchImpl = fetcher(data)
    expect(await checkPublishedLedger({ pingUrl, fetchImpl, now })).toEqual({ ok: false, reason })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not signal for a missing secret, bad clock, HTTP error, invalid JSON or fetch error', async () => {
    const noCalls = vi.fn()
    expect((await checkPublishedLedger({ pingUrl: '', fetchImpl: noCalls, now })).reason).toBe('invalid-ping-url')
    expect((await checkPublishedLedger({ pingUrl, fetchImpl: noCalls, now: NaN })).reason).toBe('invalid-clock')
    expect(noCalls).not.toHaveBeenCalled()
    for (const fetchImpl of [vi.fn(async () => reply({}, 503)), vi.fn(async () => { throw new Error('offline') })]) {
      expect((await checkPublishedLedger({ pingUrl, fetchImpl, now })).reason).toBe('ledger-unavailable')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
    const invalidJson = vi.fn(async () => ({ ok: true, json: async () => { throw new Error('bad JSON') } }))
    expect((await checkPublishedLedger({ pingUrl, fetchImpl: invalidJson, now })).reason).toBe('invalid-ledger')
    expect(invalidJson).toHaveBeenCalledTimes(1)
  })

  it('exports only a Cloudflare handler and fails safely when unconfigured', async () => {
    // Cloudflare interprets named module exports as Worker entrypoints, not
    // arbitrary constants; the testable helpers live in a separate module.
    expect(Object.keys(workerEntrypoint)).toEqual(['default'])
    await expect(workerEntrypoint.default.scheduled({}, {})).rejects.toThrow('invalid-ping-url')
    const brokenEnv = { get FRESHNESS_HEALTHCHECK_URL() { throw new Error(pingUrl) } }
    await expect(workerEntrypoint.default.scheduled({}, brokenEnv)).rejects.toThrow('Ledger watchdog: unexpected-error')
  })
})

describe('scheduled refresh heartbeat', () => {
  it.each(['push', 'workflow_dispatch', 'pull_request', ''])('does not send a success for %s', async (event) => {
    const fetchImpl = vi.fn()
    expect(await reportScheduledHeartbeat({ ...schedule, event, fetchImpl })).toEqual({ ok: false, reason: 'not-a-successful-scheduled-run' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['2', '', undefined])('does not send for a rerun or missing attempt (%s)', async (attempt) => {
    const fetchImpl = vi.fn()
    expect(await reportScheduledHeartbeat({ ...schedule, attempt, fetchImpl })).toEqual({ ok: false, reason: 'not-a-successful-scheduled-run' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['build', 'deploy', 'backup', 'notify'])('requires a successful %s', async (job) => {
    const fetchImpl = vi.fn()
    expect(await reportScheduledHeartbeat({ ...schedule, [job]: 'failure', fetchImpl })).toEqual({ ok: false, reason: 'not-a-successful-scheduled-run' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['skipped', 'cancelled', 'neutral', ''])('does not send if a required job is %s', async (result) => {
    const fetchImpl = vi.fn()
    expect(await reportScheduledHeartbeat({ ...schedule, notify: result, fetchImpl })).toEqual({ ok: false, reason: 'not-a-successful-scheduled-run' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('is opt-in and sends only after all required jobs succeed', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => 'OK' }))
    expect(await reportScheduledHeartbeat({ ...schedule, pingUrl: '', fetchImpl })).toEqual({ ok: true, reason: 'not-configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await reportScheduledHeartbeat({ ...schedule, fetchImpl })).toEqual({ ok: true, reason: 'sent' })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'manual' })
  })

  it('requires the same schedule and successful job dependencies in the GitHub workflow', () => {
    const workflow = parseYaml(readFileSync('.github/workflows/pages.yml', 'utf8'))
    expect(workflow.on.schedule[0].cron).toBe('17 6 * * *')
    const job = workflow.jobs.schedule_heartbeat
    expect(job.needs).toEqual(['build', 'deploy', 'backup', 'notify'])
    expect(job.if).toContain("github.event_name == 'schedule'")
    expect(job.if).toContain("github.run_attempt == '1'")
    for (const name of job.needs) expect(job.if).toContain(`needs.${name}.result == 'success'`)
    expect(job.permissions).toEqual({ contents: 'read' })
    const configured = job.steps.find((step) => step.id === 'heartbeat_config')
    expect(configured.env.SCHEDULE_HEALTHCHECK_URL).toBe('${{ secrets.SCHEDULE_HEALTHCHECK_URL }}')
    expect(configured.run).toContain('configured=false')
    const send = job.steps.find((step) => step.name === 'Send the scheduled success heartbeat')
    expect(send.if).toContain("steps.heartbeat_config.outputs.configured == 'true'")
    expect(send.run).toContain('scripts/report-scheduled-heartbeat.js')
  })

  it('the CLI refuses push, failed and invalid configurations without network access', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'schedule-heartbeat-'))
    const preload = join(dir, 'mock.mjs'), log = join(dir, 'calls.log')
    try {
      await writeFile(preload, `import { appendFileSync } from 'node:fs'\nglobalThis.fetch = async (url, options) => { appendFileSync(process.env.MOCK_LOG, JSON.stringify({ host: new URL(url).host, method: options.method }) + '\\n'); return { ok: true, text: async () => process.env.MOCK_BODY || 'OK' } }\n`)
      const cli = resolve('scripts/report-scheduled-heartbeat.js')
      const env = { ...process.env, NODE_OPTIONS: '', MOCK_LOG: log, GITHUB_EVENT_NAME: 'schedule', GITHUB_RUN_ATTEMPT: '1', BUILD_RESULT: 'success', DEPLOY_RESULT: 'success', BACKUP_RESULT: 'success', NOTIFY_RESULT: 'success', SCHEDULE_HEALTHCHECK_URL: pingUrl }
      const invoke = (overrides) => spawnSync(process.execPath, ['--import', preload, cli], { env: { ...env, ...overrides }, cwd: dir, encoding: 'utf8', timeout: 15_000 })
      expect(invoke({ GITHUB_EVENT_NAME: 'push' }).status).toBe(1)
      expect(invoke({ GITHUB_RUN_ATTEMPT: '2' }).status).toBe(1)
      expect(invoke({ BACKUP_RESULT: 'failure' }).status).toBe(1)
      expect(invoke({ SCHEDULE_HEALTHCHECK_URL: 'https://other.example/secret' }).status).toBe(1)
      const unset = invoke({ SCHEDULE_HEALTHCHECK_URL: '' })
      expect(unset.status).toBe(0)
      expect(unset.stdout).toContain('not configured')
      await expect(readFile(log, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      const success = invoke({})
      expect(success.status).toBe(0)
      expect(success.stdout).toContain('heartbeat sent')
      expect(success.stdout + success.stderr).not.toContain(pingUrl)
      expect(JSON.parse((await readFile(log, 'utf8')).trim())).toEqual({ host: 'hc-ping.com', method: 'POST' })
      const unconfirmed = invoke({ MOCK_BODY: 'OK (not found)' })
      expect(unconfirmed.status).toBe(1)
      expect(unconfirmed.stdout + unconfirmed.stderr).not.toContain(pingUrl)
      expect((await readFile(log, 'utf8')).trim().split('\n')).toHaveLength(3)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
