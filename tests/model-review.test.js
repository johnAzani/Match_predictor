import { describe, expect, it } from 'vitest'
import {
  REVIEW_MIN_SAMPLE,
  confidenceBands,
  confidenceBias,
  evidenceRecords,
  marketBreakdown,
  reviewModel,
  reviewVerdict,
  scoreChallengers,
} from '../src/lib/modelReview.js'
import { predictMatch } from '../src/lib/predictions.js'

const recordedAt = '2026-10-29T12:00:00.000Z'
const verifiedAt = '2026-10-30T06:17:00.000Z'
const observedAt = '2026-10-31T06:17:00.000Z'
const kickoff = { date: '2026-10-30', time: '18:30', timestamp: Date.parse('2026-10-30T17:30:00Z') }
const team = (name, goalsFor = 1.5, goalsAgainst = 1.2, form = ['W', 'D', 'L']) => ({ name, shortName: name, crest: null, goalsFor, goalsAgainst, sampleSize: 5, form })

function record(id, { probabilities = { home: 0.6, draw: 0.25, away: 0.15 }, pick = 'home', goals = [2, 0], verified = verifiedAt, excludedReason = null } = {}) {
  return {
    id: `community-test-${id}`, season: '2026-27',
    league: { id: 'premier-league', name: 'Premier League', country: 'england' },
    home: team(`Home ${id}`, 2, 0.8, ['W', 'W', 'D']), away: team(`Away ${id}`, 0.9, 1.8, ['L', 'L', 'W']),
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

describe('model review evidence', () => {
  it('uses only published, verified, unambiguous scored forecasts', () => {
    const records = [
      record('scored'),
      record('pending', { goals: null, verified: null }),
      record('excluded', { excludedReason: 'ambiguous-result' }),
      record('unverified', { verified: null }),
    ]
    expect(evidenceRecords(ledger(records)).map((entry) => entry.id)).toEqual(['community-test-scored'])
    expect(evidenceRecords(ledger(records, 'local-preview'))).toEqual([])
    expect(evidenceRecords(null)).toEqual([])
  })
})

describe('market breakdown', () => {
  const records = [
    record('home-win', { goals: [2, 0] }),
    record('away-win', { pick: 'away', probabilities: { home: 0.2, draw: 0.3, away: 0.5 }, goals: [0, 1] }),
    record('one-goal-loss', { goals: [0, 1] }),
    record('two-goal-loss', { goals: [0, 2] }),
    record('draw-pick', { pick: 'draw', probabilities: { home: 0.2, draw: 0.6, away: 0.2 }, goals: [1, 1] }),
  ]

  it('scores the same picks as straight wins, +0.5 and +1', () => {
    const markets = marketBreakdown(records)
    expect(markets.straight).toMatchObject({ bets: 5, wins: 3, losses: 2 })
    expect(markets.straight.hitRate).toBeCloseTo(0.6, 12)
    expect(markets.doubleChance).toMatchObject({ bets: 4, wins: 2, losses: 2, skipped: 1, settled: 4 })
    expect(markets.doubleChance.hitRate).toBeCloseTo(0.5, 12)
    expect(markets.handicap).toMatchObject({ bets: 4, wins: 2, pushes: 1, losses: 1, skipped: 1, settled: 3 })
    expect(markets.handicap.hitRate).toBeCloseTo(2 / 3, 12)
  })

  it('counts a push as neither a win nor a loss', () => {
    const markets = marketBreakdown([record('push', { goals: [1, 2] })])
    expect(markets.handicap).toMatchObject({ wins: 0, pushes: 1, losses: 0, settled: 0 })
    expect(markets.handicap.hitRate).toBeNull()
    expect(markets.doubleChance).toMatchObject({ wins: 0, losses: 1 })
  })
})

describe('confidence', () => {
  it('compares stated probability with the share that actually landed', () => {
    const bands = confidenceBands([
      record('a', { probabilities: { home: 0.55, draw: 0.25, away: 0.2 }, goals: [1, 0] }),
      record('b', { probabilities: { home: 0.55, draw: 0.25, away: 0.2 }, goals: [0, 1] }),
      record('c', { probabilities: { home: 0.72, draw: 0.18, away: 0.1 }, goals: [3, 0] }),
    ])
    const fifty = bands.find((band) => band.label === '50–<60%')
    expect(fifty).toMatchObject({ count: 2, wins: 1 })
    expect(fifty.meanForecast).toBeCloseTo(0.55, 12)
    expect(fifty.observedRate).toBeCloseTo(0.5, 12)
    expect(bands.reduce((total, band) => total + band.count, 0)).toBe(3)
  })

  it('flags a model that claims more than it delivers', () => {
    // 40 picks claiming 60%, landing 40% of the time: outside the sampling noise.
    const records = Array.from({ length: 40 }, (_, index) => record(`n${index}`, { goals: index < 16 ? [2, 0] : [0, 1] }))
    const bias = confidenceBias(records)
    expect(bias.state).toBe('overconfident')
    expect(bias.bias).toBeCloseTo(0.2, 12)
    expect(confidenceBias([])).toMatchObject({ bias: null, state: 'unknown' })
  })
})

describe('shadow models', () => {
  const records = [
    record('a', { goals: [2, 0] }),
    record('b', { goals: [0, 2] }),
    record('c', { goals: [1, 1] }),
    record('d', { goals: [3, 1] }),
  ]

  it('re-scores a setting that is identical to the published one as no change', () => {
    // Store exactly what the published model produces for these teams, then
    // re-run it as a shadow model. Nothing should move.
    const published = records.map((entry) => {
      const prediction = predictMatch({ home: entry.home, away: entry.away, hasEnoughData: true })
      return { ...entry, prediction: { ...entry.prediction, probabilitiesExact: prediction.probabilitiesExact } }
    })
    const [same] = scoreChallengers(published, [{ id: 'same', label: 'Same settings', note: 'identical', model: {} }])
    expect(same.count).toBe(4)
    expect(same.meanDelta).toBeCloseTo(0, 12)
    expect(same.z).toBe(0)
    expect(same.significant).toBe(false)
  })

  it('keeps both scores on the same match and never rewrites the record', () => {
    const original = structuredClone(records)
    const scored = scoreChallengers(records)
    expect(scored).toHaveLength(4)
    for (const challenger of scored) {
      expect(challenger.better + challenger.worse + challenger.unchanged).toBe(4)
      expect(Number.isFinite(challenger.meanDelta)).toBe(true)
      expect(Number.isFinite(challenger.z)).toBe(true)
    }
    expect(records).toEqual(original)
    expect(scoreChallengers([])).toEqual([])
  })
})

describe('promotion gate', () => {
  it('refuses to change the model before the sample is large enough', () => {
    expect(reviewVerdict({ evaluated: 0, challengers: [] }).state).toBe('empty')
    const collecting = reviewVerdict({ evaluated: 40, challengers: [] })
    expect(collecting.state).toBe('collecting')
    expect(collecting.detail).toContain(String(REVIEW_MIN_SAMPLE))
  })

  it('only rewards a challenger that clears both the sample and the significance gate', () => {
    const challenger = { label: 'Bigger home edge', meanDelta: -0.02, z: -2.4, count: REVIEW_MIN_SAMPLE }
    expect(reviewVerdict({ evaluated: REVIEW_MIN_SAMPLE, challengers: [challenger] })).toMatchObject({ state: 'candidate' })
    const noisy = { ...challenger, z: -1.2 }
    expect(reviewVerdict({ evaluated: REVIEW_MIN_SAMPLE, challengers: [noisy] }).state).toBe('hold')
    const backwards = { ...challenger, meanDelta: 0.03, z: 2.6 }
    expect(reviewVerdict({ evaluated: REVIEW_MIN_SAMPLE, challengers: [backwards] }).state).toBe('hold')
  })
})

describe('review model', () => {
  it('summarises the champion scores from stored probabilities', () => {
    const review = reviewModel(ledger([record('a', { goals: [2, 0] }), record('b', { goals: [0, 1] })]))
    expect(review.evidence).toBe(2)
    expect(review.champion.correct).toBe(1)
    expect(review.champion.brier).toBeCloseTo(0.695, 12)
    expect(review.markets.straight.bets).toBe(2)
    expect(review.verdict.state).toBe('collecting')
  })

  it('matches the published model exactly when it is re-scored fresh', () => {
    const fresh = predictMatch({ home: team('H', 2, 0.8, ['W', 'W', 'D']), away: team('A', 0.9, 1.8, ['L', 'L', 'W']), hasEnoughData: true })
    const stored = record('fresh', { probabilities: fresh.probabilitiesExact })
    const [same] = scoreChallengers([stored], [{ id: 'same', label: 'Same', model: {} }])
    expect(same.meanDelta).toBeCloseTo(0, 12)
  })

  it('returns an empty review for a preview ledger', () => {
    const review = reviewModel(ledger([record('a')], 'local-preview'))
    expect(review.evidence).toBe(0)
    expect(review.verdict.state).toBe('empty')
    expect(review.challengers).toEqual([])
  })
})
