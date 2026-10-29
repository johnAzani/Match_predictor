import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PerformanceCheck from '../src/components/PerformanceCheck.jsx'
import TrackRecord from '../src/components/TrackRecord.jsx'
import { summarizeProspectivePerformance } from '../src/lib/prospectivePerformance.js'
import { isValidTracker, summarizeTracker } from '../src/lib/tracker.js'

const recordedAt = '2026-10-29T12:00:00.000Z'
const verifiedAt = '2026-10-30T06:17:00.000Z'
const observedAt = '2026-10-31T06:17:00.000Z'
const team = (name) => ({ name, shortName: name, crest: null, goalsFor: 1.5, goalsAgainst: 1.2, sampleSize: 5, form: ['W', 'D', 'L'] })
const kickoff = { date: '2026-10-30', time: '18:30', timestamp: Date.parse('2026-10-30T17:30:00Z') }

function record(id, { probabilities = { home: 0.6, draw: 0.25, away: 0.15 }, pick = 'home', goals = [2, 0], verified = verifiedAt, excludedReason = null } = {}) {
  return {
    id: `community-test-${id}`, season: '2026-27',
    league: { id: 'premier-league', name: 'Premier League', country: 'england' },
    home: team(`Home ${id}`), away: team(`Away ${id}`),
    originalKickoff: kickoff, latestKickoff: kickoff, recordedAt, verifiedAt: verified, modelVersion: 'poisson-v1',
    prediction: {
      pick,
      probabilities: Object.fromEntries(Object.entries(probabilities).map(([key, value]) => [key, Math.round(value * 100)])),
      probabilitiesExact: probabilities,
      likelyScore: { home: 1, away: 1 }, expectedGoals: { home: 1.5, away: 1.2 },
    },
    result: goals ? { date: '2026-10-30', homeGoals: goals[0], awayGoals: goals[1], observedAt } : null,
    excludedReason,
  }
}

const scored = [
  record('home', {}),
  record('away', { probabilities: { home: 0.2, draw: 0.3, away: 0.5 }, pick: 'away', goals: [0, 1] }),
  record('draw', { probabilities: { home: 0.2, draw: 0.6, away: 0.2 }, pick: 'draw', goals: [1, 1] }),
  record('missed', { probabilities: { home: 0.55, draw: 0.1, away: 0.35 }, pick: 'home', goals: [0, 1] }),
]
const pending = record('pending', { goals: null, verified: null })
const excluded = record('excluded', { excludedReason: 'ambiguous-result' })
const excludedUnverified = record('unverified', { verified: null, excludedReason: 'unverified-publication' })
const ledger = (records = scored, publication = 'github-pages') => ({ version: 1, startedAt: recordedAt, updatedAt: observedAt, publication, sourceUpdatedAt: observedAt, sourceStale: false, records })

function rowFor(table, label) {
  return within(table).getByRole('rowheader', { name: label }).closest('tr')
}

