import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App.jsx'

describe('matchday dashboard', () => {
  it('filters by league, supports accent-insensitive search, and resets an empty result', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('article')
    expect(screen.getAllByRole('article')).toHaveLength(8)
    await user.click(screen.getByRole('button', { name: 'La Liga' }))
    expect(screen.getAllByRole('article')).toHaveLength(2)
    const search = screen.getByRole('searchbox', { name: 'Search teams or leagues' })
    await user.type(search, 'Atletico')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(within(screen.getByRole('article')).getByText('Atlético')).toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'no such club')
    expect(screen.getByText('NO MATCHES FOUND.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /view all matches/i }))
    expect(screen.getAllByRole('article')).toHaveLength(8)
    expect(search).toHaveValue('')
  })

  it('sorts by the strongest model lean', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('article')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort matches' }), 'confidence')
    expect(within(screen.getAllByRole('article')[0]).getByText('Bayern')).toBeInTheDocument()
  })

  it('saves matches locally, filters them, and handles removing the last one', async () => {
    const user = userEvent.setup()
    const view = render(<App />)
    await screen.findAllByRole('article')
    await user.click(screen.getByRole('button', { name: 'Save Arsenal vs Chelsea' }))
    expect(JSON.parse(window.localStorage.getItem('pitchside-saved-fixtures-v1'))).toEqual(['arsenal-chelsea'])
    view.unmount()
    render(<App />)
    await screen.findAllByRole('article')
    await user.click(screen.getByRole('button', { name: 'Saved 1 match' }))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByText('SAVED MATCHES')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove Arsenal vs Chelsea from saved matches' }))
    expect(screen.getByText('NO SAVED MATCHES HERE YET.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'All matches 8' }))
    expect(screen.getAllByRole('article')).toHaveLength(8)
  })

  it('opens a match breakdown, closes on Escape, and returns focus', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('article')
    const analysis = screen.getByRole('button', { name: 'View analysis for Arsenal vs Chelsea' })
    await user.click(analysis)
    const dialog = screen.getByRole('dialog', { name: 'THE MATCH BREAKDOWN' })
    expect(within(dialog).getAllByText('Arsenal').length).toBeGreaterThan(0)
    expect(within(dialog).getAllByText('Chelsea').length).toBeGreaterThan(0)
    expect(within(dialog).getByText(/Demo only/)).toBeInTheDocument()
    expect(document.querySelector('main')).toHaveAttribute('inert')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.querySelector('main')).not.toHaveAttribute('inert')
    expect(analysis).toHaveFocus()
  })

  it('shows tied top outcomes without claiming a winning side', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('article')
    await user.type(screen.getByRole('searchbox', { name: 'Search teams or leagues' }), 'Napoli')
    expect(within(screen.getByRole('article')).getByText('No clear lean')).toBeInTheDocument()
    expect(screen.getByText('A CLOSE CALL')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View analysis for AC Milan vs Napoli' }))
    expect(within(screen.getByRole('dialog')).getByText('NO CLEAR LEAN')).toBeInTheDocument()
  })

  it('ignores invalid and duplicate saved fixture IDs', async () => {
    window.localStorage.setItem('pitchside-saved-fixtures-v1', JSON.stringify(['unknown', 'arsenal-chelsea', 'arsenal-chelsea', 5]))
    render(<App />)
    await screen.findAllByRole('article')
    expect(screen.getByRole('button', { name: 'Saved 1 match' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Arsenal vs Chelsea from saved matches' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('explains the model and clearly identifies the sample data', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findAllByRole('article')
    await user.click(screen.getByRole('button', { name: 'DEMO MODE' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Poisson model/)).toBeInTheDocument()
    expect(within(dialog).getByText(/sample data, not a live feed/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /got it/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

function communityResponse(matches) {
  return {
    ok: true,
    json: async () => ({
      mode: 'community', fixtures: matches,
      source: { name: 'open-matchday', sourceUpdatedAt: '2026-10-29T05:08:17Z', stale: false, unavailableLeagues: [], availableLeagueCount: 4, historicalLeagueCount: 3 },
      backtest: { evaluated: 100, completed: 120, skipped: 20, accuracy: 0.5, baselineAccuracy: 0.43, brier: 0.61, logLoss: 1.02, firstDate: '2025-09-01', lastDate: '2026-10-28' },
    }),
  }
}

it('loads community fixtures, paginates them and explains the walk-forward backtest', async () => {
  const { fixtures } = await import('../src/data/fixtures.js')
  const matches = Array.from({ length: 9 }, (_, index) => ({ ...fixtures[index % fixtures.length], id: `community-test-${index}`, hasEnoughData: true }))
  vi.mocked(fetch).mockResolvedValue(communityResponse(matches))
  const user = userEvent.setup()
  render(<App />)
  expect(await screen.findByText('COMMUNITY DATA · NON-COMMERCIAL')).toBeInTheDocument()
  expect(screen.getAllByRole('article')).toHaveLength(8)
  expect(screen.getByText(/Across 100 past matches/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /show more matches/i }))
  expect(screen.getAllByRole('article')).toHaveLength(9)
  await user.click(screen.getByRole('button', { name: 'About the data' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText('WALK-FORWARD BACKTEST')).toBeInTheDocument()
  expect(within(dialog).getByText(/earlier dates in the same league and season/)).toBeInTheDocument()
  expect(within(dialog).getByText(/Previous-season results available for 3 of 4 current leagues/)).toBeInTheDocument()
  expect(within(dialog).getByText(/for non-commercial use/)).toBeInTheDocument()
})

it('labels insufficient real data instead of inventing a prediction', async () => {
  const { fixtures } = await import('../src/data/fixtures.js')
  const match = { ...fixtures[0], id: 'community-incomplete', hasEnoughData: false, home: { ...fixtures[0].home, sampleSize: 1, form: ['W'] }, away: { ...fixtures[0].away, sampleSize: 2, form: ['D', 'L'] } }
  vi.mocked(fetch).mockResolvedValue(communityResponse([match]))
  const user = userEvent.setup()
  render(<App />)
  expect(await screen.findByText('NOT AVAILABLE')).toBeInTheDocument()
  expect(screen.getByText(/At least three earlier league results/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'View analysis for Arsenal vs Chelsea' }))
  expect(within(screen.getByRole('dialog')).getByText(/Missing results are never replaced/)).toBeInTheDocument()
})

it('keeps a previously loaded community snapshot marked stale when retry fails', async () => {
  const { fixtures } = await import('../src/data/fixtures.js')
  const initial = communityResponse([{ ...fixtures[0], id: 'community-stale', hasEnoughData: true }])
  const data = await initial.json()
  data.source.stale = true
  data.source.refreshFailed = true
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => data }).mockRejectedValueOnce(new Error('offline'))
  const user = userEvent.setup()
  render(<App />)
  expect(await screen.findByText('DATA MAY BE STALE · NON-COMMERCIAL')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /retry feed/i }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.getByRole('button', { name: /retry feed/i })).not.toBeDisabled())
  expect(screen.getByText('DATA MAY BE STALE · NON-COMMERCIAL')).toBeInTheDocument()
  expect(screen.getAllByRole('article')).toHaveLength(1)
  expect(screen.queryByText(/Community data is unavailable/)).not.toBeInTheDocument()
})

it('clearly falls back to demo data and can retry the community feed', async () => {
  const { fixtures } = await import('../src/data/fixtures.js')
  const user = userEvent.setup()
  render(<App />)
  expect(await screen.findByText(/Community data is unavailable/)).toBeInTheDocument()
  vi.mocked(fetch).mockResolvedValueOnce(communityResponse([{ ...fixtures[0], id: 'community-retry', hasEnoughData: true }]))
  await user.click(screen.getByRole('button', { name: /try again/i }))
  expect(await screen.findByText('COMMUNITY DATA · NON-COMMERCIAL')).toBeInTheDocument()
  expect(screen.getAllByRole('article')).toHaveLength(1)
})
