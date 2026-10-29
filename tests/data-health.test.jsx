import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DataHealth from '../src/components/DataHealth.jsx'
import { historyHealth, loadWorkflowHealth, repositoryLinks, sourceHealth } from '../src/lib/operationalHealth.js'

const now = Date.parse('2026-10-29T13:00:00Z')
const hour = 60 * 60 * 1000
const tracker = (overrides = {}) => ({ status: 'ready', loadFailed: false, data: { publication: 'github-pages', updatedAt: new Date(now - hour).toISOString(), sourceUpdatedAt: new Date(now - 2 * hour).toISOString(), sourceStale: false, ...overrides } })
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
    expect(within(panel).getByText(/not an independent off-site copy/)).toBeInTheDocument()
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
    expect(await screen.findAllByText('Local preview')).toHaveLength(3)
    expect(fetchMock).not.toHaveBeenCalled()
    view.rerender(<DataHealth tracker={{ status: 'unavailable', data: null }} repository="owner/repo" />)
    expect(await screen.findByText('Last run succeeded')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not check or claim published workflow health for a local preview', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<DataHealth tracker={tracker({ publication: 'local-preview' })} repository="owner/repo" />)
    expect(await screen.findAllByText('Local preview')).toHaveLength(3)
    expect(screen.getByText(/does not run the public refresh/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download preview' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'GitHub backups' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
