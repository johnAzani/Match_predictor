import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ForecastHistory from '../src/components/ForecastHistory.jsx'
import { DEFAULT_HISTORY_FILTERS, EXCLUSION_EXPLANATIONS, filterHistory, historyMatchDate, historyPickName, historyStatus } from '../src/lib/forecastHistory.js'

const team = (name) => ({ name, shortName: name, crest: null, goalsFor: 1.5, goalsAgainst: 1.2, sampleSize: 5, form: ['W', 'D', 'L', 'W', 'W'] })
const leagues = {
  premier: { id: 'premier-league', name: 'Premier League', country: 'england' },
  laLiga: { id: 'la-liga', name: 'La Liga', country: 'spain' },
  bundesliga: { id: 'bundesliga', name: 'Bundesliga', country: 'germany' },
}
function record({ id, home = 'Arsenal', away = 'Chelsea', league = leagues.premier, date = '2026-10-30', pick = 'home', result = null, verifiedAt = null, excludedReason = null, latestDate = date } = {}) {
  return {
    id: `community-${id}`, season: '2026-27', league, home: team(home), away: team(away),
    originalKickoff: { date, time: '18:30', timestamp: Date.parse(`${date}T17:30:00Z`) },
    latestKickoff: { date: latestDate, time: '18:30', timestamp: Date.parse(`${latestDate}T17:30:00Z`) },
    recordedAt: '2026-10-28T14:00:00.000Z', verifiedAt, modelVersion: 'poisson-v1',
    prediction: { pick, probabilities: { home: 50, draw: 25, away: 25 }, likelyScore: { home: 1, away: 1 }, expectedGoals: { home: 1.6, away: 1.2 } },
    result, excludedReason,
  }
}
const score = (date, homeGoals, awayGoals) => ({ date, homeGoals, awayGoals, observedAt: '2026-11-02T06:17:00.000Z' })
const sample = [
  record({ id: 'pending', home: 'Atlético', away: 'Real Madrid', league: leagues.laLiga, date: '2026-10-30' }),
  record({ id: 'correct', result: score('2026-10-30', 2, 0), verifiedAt: '2026-10-29T06:17:00.000Z' }),
  record({ id: 'missed', home: 'Barcelona', away: 'Valencia', league: leagues.laLiga, date: '2026-10-31', pick: 'away', result: score('2026-10-31', 1, 0), verifiedAt: '2026-10-30T06:17:00.000Z' }),
  record({ id: 'excluded', home: 'Bayern', away: 'Dortmund', league: leagues.bundesliga, date: '2026-10-30', latestDate: '2026-10-31', result: score('2026-11-01', 3, 1), verifiedAt: '2026-10-29T06:17:00.000Z', excludedReason: 'result-unavailable' }),
]

describe('history classification and filtering', () => {
  it('distinguishes pending, correct, missed and excluded even when an excluded record has a score', () => {
    expect(sample.map(historyStatus)).toEqual(['pending', 'correct', 'missed', 'excluded'])
    expect(historyPickName(sample[2])).toBe('Valencia win')
    expect(historyPickName({ ...sample[0], prediction: { ...sample[0].prediction, pick: 'draw' } })).toBe('Draw')
    expect(historyMatchDate(sample[3])).toBe('2026-11-01')
    expect(historyMatchDate(sample[0])).toBe('2026-10-30')
    expect(Object.keys(EXCLUSION_EXPLANATIONS)).toHaveLength(5)
    for (const reason of Object.keys(EXCLUSION_EXPLANATIONS)) {
      expect(historyStatus({ ...sample[1], excludedReason: reason })).toBe('excluded')
      expect(EXCLUSION_EXPLANATIONS[reason]).toBeTruthy()
    }
  })

  it('combines accent-insensitive search, league, status and inclusive match-date filters without mutating records', () => {
    const originalOrder = sample.map((item) => item.id)
    const filtered = filterHistory(sample, { ...DEFAULT_HISTORY_FILTERS, query: 'atletico', league: 'la-liga', status: 'pending', from: '2026-10-30', to: '2026-10-30' })
    expect(filtered.map((item) => item.id)).toEqual(['community-pending'])
    expect(sample.map((item) => item.id)).toEqual(originalOrder)
    expect(filterHistory(sample, { ...DEFAULT_HISTORY_FILTERS, from: '2026-11-01', to: '2026-10-30' })).toHaveLength(0)
    expect(filterHistory(sample, { ...DEFAULT_HISTORY_FILTERS, status: 'excluded' }).map((item) => item.id)).toEqual(['community-excluded'])
    expect(filterHistory(sample, { ...DEFAULT_HISTORY_FILTERS, from: '2026-11-01', to: '2026-11-01' }).map((item) => item.id)).toEqual(['community-excluded'])
    expect(filterHistory(sample, { ...DEFAULT_HISTORY_FILTERS }).map(historyMatchDate)).toEqual(['2026-11-01', '2026-10-31', '2026-10-30', '2026-10-30'])
    expect(filterHistory(sample, { ...DEFAULT_HISTORY_FILTERS, sort: 'oldest' }).map(historyMatchDate)).toEqual(['2026-10-30', '2026-10-30', '2026-10-31', '2026-11-01'])
  })
})

