import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
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
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/matchday')).toHaveLength(2))
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

it('shows the pending public track record and the exact locked forecast on the match card and in analysis', async () => {
  const { fixtures } = await import('../src/data/fixtures.js')
  const { updateTracker } = await import('../server/tracker.js')
  const { competitions, matchId } = await import('../server/football.js')
  const season = '2026-27'
  const now = new Date('2026-10-29T12:00:00Z')
  const match = { ...fixtures[0], id: matchId(season, competitions[0].id, 'Arsenal', 'Chelsea'), date: '2026-10-30', time: '18:30', kickoffTimestamp: Date.parse('2026-10-30T17:30:00Z'), hasEnoughData: true, home: { ...fixtures[0].home, sampleSize: 5 }, away: { ...fixtures[0].away, sampleSize: 5 } }
  const baseFeed = await communityResponse([match]).json()
  baseFeed.source.season = season
  const ledger = updateTracker(null, { feed: baseFeed, datasets: [{ league: competitions[0], season, results: [] }] }, now, 'github-pages')
  expect(ledger.records).toHaveLength(1)
  const changedMatch = { ...match, home: { ...match.home, goalsFor: 0.3, form: ['L'] }, away: { ...match.away, goalsFor: 3.5, form: ['W'] } }
  const { predictMatch } = await import('../src/lib/predictions.js')
  expect(predictMatch(changedMatch).lean.key).not.toBe(ledger.records[0].prediction.pick)
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (url === '/api/matchday') return communityResponse([changedMatch])
    if (String(url).includes('/data/track-record.json')) return { ok: true, json: async () => ledger }
    throw new Error('Unexpected request')
  })
  const user = userEvent.setup()
  render(<App />)
  expect(await screen.findByText(/RECORDED FOR TRACKING/)).toBeInTheDocument()
  const card = screen.getByRole('article')
  expect(within(card).getByText(`Model leans ${ledger.records[0].prediction.pick === 'home' ? 'Arsenal' : 'Chelsea'} win`)).toBeInTheDocument()
  const section = screen.getByRole('region', { name: 'THE TRACK RECORD' })
  expect(within(section).getByText('1 PENDING')).toBeInTheDocument()
  expect(within(section).getByText('No matches scored yet')).toBeInTheDocument()
  const history = within(section).getByRole('region', { name: 'THE FULL RECORD' })
  expect(within(section).getAllByRole('link', { name: 'Browse the full record' })[0]).toHaveAttribute('href', '#forecast-history')
  const archived = within(history).getByRole('button', { name: /Arsenal vs Chelsea/ })
  await user.click(archived)
  expect(within(document.getElementById(archived.getAttribute('aria-controls'))).getByText('Awaiting a later publication check')).toBeInTheDocument()
  await user.click(within(card).getByRole('button', { name: 'View analysis for Arsenal vs Chelsea' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText(/forecast and its inputs were recorded for tracking/)).toBeInTheDocument()
  const formWords = { W: 'win', D: 'draw', L: 'loss' }
  expect(within(dialog).getByRole('img', { name: `Arsenal form, oldest to newest: ${match.home.form.map((result) => formWords[result]).join(', ')}` })).toBeInTheDocument()
})

