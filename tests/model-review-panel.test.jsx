import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import ModelReview from '../src/components/ModelReview.jsx'

const recordedAt = '2026-10-29T12:00:00.000Z'
const verifiedAt = '2026-10-30T06:17:00.000Z'
const observedAt = '2026-10-31T06:17:00.000Z'
const kickoff = { date: '2026-10-30', time: '18:30', timestamp: Date.parse('2026-10-30T17:30:00Z') }
const team = (name) => ({ name, shortName: name, crest: null, goalsFor: 1.6, goalsAgainst: 1.1, sampleSize: 5, form: ['W', 'D', 'L'] })

function record(id, { goals = [2, 0], pick = 'home', probabilities = { home: 0.6, draw: 0.25, away: 0.15 }, verified = verifiedAt, excludedReason = null } = {}) {
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

const ledger = (records, publication = 'github-pages') => ({ version: 1, startedAt: recordedAt, updatedAt: observedAt, publication, sourceUpdatedAt: observedAt, sourceStale: false, records })

const scored = [
  record('win', { goals: [2, 0] }),
  record('one-goal-loss', { goals: [0, 1] }),
  record('two-goal-loss', { goals: [0, 2] }),
  record('pending', { goals: null, verified: null }),
]

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function rowFor(table, label) {
  return within(table).getByRole('rowheader', { name: new RegExp(`^${escape(label)}`) }).closest('tr')
}

describe('model review panel', () => {
  it('shows the promotion gate until enough picks are scored', () => {
    render(<ModelReview tracker={ledger(scored)} />)
    expect(screen.getByRole('heading', { name: /MODEL REVIEW/i })).toBeInTheDocument()
    expect(screen.getByText('KEEP COLLECTING')).toBeInTheDocument()
    expect(screen.getByText('3 / 100 SCORED')).toBeInTheDocument()
    expect(screen.getByText(/3 of 100 scored picks needed/)).toBeInTheDocument()
  })

  it('scores the same picks as a straight win, +0.5 and +1', () => {
    render(<ModelReview tracker={ledger(scored)} />)
    const table = screen.getByRole('table', { name: /straight win, as a double chance/i })
    expect(rowFor(table, 'Straight win')).toHaveTextContent('33.3%')
    expect(rowFor(table, '+0.5')).toHaveTextContent('33.3%')
    // The one-goal defeat returns the stake instead of counting as a loss.
    expect(rowFor(table, '+1')).toHaveTextContent('50.0%')
    expect(rowFor(table, '+1')).toHaveTextContent('2 settled')
  })

  it('publishes the shadow models without promoting any of them', () => {
    render(<ModelReview tracker={ledger(scored)} />)
    const table = screen.getByRole('table', { name: /Alternative model settings/i })
    expect(within(table).getByRole('rowheader', { name: /No home edge/ })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: /Heavier form weight/ })).toBeInTheDocument()
    expect(within(table).getAllByText(/INSIDE NOISE|BEATS PUBLISHED|WORSE/).length).toBe(4)
    expect(screen.getByText(/Promotion needs 100\+ scored picks/)).toBeInTheDocument()
  })

  it('never reviews unpublished forecasts', () => {
    render(<ModelReview tracker={ledger(scored, 'local-preview')} />)
    expect(screen.getByText('PUBLISHED RESULTS ONLY')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('AWAITING RESULTS')).toBeInTheDocument()
  })
})
