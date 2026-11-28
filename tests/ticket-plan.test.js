import { describe, expect, it } from 'vitest'
import { LEAD_TIME, TICKET_THRESHOLD, eligiblePicks, isoWeek, planTicket, sameFixture } from '../src/lib/ticketPlan.js'

// A fixture shaped like the published snapshot's, so the real model runs.
function fixture({ home = 'Home', away = 'Away', date = '2026-11-29', time = '15:00', league = 'Serie A', strengths = [1.5, 1.5] } = {}) {
  const team = (name, goalsFor, goalsAgainst) => ({
    name, shortName: name, crest: null, sampleSize: 10, goalsFor, goalsAgainst, form: ['W', 'W', 'W', 'W', 'W'],
  })
  return {
    id: `community-${date}-${home}-${away}`.toLowerCase().replace(/\s+/g, '-'),
    league: { id: 'league', name: league, country: 'italy' },
    date,
    time,
    kickoffTimestamp: Date.parse(`${date}T${time}:00Z`),
    home: team(home, strengths[0], 1.1),
    away: team(away, strengths[1], 1.1),
    hasEnoughData: true,
  }
}

const NOW = Date.parse('2026-11-26T10:00:00Z')

describe('picking the eligible fixtures', () => {
  it('ignores a fixture that has already kicked off or is about to', () => {
    const started = fixture({ date: '2026-11-26', time: '09:00' })
    const soon = fixture({ date: '2026-11-26', time: '10:30' })
    const later = fixture({ date: '2026-11-29', time: '15:00' })
    expect(eligiblePicks([started, soon], { now: NOW })).toEqual([])
    expect(eligiblePicks([soon], { now: NOW, leadTime: 0, threshold: 0 })).toHaveLength(1)
    expect(eligiblePicks([later], { now: NOW, threshold: 0 })).toHaveLength(1)
  })

  it('keeps only selections the model is confident enough about', () => {
    const lopsided = fixture({ strengths: [2.6, 0.9] })
    const even = fixture({ home: 'Even A', away: 'Even B', strengths: [1.4, 1.4] })
    const picks = eligiblePicks([lopsided, even], { now: NOW })
    expect(picks).toHaveLength(1)
    expect(picks[0].probability).toBeGreaterThanOrEqual(TICKET_THRESHOLD)
    // The threshold is a real bar, not a formality.
    expect(eligiblePicks([even], { now: NOW })).toEqual([])
    expect(eligiblePicks([even], { now: NOW, threshold: 0 })).toHaveLength(1)
  })

  it('puts the strongest selection first', () => {
    const big = fixture({ home: 'Big', away: 'Small', strengths: [2.8, 0.8] })
    const medium = fixture({ home: 'Medium', away: 'Meh', strengths: [2.2, 1] })
    const picks = eligiblePicks([medium, big], { now: NOW })
    expect(picks.map((pick) => pick.fixture.home.shortName)).toEqual(['Big', 'Medium'])
  })
})

describe('the week a date belongs to', () => {
  it('runs Monday to Sunday and names the year of its Thursday', () => {
    expect(isoWeek('2026-11-23')).toEqual({ key: '2026-W48', monday: '2026-11-23' })
    expect(isoWeek('2026-11-29')).toEqual({ key: '2026-W48', monday: '2026-11-23' })
    expect(isoWeek('2026-11-30')).toEqual({ key: '2026-W49', monday: '2026-11-30' })
    // New Year's Day 2027 belongs to the week that started in December.
    expect(isoWeek('2027-01-01')).toEqual({ key: '2026-W53', monday: '2026-12-28' })
  })
})

