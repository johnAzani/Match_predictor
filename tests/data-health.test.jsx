import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DataHealth from '../src/components/DataHealth.jsx'
import { historyHealth, loadWorkflowHealth, overdueHealth, repositoryLinks, sourceHealth } from '../src/lib/operationalHealth.js'

const now = Date.parse('2026-10-29T13:00:00Z')
const hour = 60 * 60 * 1000
const tracker = (overrides = {}) => ({ status: 'ready', loadFailed: false, data: { publication: 'github-pages', updatedAt: new Date(now - hour).toISOString(), sourceUpdatedAt: new Date(now - 2 * hour).toISOString(), sourceStale: false, records: [], ...overrides } })
const pending = (id, timestamp, name = 'Alpha') => {
  const local = new Date(timestamp + hour).toISOString()
  return { id, result: null, excludedReason: null, league: { name: 'Premier League' }, home: { shortName: name }, away: { shortName: 'Beta' }, latestKickoff: { date: local.slice(0, 10), time: local.slice(11, 16), timestamp } }
}
const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => data })
const latest = (status = 'completed', conclusion = 'success') => ({ workflow_runs: [{ id: 123, status, conclusion, run_started_at: '2026-10-29T12:00:00Z', html_url: 'https://untrusted.example/anything' }] })

describe('data health classification', () => {
  it('distinguishes fresh, stale, future, unavailable and local history', () => {
    expect(historyHealth(tracker(), now).state).toBe('ok')
    expect(historyHealth(tracker({ updatedAt: new Date(now - 37 * hour).toISOString() }), now).label).toBe('Update delayed')
    expect(historyHealth(tracker({ updatedAt: new Date(now + hour).toISOString() }), now).state).toBe('unknown')
    expect(historyHealth({ ...tracker(), loadFailed: true }, now).label).toBe('Connection issue')
    expect(historyHealth({ status: 'unavailable', data: null }, now).label).toBe('Unavailable')
    expect(historyHealth(tracker({ publication: 'local-preview' }), now).state).toBe('preview')
    expect(sourceHealth(tracker(), now).state).toBe('ok')
    expect(sourceHealth(tracker({ sourceUpdatedAt: null }), now).label).toBe('Time unknown')
    expect(sourceHealth(tracker({ sourceStale: true }), now).state).toBe('attention')
    expect(sourceHealth(tracker({ sourceUpdatedAt: new Date(now - 49 * hour).toISOString() }), now).state).toBe('attention')
  })

  it('reports overdue records without treating stale, unavailable or preview data as healthy', () => {
    const old = pending('community-old', now - 49 * hour)
    expect(overdueHealth({ status: 'loading', data: null }, now).state).toBe('loading')
    expect(overdueHealth({ status: 'unavailable', data: null }, now).state).toBe('unknown')
    expect(overdueHealth(tracker({ publication: 'local-preview', records: [old] }), now).state).toBe('preview')
    expect(overdueHealth(tracker({ records: [old] }), now)).toMatchObject({ state: 'attention', records: [old] })
    expect(overdueHealth(tracker({ sourceStale: true, records: [old] }), now).state).toBe('attention')
    expect(overdueHealth({ ...tracker({ records: [old] }), loadFailed: true }, now).state).toBe('attention')
    expect(overdueHealth(tracker(), now).state).toBe('ok')
    expect(overdueHealth(tracker({ sourceStale: true }), now).state).toBe('unknown')
    expect(overdueHealth(tracker({ sourceUpdatedAt: null }), now).state).toBe('unknown')
    expect(overdueHealth(tracker({ updatedAt: new Date(now - 37 * hour).toISOString() }), now).state).toBe('unknown')
    expect(overdueHealth({ ...tracker(), loadFailed: true }, now).state).toBe('unknown')
    expect(overdueHealth(tracker({ updatedAt: new Date(now + hour).toISOString(), records: [old] }), now).label).toBe('Time unknown')
    expect(overdueHealth(tracker({ sourceUpdatedAt: new Date(now + hour).toISOString(), records: [old] }), now).label).toBe('Time unknown')
    expect(overdueHealth(tracker({ records: [old] }), NaN).state).toBe('unknown')
    expect(overdueHealth(tracker({ records: null }), now).state).toBe('unknown')
  })

  it('reads workflow states without trusting a URL from the API or treating errors as success', async () => {
    const load = (data, status = 200) => loadWorkflowHealth('owner/repo', { fetchImpl: vi.fn(async () => response(data, status)) })
    expect((await load(latest())).label).toBe('Last run succeeded')
    expect((await load(latest('in_progress', null))).state).toBe('running')
    expect((await load(latest('completed', 'failure'))).state).toBe('attention')
    expect((await load(latest('completed', 'cancelled'))).state).toBe('attention')
    expect((await load(latest('completed', 'neutral'))).state).toBe('unknown')
    expect((await load({ workflow_runs: [] })).state).toBe('unknown')
    expect((await load(latest())).runUrl).toBe('https://github.com/owner/repo/actions/runs/123')
    await expect(load(latest(), 403)).rejects.toThrow('unavailable')
    await expect(load({ workflow_runs: [{ id: 'bad', status: 'completed' }] })).rejects.toThrow('Unexpected')
    expect(repositoryLinks('owner/repo/extra')).toBeNull()
    expect(repositoryLinks('../..')).toBeNull()
  })
})

