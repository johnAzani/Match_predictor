import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import Ticket from '../src/components/Ticket.jsx'

const team = (name) => ({ name, shortName: name, crest: null, goalsFor: 1.5, goalsAgainst: 1.2, sampleSize: 5, form: ['W', 'D', 'L'] })

function record(id, { home, away, goals, date = '2026-11-27', excludedReason = null }) {
  return {
    id: `community-test-${id}`,
    league: { id: 'bundesliga', name: 'Bundesliga' },
    home: team(home), away: team(away),
    latestKickoff: { date, time: '20:30', timestamp: Date.parse(`${date}T19:30:00Z`) },
    result: goals ? { date, homeGoals: goals[0], awayGoals: goals[1] } : null,
    excludedReason,
  }
}

const tracker = (records) => ({ version: 1, publication: 'github-pages', records })

const tickets = [{
  id: '2026-11-27',
  label: 'Weekend of 27–29 November 2026',
  note: 'Five independent singles.',
  selections: [
    { id: 'a', date: '2026-11-27', league: 'Bundesliga', home: 'Werder Bremen', away: "M'gladbach", market: '1X2', side: 'home', label: 'Werder Bremen win', probability: 0.68, fairOdds: 1.47, requiredPrice: 1.48 },
    { id: 'b', date: '2026-11-28', league: 'Bundesliga', home: 'Mainz', away: 'Union Berlin', market: 'AH1', side: 'home', label: 'Mainz +1', probability: 0.6, fairOdds: 1.67, requiredPrice: 1.68 },
    { id: 'c', date: '2026-11-28', league: 'La Liga', home: 'Real Betis', away: 'Rayo Vallecano', market: '1X2', side: 'home', label: 'Real Betis win', probability: 0.59, fairOdds: 1.69, requiredPrice: 1.7 },
  ],
}]

const records = [
  record('w', { home: 'Werder Bremen', away: 'Borussia M\u2019gladbach', goals: [2, 0] }),
  record('p', { home: 'Mainz', away: 'Union Berlin', goals: [0, 1], date: '2026-11-28' }),
  record('l', { home: 'Real Betis', away: 'Rayo Vallecano', goals: [0, 2], date: '2026-11-28' }),
]

describe('ticket panel', () => {
  it('shows each selection settled against the ledger', () => {
    render(<Ticket tracker={tracker(records)} tickets={tickets} />)
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('WON')
    expect(rows[0]).toHaveTextContent('2 : 0')
    // A one-goal defeat returns the stake on +1.
    expect(rows[1]).toHaveTextContent('PUSH')
    expect(rows[2]).toHaveTextContent('LOST')
    expect(screen.getByLabelText('1 won, 1 lost')).toBeInTheDocument()
    expect(screen.getByText('50.0% of decided selections')).toBeInTheDocument()
  })

  it('says pending rather than guessing when a score is missing', () => {
    render(<Ticket tracker={tracker([])} tickets={tickets} />)
    expect(screen.getAllByText('AWAITING LEDGER')).toHaveLength(3)
    expect(screen.getByText('No settled selections yet')).toBeInTheDocument()
    expect(screen.getByText('3 still to settle')).toBeInTheDocument()
  })

  it('is honest when no ticket has been published yet', () => {
    render(<Ticket tracker={tracker(records)} tickets={[]} />)
    expect(screen.getByText('NO TICKET YET')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('renders the committed ticket by default', () => {
    render(<Ticket tracker={tracker([])} />)
    expect(screen.getByText(/TICKET 2026-11-27/)).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(6)
    expect(screen.getAllByText('AWAITING LEDGER')).toHaveLength(5)
  })
})
