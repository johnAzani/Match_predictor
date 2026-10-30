import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createTracker, isValidTracker } from '../src/lib/tracker.js'
import { findOverdueResults, OVERDUE_MS } from '../src/lib/overdueResults.js'
import { OVERDUE_ALERT_MARKER, OVERDUE_ALERT_TITLE, overdueFingerprint, reportOverdueResults } from '../scripts/lib/overdue-alerts.js'

const now = Date.parse('2026-11-02T18:30:00Z')
const kickoff = (date, time = '18:30') => ({ date, time, timestamp: Date.parse(`${date}T${time}:00+01:00`) })
const team = (name) => ({ name, shortName: name, crest: null, goalsFor: 1.5, goalsAgainst: 1, sampleSize: 5, form: ['W', 'D', 'L', 'W', 'W'] })
const record = (id = 'community-1') => ({
  id, season: '2026-27', league: { id: 'premier-league', name: 'Premier League', country: 'england' },
  home: team('Alpha\n# UNTRUSTED'), away: team('Beta'), originalKickoff: kickoff('2026-10-30'), latestKickoff: kickoff('2026-10-30'),
  recordedAt: '2026-10-29T12:00:00.000Z', verifiedAt: '2026-10-29T14:00:00.000Z', modelVersion: 'poisson-v1', excludedReason: null, result: null,
  prediction: { pick: 'home', probabilities: { home: 50, draw: 25, away: 25 }, probabilitiesExact: { home: 0.5, draw: 0.25, away: 0.25 }, likelyScore: { home: 1, away: 1 }, expectedGoals: { home: 1.5, away: 1 } },
})
const ledger = (records = [record()]) => ({
  ...createTracker(new Date('2026-10-29T11:00:00.000Z'), 'github-pages'),
  updatedAt: '2026-11-02T17:00:00.000Z', sourceUpdatedAt: '2026-11-02T16:00:00.000Z', sourceStale: false, records,
})
const botIssue = (body = OVERDUE_ALERT_MARKER) => ({ number: 7, title: OVERDUE_ALERT_TITLE, body, user: { login: 'github-actions[bot]' } })
function fakeApi(issues = []) {
  return { list: vi.fn(async () => issues), request: vi.fn(async (path, options) => path === '/issues' && options.method === 'POST' ? { number: 8 } : {}) }
}
const report = (api, overrides = {}) => reportOverdueResults({ api, repository: 'owner/repo', runId: '123', attempt: '1', ledger: ledger(), confirmedBackup: true, now, ...overrides })

describe('shared overdue classification', () => {
  it('uses the exact 48-hour boundary and never modifies records', () => {
    const pending = record(), before = structuredClone(pending)
    expect(findOverdueResults([pending], pending.latestKickoff.timestamp + OVERDUE_MS - 1)).toEqual([])
    expect(findOverdueResults([pending], pending.latestKickoff.timestamp + OVERDUE_MS)).toEqual([pending])
    expect(pending).toEqual(before)
  })

  it('uses the latest kick-off, excludes scored or excluded records and sorts oldest first', () => {
    const older = record('community-older')
    const rescheduled = { ...record('community-later'), latestKickoff: kickoff('2026-11-04') }
    const scored = { ...record('community-scored'), result: { homeGoals: 1, awayGoals: 0 } }
    const excluded = { ...record('community-excluded'), excludedReason: 'unverified-publication' }
    const other = { ...record('community-other'), latestKickoff: kickoff('2026-10-31') }
    const items = [other, excluded, scored, rescheduled, older]
    expect(findOverdueResults(items, now).map((item) => item.id)).toEqual(['community-older', 'community-other'])
    expect(items[0]).toBe(other)
  })

  it('rejects a missing ledger or unusable clock', () => {
    expect(() => findOverdueResults(null, now)).toThrow('ledger and clock')
    expect(() => findOverdueResults([], NaN)).toThrow('ledger and clock')
    expect(() => findOverdueResults([], Infinity)).toThrow('ledger and clock')
  })
})