it('shows actual results, monthly accuracy and the league breakdown without inventing history', async () => {
  const { fixtures } = await import('../src/data/fixtures.js')
  const { updateTracker } = await import('../server/tracker.js')
  const { competitions, matchId } = await import('../server/football.js')
  const season = '2026-27'
  const now = new Date('2026-10-29T12:00:00Z')
  const match = { ...fixtures[0], id: matchId(season, competitions[0].id, 'Arsenal', 'Chelsea'), date: '2026-10-30', time: '18:30', kickoffTimestamp: Date.parse('2026-10-30T17:30:00Z'), hasEnoughData: true, home: { ...fixtures[0].home, sampleSize: 5 }, away: { ...fixtures[0].away, sampleSize: 5 } }
  const baseFeed = await communityResponse([match]).json()
  baseFeed.source.season = season
  const pending = updateTracker(null, { feed: baseFeed, datasets: [{ league: competitions[0], season, results: [] }] }, now, 'github-pages')
  const verificationTime = new Date('2026-10-30T06:17:00Z')
  const verified = updateTracker(pending, { feed: { ...baseFeed, source: { ...baseFeed.source, sourceUpdatedAt: verificationTime.toISOString() } }, datasets: [{ league: competitions[0], season, results: [] }] }, verificationTime, 'github-pages')
  const result = { date: '2026-10-30', home: 'Arsenal', away: 'Chelsea', homeGoals: 2, awayGoals: 0 }
  const later = new Date('2026-10-31T10:00:00Z')
  const done = updateTracker(verified, { feed: { ...baseFeed, fixtures: [], source: { ...baseFeed.source, sourceUpdatedAt: later.toISOString() } }, datasets: [{ league: competitions[0], season, results: [result] }] }, later, 'github-pages')
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (url === '/api/matchday') return communityResponse([])
    if (String(url).includes('/data/track-record.json')) return { ok: true, json: async () => done }
    throw new Error('Unexpected request')
  })
  render(<App />)
  const section = await screen.findByRole('region', { name: 'THE TRACK RECORD' })
  expect(await within(section).findByText('1 correct out of 1 scored')).toBeInTheDocument()
  expect(within(section).getByText('Oct 2026')).toBeInTheDocument()
  expect(within(section).getByText('1 / 1 correct')).toBeInTheDocument()
  const recent = within(section).getByRole('heading', { name: 'RECENT RESULTS' }).closest('.track-panel')
  expect(within(recent).getByText('2 : 0')).toBeInTheDocument()
  expect(within(recent).getByText('CORRECT')).toBeInTheDocument()
  const history = within(section).getByRole('region', { name: 'THE FULL RECORD' })
  expect(within(history).getByText('2 : 0')).toBeInTheDocument()
  expect(within(within(history).getByRole('list')).getByText('Correct')).toBeInTheDocument()
})

it('does not label a live estimate as tracked while the ledger is loading, and updates an open dialog once it arrives', async () => {
  const { fixtures } = await import('../src/data/fixtures.js')
  const { updateTracker } = await import('../server/tracker.js')
  const { competitions, matchId } = await import('../server/football.js')
  const season = '2026-27'
  const now = new Date('2026-10-29T12:00:00Z')
  const match = { ...fixtures[0], id: matchId(season, competitions[0].id, 'Arsenal', 'Chelsea'), date: '2026-10-30', time: '18:30', kickoffTimestamp: Date.parse('2026-10-30T17:30:00Z'), hasEnoughData: true, home: { ...fixtures[0].home, sampleSize: 5 }, away: { ...fixtures[0].away, sampleSize: 5 } }
  const baseFeed = await communityResponse([match]).json()
  baseFeed.source.season = season
  const ledger = updateTracker(null, { feed: baseFeed, datasets: [{ league: competitions[0], season, results: [] }] }, now, 'github-pages')
  const changed = { ...match, home: { ...match.home, goalsFor: 0.3, form: ['L'] }, away: { ...match.away, goalsFor: 3.5, form: ['W'] } }
  let deliver
  const deferred = new Promise((resolve) => { deliver = resolve })
  vi.mocked(fetch).mockImplementation(async (url) => url === '/api/matchday' ? communityResponse([changed]) : deferred)
  const user = userEvent.setup()
  render(<App />)
  expect(await screen.findByText('CHECKING TRACKING STATUS')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'View analysis for Arsenal vs Chelsea' }))
  expect(within(screen.getByRole('dialog')).getByText(/Tracking status is loading/)).toBeInTheDocument()
  await act(async () => deliver({ ok: true, json: async () => ledger }))
  expect(within(screen.getByRole('dialog')).getByText(/forecast and its inputs were recorded for tracking/)).toBeInTheDocument()
  expect(within(screen.getByRole('dialog')).getByText(/MODEL LEANS ARSENAL WIN/)).toBeInTheDocument()
})

it('reports an unavailable tracker and can retry without affecting the match feed', async () => {
  const { fixtures } = await import('../src/data/fixtures.js')
  const { createTracker } = await import('../src/lib/tracker.js')
  let trackerAvailable = false
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (url === '/api/matchday') return communityResponse([fixtures[0]])
    return trackerAvailable ? { ok: true, json: async () => createTracker(new Date(), 'github-pages') } : { ok: false, status: 503 }
  })
  const user = userEvent.setup()
  render(<App />)
  expect(await screen.findByText('TRACKING STATUS UNAVAILABLE')).toBeInTheDocument()
  expect(screen.getByText('THE TRACK RECORD ISN’T AVAILABLE YET.')).toBeInTheDocument()
  trackerAvailable = true
  await user.click(screen.getByRole('button', { name: 'Retry loading track record' }))
  expect(await screen.findByText('CURRENT ESTIMATE · NOT IN ACTIVE TRACKING')).toBeInTheDocument()
  expect(screen.getByText('No matches scored yet')).toBeInTheDocument()
  expect(screen.getByRole('article')).toBeInTheDocument()
})