describe('prospective performance calculations', () => {
  it('compares the same verified, unambiguous results and uses all three exact probabilities', () => {
    const tracker = ledger([...scored, pending, excluded, excludedUnverified])
    expect(isValidTracker(tracker)).toBe(true)
    const original = structuredClone(tracker)
    const result = summarizeProspectivePerformance(tracker)
    expect(result).toMatchObject({ evaluated: 4, correct: 3, baselineCorrect: 1, accuracy: 0.75, baselineAccuracy: 0.25 })
    expect(result.evaluated).toBe(summarizeTracker(tracker).evaluated)
    expect(result.brier).toBeCloseTo(0.4, 12)
    expect(result.calibration.all.map((band) => band.count)).toEqual([2, 6, 2, 2, 0])
    expect(result.calibration.all.map((band) => band.occurred)).toEqual([0, 1, 1, 2, 0])
    expect(result.calibration.all[1].meanForecast).toBeCloseTo(0.25, 12)
    expect(result.calibration.all[1].observedRate).toBeCloseTo(1 / 6, 12)
    expect(result.calibration.all[4]).toMatchObject({ meanForecast: null, observedRate: null })
    expect(result.calibration.home.map((band) => band.count)).toEqual([0, 2, 1, 1, 0])
    expect(result.calibration.draw.reduce((sum, band) => sum + band.count, 0)).toBe(4)
    expect(result.calibration.away.reduce((sum, band) => sum + band.count, 0)).toBe(4)
    expect(tracker).toEqual(original)
  })

  it('places exact boundaries including 0 and 100 percent in the correct bands', () => {
    const results = summarizeProspectivePerformance(ledger([
      record('zero', { probabilities: { home: 0, draw: 0, away: 1 }, pick: 'away', goals: [0, 1] }),
      record('twenty-eighty', { probabilities: { home: 0.8, draw: 0.2, away: 0 }, goals: [1, 1] }),
      record('forty-sixty', { probabilities: { home: 0.4, draw: 0.6, away: 0 }, pick: 'draw', goals: [1, 1] }),
    ]))
    expect(results.calibration.all.map((band) => band.count)).toEqual([4, 1, 1, 1, 2])
    expect(results.calibration.all.map((band) => band.occurred)).toEqual([0, 1, 0, 1, 1])
    expect(results.calibration.all[4].meanForecast).toBeCloseTo(0.9)
  })

  it('uses unrounded probabilities for bands and Brier even when display rounding crosses a band boundary', () => {
    const probabilities = { home: 0.6049, draw: 0.1999, away: 0.1952 }
    const tracker = ledger([record('fractional', { probabilities })])
    expect(isValidTracker(tracker)).toBe(true)
    const result = summarizeProspectivePerformance(tracker)
    expect(result.calibration.all.map((band) => band.count)).toEqual([2, 0, 0, 1, 0])
    expect(result.calibration.draw[0].meanForecast).toBe(0.1999)
    expect(result.brier).toBeCloseTo((0.6049 - 1) ** 2 + 0.1999 ** 2 + 0.1952 ** 2, 12)
  })

  it('does not score pending, excluded, unverified, or local-preview forecasts', () => {
    const invalidUnverified = { ...scored[0], verifiedAt: null }
    const noEligible = summarizeProspectivePerformance(ledger([pending, excluded, excludedUnverified, invalidUnverified]))
    expect(noEligible).toMatchObject({ evaluated: 0, correct: 0, baselineCorrect: 0, accuracy: null, baselineAccuracy: null, brier: null })
    expect(noEligible.calibration.all.every((band) => band.count === 0 && band.meanForecast === null && band.observedRate === null)).toBe(true)
    const preview = summarizeProspectivePerformance(ledger(scored, 'local-preview'))
    expect(preview.evaluated).toBe(0)
    expect(preview.brier).toBeNull()
  })

  it('recomputes when a result changes or becomes excluded rather than retaining an old score', () => {
    const before = summarizeProspectivePerformance(ledger(scored))
    const corrected = structuredClone(scored)
    corrected[0].result.homeGoals = 0
    corrected[0].result.awayGoals = 1
    corrected[1].excludedReason = 'result-unavailable'
    const after = summarizeProspectivePerformance(ledger(corrected))
    expect(before).toMatchObject({ evaluated: 4, correct: 3, baselineCorrect: 1 })
    expect(after).toMatchObject({ evaluated: 3, correct: 1, baselineCorrect: 0 })
    expect(after.brier).not.toBe(before.brier)
    expect(after.calibration.all.reduce((sum, band) => sum + band.count, 0)).toBe(9)
  })
})