describe('overdue monitor workflow entry point', () => {
  it('reads the confirmed artifact and refuses an unconfirmed or malformed ledger without contacting GitHub', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'overdue-monitor-'))
    const preload = join(dir, 'mock-github.mjs'), log = join(dir, 'requests.log')
    try {
      await mkdir(join(dir, 'overdue-build'))
      await writeFile(join(dir, 'overdue-build', 'track-record.json'), JSON.stringify(ledger()))
      await writeFile(preload, `import { appendFileSync, readFileSync } from 'node:fs'\nDate.now = () => ${now}\nconst realTimeout = globalThis.setTimeout\nglobalThis.setTimeout = (fn, delay, ...args) => realTimeout(fn, 0, ...args)\nglobalThis.fetch = async (url, options) => {\n  const call = { url: String(url), method: options.method || 'GET', body: options.body }\n  appendFileSync(process.env.MOCK_LOG, JSON.stringify(call) + '\\n')\n  if (String(url).startsWith('https://owner.github.io/')) {\n    if (options.headers.Authorization) throw new Error('Token sent to Pages')\n    return new Response(process.env.MOCK_PUBLIC_STATE === 'mismatch' ? '{}' : readFileSync('overdue-build/track-record.json'))\n  }\n  if (options.method === 'GET') return Response.json([])\n  if (options.method === 'POST' && String(url).endsWith('/issues')) return Response.json({ number: 42 })\n  throw new Error('Unexpected GitHub call')\n}\n`)
      const cli = resolve('scripts/report-overdue-results.js')
      const env = { ...process.env, NODE_OPTIONS: '', GITHUB_TOKEN: 'test-only', GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', PAGES_BASE_URL: 'https://owner.github.io/repo/', MOCK_LOG: log }
      const invoke = (backup, publicState = 'match') => spawnSync(process.execPath, ['--import', preload, cli], { cwd: dir, env: { ...env, BACKUP_RESULT: backup, MOCK_PUBLIC_STATE: publicState }, encoding: 'utf8', timeout: 15_000 })
      const denied = invoke('failure')
      expect(denied.status).toBe(1)
      expect(denied.stderr).toContain('not confirmed')
      await expect(readFile(log, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      const success = invoke('success')
      expect(success.status).toBe(0)
      expect(success.stdout).toContain('created GitHub issue #42')
      const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse)
      expect(calls.map((call) => call.method)).toEqual(['GET', 'GET', 'POST'])
      expect(calls[0].url).toContain('https://owner.github.io/repo/data/track-record.json?backup=123-1')
      expect(calls[2].url).toBe('https://api.github.com/repos/owner/repo/issues')
      expect(calls[2].body).not.toContain('UNTRUSTED')
      await rm(log)
      const outdated = invoke('success', 'mismatch')
      expect(outdated.status).toBe(1)
      expect(outdated.stderr).toContain('Cannot confirm the public ledger')
      const rechecks = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse)
      expect(rechecks).toHaveLength(12)
      expect(rechecks.every((call) => call.url.startsWith('https://owner.github.io/'))).toBe(true)
      await rm(log)
      await writeFile(join(dir, 'overdue-build', 'track-record.json'), '{')
      const corrupt = invoke('success')
      expect(corrupt.status).toBe(1)
      expect(corrupt.stderr).toContain('not valid JSON')
      await expect(readFile(log, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})

describe('separate overdue issue monitor', () => {
  it('opens a bot issue with counts, approximate time and safe links, without copying team names or mutating the ledger', async () => {
    const data = ledger(), before = structuredClone(data), api = fakeApi()
    expect(isValidTracker(data)).toBe(true)
    expect(await report(api, { ledger: data })).toEqual({ status: 'created', issue: 8, count: 1 })
    const [path, options] = api.request.mock.calls[0]
    expect(path).toBe('/issues')
    const issue = JSON.parse(options.body)
    expect(issue.title).toBe(OVERDUE_ALERT_TITLE)
    expect(issue.body).toContain(OVERDUE_ALERT_MARKER)
    expect(issue.body).toContain('1 pending forecast is at least 48 hours')
    expect(issue.body).toContain('2026-10-30T17:30:00.000Z')
    expect(issue.body).toContain('https://owner.github.io/repo/#track-record')
    expect(issue.body).toContain('https://github.com/owner/repo/actions/runs/123/attempts/1')
    expect(issue.body).not.toContain('UNTRUSTED')
    expect(issue.body).not.toContain('Beta')
    expect(data).toEqual(before)
  })

  it('links a GitHub user site to its root rather than adding a repository path', async () => {
    const api = fakeApi()
    await report(api, { repository: 'owner/owner.github.io' })
    expect(JSON.parse(api.request.mock.calls[0][1].body).body).toContain('https://owner.github.io/#track-record')
  })

  it('does not notify again for the same set, including when only the order changes', async () => {
    const first = record('community-a'), second = record('community-b')
    const fingerprint = overdueFingerprint([second, first])
    expect(fingerprint).toBe(overdueFingerprint([first, second]))
    const api = fakeApi([botIssue(`${OVERDUE_ALERT_MARKER}\n<!-- pitchside-overdue-set:${fingerprint} -->`)])
    expect(await report(api, { ledger: ledger([first, second]) })).toEqual({ status: 'unchanged', issue: 7, count: 2 })
    expect(api.request).not.toHaveBeenCalled()
  })

  it('notifies once when the set or a last known kick-off changes', async () => {
    const first = record(), changed = { ...first, latestKickoff: kickoff('2026-10-31') }
    const old = overdueFingerprint([first])
    expect(overdueFingerprint([changed])).not.toBe(old)
    const api = fakeApi([botIssue(`${OVERDUE_ALERT_MARKER}\n<!-- pitchside-overdue-set:${old} -->`)])
    expect(await report(api, { ledger: ledger([changed]) })).toMatchObject({ status: 'updated', issue: 7 })
    expect(api.request.mock.calls.map(([path, options]) => [path, options.method])).toEqual([['/issues/7/comments', 'POST'], ['/issues/7', 'PATCH']])
    expect(JSON.parse(api.request.mock.calls[0][1].body).body).toContain('set of overdue forecasts changed')
    expect(JSON.parse(api.request.mock.calls[1][1].body).body).toContain(overdueFingerprint([changed]))
  })

  it.each(['scored', 'rescheduled', 'excluded'])('closes only after a confirmed ledger has none because a record is %s', async (change) => {
    const pending = record()
    if (change === 'scored') pending.result = { date: '2026-10-30', homeGoals: 1, awayGoals: 0, observedAt: '2026-10-31T10:00:00.000Z' }
    if (change === 'rescheduled') pending.latestKickoff = kickoff('2026-11-04')
    if (change === 'excluded') pending.excludedReason = 'result-unavailable'
    const api = fakeApi([botIssue()])
    expect(await report(api, { ledger: ledger([pending]) })).toEqual({ status: 'closed', issue: 7, count: 0 })
    expect(api.request.mock.calls.map(([path, options]) => [path, options.method])).toEqual([['/issues/7/comments', 'POST'], ['/issues/7', 'PATCH']])
    expect(JSON.parse(api.request.mock.calls[0][1].body).body).toMatch(/may have been rescheduled or excluded/)
    expect(JSON.parse(api.request.mock.calls[1][1].body)).toEqual({ state: 'closed' })
  })

  it('does nothing when no alert is open and no records are overdue', async () => {
    const api = fakeApi()
    expect(await report(api, { ledger: ledger([]) })).toEqual({ status: 'healthy', issue: null, count: 0 })
    expect(api.request).not.toHaveBeenCalled()
  })

  it('ignores human issues and pull requests but rejects duplicate or malformed bot issues', async () => {
    const api = fakeApi([{ ...botIssue(), user: { login: 'human' } }, { ...botIssue(), pull_request: {} }])
    expect(await report(api, { ledger: ledger([]) })).toMatchObject({ status: 'healthy' })
    expect(api.request).not.toHaveBeenCalled()
    await expect(report(fakeApi([botIssue(), { ...botIssue(), number: 9 }]))).rejects.toThrow('Multiple automated')
    await expect(report(fakeApi([{ ...botIssue(), number: '7' }]))).rejects.toThrow('Invalid overdue issue number')
  })

  it('never touches GitHub for an unconfirmed backup, invalid ledger, clock or workflow identity', async () => {
    const api = fakeApi([botIssue()])
    await expect(report(api, { confirmedBackup: false })).rejects.toThrow('not confirmed')
    await expect(report(api, { ledger: { ...ledger(), publication: 'local-preview' } })).rejects.toThrow('invalid published ledger')
    await expect(report(api, { ledger: { ...ledger(), records: [record(), record()] } })).rejects.toThrow('invalid published ledger')
    await expect(report(api, { now: NaN })).rejects.toThrow('invalid clock')
    await expect(report(api, { now: Date.parse('2026-11-02T15:00:00Z') })).rejects.toThrow('invalid clock')
    await expect(report(api, { now: Date.parse('2026-11-04T06:00:00Z') })).rejects.toThrow('stale published ledger')
    await expect(report(api, { repository: 'owner/../../wrong' })).rejects.toThrow('identity')
    await expect(report(api, { runId: '123/evil' })).rejects.toThrow('identity')
    expect(api.list).not.toHaveBeenCalled()
    expect(api.request).not.toHaveBeenCalled()
  })

  it('does not mark an update complete if the notification fails', async () => {
    const api = fakeApi([botIssue()])
    api.request.mockRejectedValueOnce(new Error('GitHub unavailable'))
    await expect(report(api)).rejects.toThrow('GitHub unavailable')
    expect(api.request).toHaveBeenCalledTimes(1)
    expect(api.request.mock.calls[0][0]).toBe('/issues/7/comments')
  })
})