describe('planning the week ticket', () => {
  const sunday = [
    fixture({ home: 'Roma', away: 'Monza', strengths: [2.8, 1.1] }),
    fixture({ home: 'Brighton', away: 'Newcastle', strengths: [2.2, 0.9] }),
    fixture({ home: 'Sassuolo', away: 'Napoli', strengths: [0.6, 2.6] }),
  ]

  it('writes one slip for the whole week, not one per day', () => {
    const midweek = [fixture({ home: 'Cagliari', away: 'Milan', date: '2026-11-30', strengths: [0.7, 2.8] })]
    const plan = planTicket({ fixtures: [...sunday, ...midweek], tickets: [], now: NOW })
    expect(plan.id).toBe('2026-W48')
    expect(plan.label).toBe('Week of 23 Nov – 29 Nov 2026')
    expect(plan.generated).toBe(true)
    expect(plan.selectedAt).toBe(new Date(NOW).toISOString())
    expect(plan.selections).toHaveLength(3)
  })

  it('writes nothing while a slip is still to be played', () => {
    const running = { id: '2026-11-27', selections: [{ date: '2026-11-27', home: 'Werder Bremen', away: 'Mgladbach' }] }
    // 26 Nov: that slip's game is tomorrow, so the group is still following it.
    expect(planTicket({ fixtures: sunday, tickets: [running], now: NOW })).toBeNull()
    // Once everything on the ledger has been played, the next slip is planned.
    const past = { id: '2026-11-20', selections: [{ date: '2026-11-20', home: 'Old', away: 'Game' }] }
    expect(planTicket({ fixtures: sunday, tickets: [past], now: NOW })?.id).toBe('2026-W48')
  })

  it('leaves a week alone once it has a ticket', () => {
    const existing = { id: '2026-W48', selections: [{ date: '2026-11-23', home: 'Old', away: 'Game' }] }
    expect(planTicket({ fixtures: sunday, tickets: [existing], now: NOW })).toBeNull()
  })

  it('skips a week that any ticket already touches, whatever its id', () => {
    // A slip from an earlier week is already played, so the planner is free to run.
    const taken = { id: '2026-11-24', selections: [{ date: '2026-11-24', home: 'Roma', away: 'Monza' }] }
    expect(planTicket({ fixtures: sunday, tickets: [taken], now: NOW })).toBeNull()
    // The week after is planned instead.
    const next = [fixture({ home: 'Cagliari', away: 'Milan', date: '2026-11-30', strengths: [0.7, 2.8] })]
    expect(planTicket({ fixtures: [...sunday, ...next], tickets: [taken], now: NOW }).id).toBe('2026-W49')
  })

  it('treats two spellings of the same club as one fixture', () => {
    expect(sameFixture(
      { date: '2026-11-29', home: 'Deportivo', away: 'FC Barcelona' },
      { date: '2026-11-29', home: 'Deportivo', away: 'Barcelona' },
    )).toBe(true)
    expect(sameFixture(
      { date: '2026-11-29', home: 'Roma', away: 'Monza' },
      { date: '2026-11-30', home: 'Roma', away: 'Monza' },
    )).toBe(false)
  })

  it('collapses a fixture the feed lists twice', () => {
    const duplicated = [sunday[0], sunday[0], sunday[1]]
    const plan = planTicket({ fixtures: duplicated, tickets: [], now: NOW })
    expect(plan.selections.map((selection) => selection.home)).toEqual(['Roma', 'Brighton'])
  })

  it('never reuses a fixture and never exceeds six selections', () => {
    const many = Array.from({ length: 8 }, (_, index) => fixture({
      home: `Home ${index}`, away: `Away ${index}`, time: `${12 + index}:00`, strengths: [2.6 - index * 0.05, 1],
    }))
    const plan = planTicket({ fixtures: many, tickets: [], now: NOW })
    expect(plan.selections).toHaveLength(6)
    expect(new Set(plan.selections.map((selection) => `${selection.home}|${selection.away}`)).size).toBe(6)
    expect(plan.selections.map((selection) => selection.probability)).toEqual(
      [...plan.selections.map((selection) => selection.probability)].sort((a, b) => b - a),
    )
  })

  it('writes selections in the same shape the ledger already uses', () => {
    const plan = planTicket({ fixtures: sunday, tickets: [], now: NOW })
    const [first] = plan.selections
    expect(first).toMatchObject({
      id: '2026-W48-2026-11-29-1', date: '2026-11-29', league: 'Serie A', market: '1X2',
      home: 'Roma', away: 'Monza', side: 'home', label: 'Roma win',
    })
    expect(first.probability).toBeGreaterThan(0.57)
    expect(first.requiredPrice).toBe(Math.ceil((1 / first.probability) * 100) / 100)
    expect(first.fairOdds).toBeCloseTo(1 / first.probability, 2)
  })

  it('labels an away pick and leaves a one-leg slip without multiples', () => {
    const away = fixture({ home: 'Sassuolo', away: 'Napoli', strengths: [0.6, 2.6] })
    expect(eligiblePicks([away], { now: NOW })[0].side).toBe('away')
    const plan = planTicket({ fixtures: [away], tickets: [], now: NOW })
    expect(plan.selections[0].label).toBe('Napoli win')
    expect(plan.multiples).toBeUndefined()
  })

  it('adds multiples only when there is more than one leg', () => {
    const two = planTicket({ fixtures: sunday.slice(0, 2), tickets: [], now: NOW })
    expect(two.multiples.map((multiple) => multiple.short)).toEqual(['Double'])
    const three = planTicket({ fixtures: sunday, tickets: [], now: NOW })
    expect(three.multiples.map((multiple) => multiple.short)).toEqual(['Double', 'Treble'])
    const four = planTicket({
      fixtures: [...sunday, fixture({ home: 'Roma B', away: 'Monza B', strengths: [2.4, 1] })], tickets: [], now: NOW,
    })
    expect(four.multiples.map((multiple) => multiple.short)).toEqual(['Double', 'Treble', 'All four'])
    // Every multiple names a different fixture for every leg.
    for (const multiple of four.multiples) {
      const legs = multiple.legs.map((id) => four.selections.find((selection) => selection.id === id))
      expect(new Set(legs.map((leg) => leg.home)).size).toBe(legs.length)
    }
  })

  it('writes nothing when no fixture qualifies', () => {
    const quiet = [fixture({ strengths: [1.3, 1.3] })]
    expect(planTicket({ fixtures: quiet, tickets: [], now: NOW })).toBeNull()
    expect(planTicket({ fixtures: [], tickets: [], now: NOW })).toBeNull()
  })

  it('produces the same plan twice for the same snapshot', () => {
    const first = planTicket({ fixtures: sunday, tickets: [], now: NOW })
    const again = planTicket({ fixtures: sunday, tickets: [], now: NOW })
    expect(again).toEqual(first)
  })

  it('honours the lead time rather than publishing a slip mid-matchday', () => {
    const nearly = fixture({ date: '2026-11-29', time: '15:00' })
    const plan = planTicket({ fixtures: [nearly], tickets: [], now: Date.parse('2026-11-29T15:00:00Z') - LEAD_TIME / 2 })
    expect(plan).toBeNull()
  })
})
