import { describe, expect, it, vi } from 'vitest'
import { ALERT_MARKER, ALERT_TITLE, refreshProblems, reportRefreshHealth } from '../scripts/lib/refresh-alerts.js'
import { assessSnapshot } from '../scripts/lib/snapshot-health.js'
import { createTracker } from '../src/lib/tracker.js'

const run = { repository: 'owner/repository', runId: '123', attempt: '1', build: 'success', deploy: 'success', backup: 'success', sourceHealth: 'ok' }
const botIssue = { number: 7, title: ALERT_TITLE, body: ALERT_MARKER, user: { login: 'github-actions[bot]' } }
function fakeApi(issues = []) {
  return { list: vi.fn(async () => issues), request: vi.fn(async (path, options) => path === '/issues' && options.method === 'POST' ? { number: 8 } : {}) }
}

describe('snapshot source health', () => {
  const now = Date.parse('2026-10-29T13:00:00Z')
  const make = () => ({
    ledger: { ...createTracker(new Date(now), 'github-pages'), sourceUpdatedAt: new Date(now - 1000).toISOString(), sourceStale: false },
    feed: { mode: 'community', fixtures: [], source: { sourceUpdatedAt: new Date(now - 1000).toISOString(), stale: false, unavailableLeagues: [] } },
  })
  it('recognises healthy, stale, missing and partial source data', () => {
    const { ledger, feed } = make()
    expect(assessSnapshot(ledger, feed, now)).toEqual({ healthy: true, codes: [] })
    expect(assessSnapshot({ ...ledger, sourceStale: true }, feed, now).codes).toContain('source-stale')
    expect(assessSnapshot(ledger, { ...feed, source: { ...feed.source, unavailableLeagues: ['Serie A'] } }, now).codes).toContain('leagues-unavailable')
    expect(assessSnapshot(ledger, { ...feed, source: { ...feed.source, sourceUpdatedAt: null } }, now).codes).toEqual(['source-stale', 'source-mismatch'])
    expect(assessSnapshot(ledger, { ...feed, source: { ...feed.source, sourceUpdatedAt: '2026-10-25T00:00:00Z' } }, now).codes).toContain('source-stale')
    expect(() => assessSnapshot({ ...ledger, publication: 'local-preview' }, feed, now)).toThrow('invalid published')
  })
})

describe('refresh and backup alerts', () => {
  it('opens one issue when a build fails and explains the protected history', async () => {
    const api = fakeApi()
    const result = await reportRefreshHealth({ ...run, api, build: 'failure', deploy: 'skipped', backup: 'skipped', sourceHealth: '' })
    expect(result).toMatchObject({ status: 'created', issue: 8 })
    const [path, options] = api.request.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(path).toBe('/issues')
    expect(body.title).toBe(ALERT_TITLE)
    expect(body.body).toContain(ALERT_MARKER)
    expect(body.body).toContain('actions/runs/123/attempts/1')
    expect(body.body).toContain('Do not reset or reconstruct')
  })

  it('updates the existing bot-owned alert for backup or source problems', async () => {
    const api = fakeApi([botIssue])
    const result = await reportRefreshHealth({ ...run, api, backup: 'failure', sourceHealth: 'source-stale,leagues-unavailable' })
    expect(result).toMatchObject({ status: 'updated', issue: 7 })
    const [path, options] = api.request.mock.calls[0]
    expect(path).toBe('/issues/7/comments')
    const text = JSON.parse(options.body).body
    expect(text).toMatch(/backup did not complete/)
    expect(text).toMatch(/source is stale/)
    expect(text).toMatch(/leagues are unavailable/)
    expect(refreshProblems({ ...run, sourceHealth: '' })).toEqual(['The community snapshot health could not be confirmed.'])
  })

  it('closes only the managed bot issue after all jobs and source checks recover', async () => {
    const api = fakeApi([botIssue])
    const result = await reportRefreshHealth({ ...run, api })
    expect(result).toMatchObject({ status: 'closed', issue: 7, problems: [] })
    expect(api.request.mock.calls.map(([path, options]) => [path, options.method])).toEqual([['/issues/7/comments', 'POST'], ['/issues/7', 'PATCH']])
    expect(JSON.parse(api.request.mock.calls[1][1].body)).toEqual({ state: 'closed' })
  })

  it('does not alter a similarly named user issue and refuses duplicate bot alerts', async () => {
    const userIssue = { ...botIssue, user: { login: 'human' } }
    const api = fakeApi([userIssue])
    expect(await reportRefreshHealth({ ...run, api })).toMatchObject({ status: 'healthy' })
    expect(api.request).not.toHaveBeenCalled()
    await expect(reportRefreshHealth({ ...run, api: fakeApi([botIssue, { ...botIssue, number: 9 }]) })).rejects.toThrow('Multiple automated')
    await expect(reportRefreshHealth({ ...run, repository: 'owner/../../elsewhere', api })).rejects.toThrow('identity')
  })
})