describe('integrated forecast history', () => {
  it('filters the full list by team, league, status and date and resets a no-results state', async () => {
    const user = userEvent.setup()
    render(<ForecastHistory records={sample} publication="github-pages" />)
    const history = screen.getByRole('region', { name: 'THE FULL RECORD' })
    expect(within(history).getByText('SHOWING 1–4 OF 4 RECORDS')).toBeInTheDocument()
    const list = within(history).getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    expect(within(list).getByText('Check pending')).toBeInTheDocument()
    expect(within(list).getByText('Correct')).toBeInTheDocument()
    expect(within(list).getByText('Missed')).toBeInTheDocument()
    expect(within(list).getByText('Excluded')).toBeInTheDocument()

    await user.type(within(history).getByRole('searchbox', { name: 'TEAM OR LEAGUE' }), 'atletico')
    await user.selectOptions(within(history).getByRole('combobox', { name: 'LEAGUE' }), 'la-liga')
    await user.selectOptions(within(history).getByRole('combobox', { name: 'STATUS' }), 'pending')
    fireEvent.change(within(history).getByLabelText('FROM DATE'), { target: { value: '2026-10-30' } })
    fireEvent.change(within(history).getByLabelText('TO DATE'), { target: { value: '2026-10-30' } })
    expect(within(history).getByText('SHOWING 1–1 OF 1 RECORD')).toBeInTheDocument()
    expect(within(history).getByRole('button', { name: /Atlético vs Real Madrid/ })).toBeInTheDocument()
    fireEvent.change(within(history).getByLabelText('FROM DATE'), { target: { value: '2026-10-31' } })
    expect(within(history).getByText('CHECK THE DATE RANGE')).toBeInTheDocument()
    await user.click(within(history).getByRole('button', { name: /reset filters/i }))
    expect(within(history).getByText('SHOWING 1–4 OF 4 RECORDS')).toBeInTheDocument()
    expect(within(history).getByRole('searchbox', { name: 'TEAM OR LEAGUE' })).toHaveValue('')
  })

  it('opens a transparent audit trail with the saved forecast, reschedule and exclusion reason', async () => {
    const user = userEvent.setup()
    render(<ForecastHistory records={[sample[3]]} publication="github-pages" />)
    const row = screen.getByRole('button', { name: /Bayern vs Dortmund/ })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    const details = document.getElementById(row.getAttribute('aria-controls'))
    expect(within(details).getByText('WHY THIS IS EXCLUDED')).toBeInTheDocument()
    expect(within(details).getByText(/previously observed result is no longer present/)).toBeInTheDocument()
    expect(within(details).getByText('Last reported score')).toBeInTheDocument()
    expect(within(details).getByText('Latest known kick-off')).toBeInTheDocument()
    expect(within(details).getByText('29 Oct 2026, 06:17 UTC')).toBeInTheDocument()
    expect(within(details).getByText(/not its exact publication time/)).toBeInTheDocument()
    expect(within(details).getByRole('img', { name: 'Home win 50%, draw 25%, away win 25%' })).toBeInTheDocument()
    expect(within(details).getByText('EXPECTED GOALS (HOME : AWAY)')).toBeInTheDocument()
    expect(within(details).getByText('1.60 : 1.20')).toBeInTheDocument()
    expect(within(details).getByRole('img', { name: /Bayern form, oldest to newest/ })).toBeInTheDocument()
    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(details).not.toBeVisible()
  })

  it('paginates all records and resets to the first page when filters change', async () => {
    const user = userEvent.setup()
    const records = Array.from({ length: 13 }, (_, index) => record({ id: `match-${index}`, home: `Team ${index}`, away: `Away ${index}`, date: `2026-10-${String(index + 1).padStart(2, '0')}` }))
    render(<ForecastHistory records={records} publication="github-pages" />)
    const history = screen.getByRole('region', { name: 'THE FULL RECORD' })
    expect(within(history).getByText('SHOWING 1–10 OF 13 RECORDS')).toBeInTheDocument()
    expect(within(history).getByRole('button', { name: /previous/i })).toBeDisabled()
    await user.click(within(history).getByRole('button', { name: /next/i }))
    expect(within(history).getByText('SHOWING 11–13 OF 13 RECORDS')).toBeInTheDocument()
    expect(within(history).getByText('PAGE 2 OF 2')).toBeInTheDocument()
    expect(within(history).getByRole('button', { name: /Team 0 vs Away 0/ })).toBeInTheDocument()
    expect(within(history).getByRole('button', { name: /next/i })).toBeDisabled()
    await user.selectOptions(within(history).getByRole('combobox', { name: 'SORT BY' }), 'oldest')
    expect(within(history).getByText('SHOWING 1–10 OF 13 RECORDS')).toBeInTheDocument()
    expect(within(history).getByRole('button', { name: /Team 0 vs Away 0/ })).toBeInTheDocument()
  })

  it('clamps the current page if a background update removes records', async () => {
    const user = userEvent.setup()
    const records = Array.from({ length: 12 }, (_, index) => record({ id: `refresh-${index}`, home: `Home ${index}`, away: `Away ${index}` }))
    const view = render(<ForecastHistory records={records} publication="github-pages" />)
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText('PAGE 2 OF 2')).toBeInTheDocument()
    view.rerender(<ForecastHistory records={records.slice(0, 3)} publication="github-pages" />)
    expect(screen.getByText('SHOWING 1–3 OF 3 RECORDS')).toBeInTheDocument()
    view.rerender(<ForecastHistory records={records} publication="github-pages" />)
    expect(screen.getByText('PAGE 1 OF 2')).toBeInTheDocument()
  })

  it('explains an empty local preview without inventing results or publication', async () => {
    const view = render(<ForecastHistory records={[]} publication="local-preview" />)
    expect(screen.getByText(/No forecasts have been recorded in this local preview/)).toBeInTheDocument()
    expect(screen.getByText(/This snapshot is not the published track record/)).toBeInTheDocument()
    view.rerender(<ForecastHistory records={[sample[0]]} publication="local-preview" />)
    const user = userEvent.setup()
    expect(screen.getByText('Preview')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Atlético vs Real Madrid/ }))
    expect(screen.getByText('Not published · local preview')).toBeInTheDocument()
  })
})
