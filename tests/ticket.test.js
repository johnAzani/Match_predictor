import { describe, expect, it } from 'vitest'
import { findRecord, legName, normalizeName, settleSelection, summarizeMultiple, summarizeTicket, summarizeTickets } from '../src/lib/ticket.js'
import ticketData from '../picks/tickets.json'

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

describe('a multiple on the same ticket', () => {
  const leg = (id, home, away, probability, state = 'pending', overrides = {}) => ({
    id, home, away, side: 'home', market: '1X2', label: `${home} win`, probability, state, ...overrides,
  })
  const legs = [
    leg('a', 'Werder Bremen', "M'gladbach", 0.68),
    leg('b', 'Mainz', 'Union Berlin', 0.6),
  ]

  it('multiplies the legs and rounds the price up, never down', () => {
    const combined = summarizeMultiple({ id: 'd', short: 'Double', legs: ['a', 'b'] }, legs)
    expect(combined.probability).toBeCloseTo(0.408, 12)
    expect(combined.fairOdds).toBeCloseTo(1 / 0.408, 10)
    // 1 / 0.408 = 2.4509, so 2.45 would be a losing price.
    expect(combined.requiredPrice).toBe(2.46)
    expect(combined.state).toBe('pending')
  })

  it('refuses two legs on the same match, because they are related bets', () => {
    const related = [leg('a', 'Mainz', 'Union Berlin', 0.6), leg('b', 'Mainz', 'Union Berlin', 0.79, 'pending', { market: 'DC' })]
    const combined = summarizeMultiple({ id: 'x', legs: ['a', 'b'] }, related)
    expect(combined.state).toBe('invalid')
    expect(combined.probability).toBeNull()
    expect(combined.note).toMatch(/related bets/)
  })

  it('is won only when every leg wins, and lost as soon as one loses', () => {
    const won = summarizeMultiple({ id: 'd', legs: ['a', 'b'] }, legs.map((l) => ({ ...l, state: 'won' })))
    expect(won).toMatchObject({ state: 'won', voids: 0 })
    const lost = summarizeMultiple({ id: 'd', legs: ['a', 'b'] }, [legs[0], { ...legs[1], state: 'lost' }])
    expect(lost.state).toBe('lost')
  })

  it('drops a voided leg and prices the rest', () => {
    const combined = summarizeMultiple({ id: 'd', legs: ['a', 'b'] }, [{ ...legs[0], state: 'won' }, { ...legs[1], state: 'push' }])
    expect(combined).toMatchObject({ state: 'won', voids: 1 })
    expect(combined.probability).toBeCloseTo(0.68, 12)
    expect(combined.requiredPrice).toBe(1.48)
  })

  it('ignores a leg that is not on the ticket and needs two real legs', () => {
    expect(summarizeMultiple({ id: 'd', legs: ['a', 'ghost'] }, legs).state).toBe('invalid')
  })

  it('lists the club each leg backs', () => {
    expect(legName(legs[0])).toBe('Werder Bremen')
    expect(legName({ ...legs[0], market: 'AH1', side: 'home', label: 'Mainz +1' })).toBe('Mainz +1')
  })

  it('is carried through the ticket summary', () => {
    const summary = summarizeTicket({ id: 't', selections: legs, multiples: [{ id: 'd', legs: ['a', 'b'] }] }, [])
    expect(summary.multiples).toHaveLength(1)
    expect(summary.multiples[0].legs.map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('the committed tickets', () => {
  it('only multiplies legs from different matches, and every leg exists', () => {
    for (const ticket of ticketData.tickets) {
      const summary = summarizeTicket(ticket, [])
      for (const multiple of summary.multiples) {
        const declared = (ticket.multiples ?? []).find((item) => item.id === multiple.id)
        expect(multiple.state, `${multiple.id} is not bookable`).not.toBe('invalid')
        expect(multiple.legs.map((item) => item.id)).toEqual(declared.legs)
      }
    }
  })
})