describe('performance comparison on the website', () => {
  it('clearly waits for genuine results instead of showing zero-percent or made-up metrics', () => {
    render(<PerformanceCheck tracker={ledger([pending])} />)
    const panel = screen.getByRole('region', { name: 'THE PERFORMANCE CHECK' })
    expect(within(panel).getByText('0 SCORED MATCHES')).toBeInTheDocument()
    expect(within(panel).getByText('WAITING FOR THE FIRST RESULT')).toBeInTheDocument()
    expect(within(panel).getByText(/No earlier predictions are invented/)).toBeInTheDocument()
    expect(within(panel).getAllByText('—')).toHaveLength(3)
    expect(within(panel).queryByRole('table')).not.toBeInTheDocument()
    expect(within(panel).queryByText(/NaN|0\.0%/)).not.toBeInTheDocument()
  })

  it('compares the model and baseline, shows Brier, and filters accessible calibration rows', async () => {
    const user = userEvent.setup()
    render(<PerformanceCheck tracker={ledger([...scored, pending, excluded])} />)
    const panel = screen.getByRole('region', { name: 'THE PERFORMANCE CHECK' })
    expect(within(panel).getByText('4 SCORED MATCHES')).toBeInTheDocument()
    expect(within(panel).getByText('75.0%')).toBeInTheDocument()
    expect(within(panel).getByText('3 of 4 correct')).toBeInTheDocument()
    const baseline = within(panel).getByText('ALWAYS HOME').closest('.performance-comparison__card')
    expect(within(baseline).getByText('25.0%')).toBeInTheDocument()
    expect(within(baseline).getByText('1 of 4 correct')).toBeInTheDocument()
    expect(within(panel).getByText('0.400')).toBeInTheDocument()
    expect(within(panel).getByText(/not calibration alone/)).toBeInTheDocument()
    expect(within(panel).getByText(/Small samples and sparsely populated bands/)).toBeInTheDocument()
    let table = within(panel).getByRole('table', { name: /calibration for all outcomes/i })
    expect(within(rowFor(table, '20–<40%')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['6', '25.0%', '16.7%1 of 6'])
    expect(within(rowFor(table, '80–100%')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['0', '—', '—'])
    const home = within(panel).getByRole('button', { name: 'Home wins' })
    await user.click(home)
    expect(home).toHaveAttribute('aria-pressed', 'true')
    expect(within(panel).getByRole('button', { name: 'All outcomes' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(panel).getByText('Each scored match contributes one chance for the selected outcome. Bands include their lower limit; 100% is included in the final band.')).toBeInTheDocument()
    table = within(panel).getByRole('table', { name: /calibration for home wins/i })
    expect(within(rowFor(table, '20–<40%')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['2', '20.0%', '0.0%0 of 2'])
    await user.click(within(panel).getByRole('button', { name: 'Draws' }))
    expect(within(panel).getByRole('table', { name: /calibration for draws/i })).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Away wins' }))
    expect(within(panel).getByRole('table', { name: /calibration for away wins/i })).toBeInTheDocument()
  })

  it('labels local previews and does not present them as verified performance', () => {
    render(<PerformanceCheck tracker={ledger(scored, 'local-preview')} />)
    const panel = screen.getByRole('region', { name: 'THE PERFORMANCE CHECK' })
    expect(within(panel).getByText('LOCAL PREVIEW')).toBeInTheDocument()
    expect(within(panel).getByText(/Local-preview forecasts are not published or verified/)).toBeInTheDocument()
    expect(within(panel).queryByText('75.0%')).not.toBeInTheDocument()
    expect(within(panel).queryByRole('table')).not.toBeInTheDocument()
  })

  it('is integrated with the real track record and uses the same scored count', () => {
    const data = ledger([...scored, pending, excluded])
    render(<TrackRecord tracker={{ status: 'ready', data, loadFailed: false }} />)
    const section = screen.getByRole('region', { name: 'THE TRACK RECORD' })
    expect(within(section).getByText('3 correct out of 4 scored')).toBeInTheDocument()
    const performance = within(section).getByRole('region', { name: 'THE PERFORMANCE CHECK' })
    expect(within(performance).getByText('3 of 4 correct')).toBeInTheDocument()
    expect(within(performance).getByText('4 SCORED MATCHES')).toBeInTheDocument()
  })
})