describe('website health panel', () => {
  it('shows the latest run, public times, a download and links to the workflow and backups', async () => {
    const current = new Date().toISOString()
    vi.stubGlobal('fetch', vi.fn(async () => response(latest())))
    render(<DataHealth tracker={tracker({ updatedAt: current, sourceUpdatedAt: current })} repository="owner/repo" />)
    const panel = screen.getByRole('region', { name: 'REFRESH & BACKUPS' })
    expect(await within(panel).findByText('Last run succeeded')).toBeInTheDocument()
    expect(within(panel).getAllByText('Recently updated')).toHaveLength(2)
    expect(within(panel).getByRole('link', { name: 'View workflow' })).toHaveAttribute('href', 'https://github.com/owner/repo/actions/runs/123')
    expect(within(panel).getByRole('link', { name: 'GitHub backups' })).toHaveAttribute('href', 'https://github.com/owner/repo/releases/tag/forecast-ledger-backups')
    expect(within(panel).getByRole('link', { name: 'Download history' })).toHaveAttribute('href', '/data/track-record.json')
    expect(within(panel).getByRole('link', { name: 'Overdue alerts' })).toHaveAttribute('href', expect.stringContaining('Overdue+forecast+results+need+attention'))
    expect(within(panel).getByText('None flagged')).toBeInTheDocument()
    expect(within(panel).getByText(/not an independent off-site copy/)).toBeInTheDocument()
  })

  it('expands a safe, complete list of overdue fixtures and their approximate latest kick-offs', async () => {
    const current = '2026-11-02T18:30:00.000Z'
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(current))
    const user = userEvent.setup()
    const timestamp = Date.parse('2026-10-26T17:30:00Z')
    const records = [pending('community-b', timestamp, 'Team <script>'), pending('community-a', timestamp, 'Arsenal')]
    const view = render(<DataHealth tracker={tracker({ updatedAt: current, sourceUpdatedAt: current, records })} repository={null} />)
    try {
      expect(screen.getByText('2 need review')).toBeInTheDocument()
      const details = document.querySelector('.data-overdue')
      expect(details).not.toHaveAttribute('open')
      await user.click(within(details).getByText('View 2 results needing review'))
      expect(details).toHaveAttribute('open')
      const items = within(details).getAllByRole('listitem')
      expect(items).toHaveLength(2)
      expect(items[0]).toHaveTextContent('Arsenal vs Beta')
      expect(items[1]).toHaveTextContent('Team <script> vs Beta')
      expect(details.querySelector('script')).toBeNull()
      expect(within(details).getAllByText(/26 Oct 2026 · 18:30 approx. UTC\+1/)).toHaveLength(2)
      expect(within(details).getByText(/does not confirm a postponement/)).toBeInTheDocument()
      expect(within(details).getByRole('link', { name: 'Browse the full record' })).toHaveAttribute('href', '#forecast-history')
    } finally { view.unmount(); clock.mockRestore() }
  })

  it('rechecks the 48-hour threshold as the existing minute timer advances', () => {
    vi.useFakeTimers()
    const timestamp = Date.parse('2026-10-30T17:30:00Z')
    vi.setSystemTime(new Date('2026-11-01T17:29:30Z'))
    const current = new Date().toISOString()
    const view = render(<DataHealth tracker={tracker({ updatedAt: current, sourceUpdatedAt: current, records: [pending('community-one', timestamp)] })} repository={null} />)
    try {
      expect(screen.getByText('None flagged')).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(60_000))
      expect(screen.getByText('1 needs review')).toBeInTheDocument()
    } finally { view.unmount(); vi.useRealTimers() }
  })

  it('shows a failed run and recovers from rate-limited status checks on retry', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({}, 403)).mockResolvedValueOnce(response(latest('completed', 'failure'))))
    render(<DataHealth tracker={tracker()} repository="owner/repo" />)
    expect(await screen.findByText('Status unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry status' }))
    expect(await screen.findByText('Run needs attention')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View workflow' })).toHaveAttribute('href', 'https://github.com/owner/repo/actions/runs/123')
  })

  it('waits for the ledger before an external check, and still checks when history is unavailable', async () => {
    const fetchMock = vi.fn(async () => response(latest()))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<DataHealth tracker={{ status: 'loading', data: null }} repository="owner/repo" />)
    expect(await screen.findByText('Waiting for the history to load.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    view.rerender(<DataHealth tracker={tracker({ publication: 'local-preview' })} repository="owner/repo" />)
    expect(await screen.findAllByText('Local preview')).toHaveLength(4)
    expect(fetchMock).not.toHaveBeenCalled()
    view.rerender(<DataHealth tracker={{ status: 'unavailable', data: null }} repository="owner/repo" />)
    expect(await screen.findByText('Last run succeeded')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not check or claim published workflow health for a local preview', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<DataHealth tracker={tracker({ publication: 'local-preview' })} repository="owner/repo" />)
    expect(await screen.findAllByText('Local preview')).toHaveLength(4)
    expect(screen.getByText(/does not run the public refresh/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download preview' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'GitHub backups' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
