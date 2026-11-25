import { describe, expect, it } from 'vitest'
import { findRecord, normalizeName, settleSelection, summarizeTicket, summarizeTickets } from '../src/lib/ticket.js'

const team = (name, shortName = name) => ({ name, shortName, crest: null, goalsFor: 1.5, goalsAgainst: 1.2, sampleSize: 5, form: ['W', 'D', 'L'] })

function record(id, { home, away, goals = null, date = '2026-11-27', excludedReason = null } = {}) {
  return {
    id: `community-test-${id}`,
    league: { id: 'bundesliga', name: 'Bundesliga' },
    home: team(home), away: team(away),
    latestKickoff: { date, time: '20:30', timestamp: Date.parse(`${date}T19:30:00Z`) },
    result: goals ? { date, homeGoals: goals[0], awayGoals: goals[1] } : null,
    excludedReason,
  }
}

const selection = (overrides = {}) => ({
  id: 'a', date: '2026-11-27', league: 'Bundesliga',
  home: 'Werder Bremen', away: "M'gladbach",
  market: '1X2', side: 'home', label: 'Werder Bremen win',
  probability: 0.68, fairOdds: 1.47, requiredPrice: 1.48,
  ...overrides,
})

describe('matching a selection to the ledger', () => {
  it('ignores accents and apostrophes so sources can disagree on spelling', () => {
    expect(normalizeName('Atlético de Madrid')).toBe('atletico de madrid')
    expect(normalizeName("M'gladbach")).toBe('mgladbach')
    expect(normalizeName('M\u2019gladbach')).toBe('mgladbach')
  })

  it('finds the fixture on the reported date and both clubs', () => {
    const records = [
      record('one', { home: 'Werder Bremen', away: 'Borussia M\u2019gladbach', goals: [2, 1] }),
      record('other', { home: 'Mainz', away: 'Union Berlin', goals: [1, 0] }),
    ]
    expect(findRecord(selection(), records)?.id).toBe('community-test-one')
    expect(findRecord(selection({ date: '2026-11-28' }), records)).toBeNull()
    expect(findRecord(selection({ home: 'Freiburg' }), records)).toBeNull()
  })

  it('prefers a settled record over a still-pending duplicate', () => {
    const records = [
      record('pending', { home: 'Werder Bremen', away: "M'gladbach" }),
      record('settled', { home: 'Werder Bremen', away: "M'gladbach", goals: [3, 0] }),
    ]
    expect(findRecord(selection(), records)?.id).toBe('community-test-settled')
  })
})

describe('settling a selection', () => {
  const settled = (goals, overrides = {}) => settleSelection(
    selection(overrides),
    [record('m', { home: 'Werder Bremen', away: "M'gladbach", goals })],
  )

  it('settles a straight win on the score', () => {
    expect(settled([2, 1])).toMatchObject({ state: 'won', score: '2 : 1' })
    expect(settled([0, 1])).toMatchObject({ state: 'lost', score: '0 : 1' })
  })

  it('settles an away selection from the away side of the score', () => {
    expect(settled([0, 1], { side: 'away' }).state).toBe('won')
    expect(settled([2, 1], { side: 'away' }).state).toBe('lost')
  })

  it('wins +0.5 on a draw and loses only when the side is beaten', () => {
    expect(settled([1, 1], { market: 'DC' }).state).toBe('won')
    expect(settled([0, 2], { market: 'DC' }).state).toBe('lost')
  })

  it('pushes +1 on a one-goal defeat and loses by two', () => {
    expect(settled([0, 1], { market: 'AH1' }).state).toBe('push')
    expect(settled([1, 2], { market: 'AH1' }).state).toBe('push')
    expect(settled([0, 2], { market: 'AH1' }).state).toBe('lost')
    expect(settled([1, 1], { market: 'AH1' }).state).toBe('won')
  })

  it('reports pending and unrecorded instead of guessing', () => {
    expect(settleSelection(selection(), [record('m', { home: 'Werder Bremen', away: "M'gladbach" })])).toMatchObject({ state: 'pending', score: null })
    expect(settleSelection(selection(), [])).toMatchObject({ state: 'unrecorded', score: null })
    expect(settleSelection(selection(), [record('m', { home: 'Werder Bremen', away: "M'gladbach", goals: [1, 0], excludedReason: 'ambiguous-result' })]).state).toBe('pending')
  })
})

describe('ticket summary', () => {
  const records = [
    record('w', { home: 'Werder Bremen', away: "M'gladbach", goals: [2, 0] }),
    record('l', { home: 'Mainz', away: 'Union Berlin', goals: [0, 1], date: '2026-11-28' }),
    // A one-goal defeat on +1 returns the stake rather than losing it.
    record('p', { home: 'Real Betis', away: 'Rayo Vallecano', goals: [0, 1], date: '2026-11-28' }),
  ]
  const ticket = {
    id: '2026-11-27',
    selections: [
      selection({ id: '1' }),
      selection({ id: '2', home: 'Mainz', away: 'Union Berlin', date: '2026-11-28' }),
      selection({ id: '3', home: 'Real Betis', away: 'Rayo Vallecano', date: '2026-11-28', market: 'AH1' }),
      selection({ id: '4', home: 'Frosinone', away: 'Parma', date: '2026-11-28' }),
    ],
  }

  it('counts wins, losses, pushes and pending separately', () => {
    const summary = summarizeTicket(ticket, records)
    expect(summary).toMatchObject({ won: 1, lost: 1, push: 1, pending: 0, unrecorded: 1 })
    expect(summary.decided).toBe(2)
    expect(summary.hitRate).toBeCloseTo(0.5, 12)
  })

  it('adds tickets together without multiplying anything', () => {
    const totals = summarizeTickets([ticket, ticket], records)
    expect(totals.selections).toBe(8)
    expect(totals).toMatchObject({ won: 2, lost: 2, push: 2, unrecorded: 2 })
    expect(totals.hitRate).toBeCloseTo(0.5, 12)
  })

  it('has no hit rate before anything is decided', () => {
    const empty = summarizeTickets([], records)
    expect(empty).toMatchObject({ selections: 0, won: 0, decided: 0, hitRate: null })
  })
})
