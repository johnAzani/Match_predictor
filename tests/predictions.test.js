import { describe, expect, it } from 'vitest'
import { fixtures } from '../src/data/fixtures.js'
import { formPoints, predictMatch, roundPercentages } from '../src/lib/predictions.js'

describe('the demo prediction model', () => {
  it('gives every sample fixture bounded outcomes that add to 100%', () => {
    for (const fixture of fixtures) {
      const prediction = predictMatch(fixture)
      const values = Object.values(prediction.probabilities)
      expect(values.reduce((sum, value) => sum + value, 0)).toBe(100)
      values.forEach((value) => expect(value).toBeGreaterThanOrEqual(0))
      values.forEach((value) => expect(value).toBeLessThanOrEqual(100))
      expect(prediction.expectedGoals.home).toBeGreaterThan(0)
      expect(prediction.expectedGoals.away).toBeGreaterThan(0)
      expect(prediction.likelyScore.home).toBeGreaterThanOrEqual(0)
      expect(prediction.likelyScore.away).toBeGreaterThanOrEqual(0)
      expect(prediction.lean.percent).toBe(Math.max(...values))
    }
  })

  it('uses the largest remainder to keep rounded probabilities consistent', () => {
    expect(roundPercentages([0.3333, 0.3333, 0.3334])).toEqual([33, 33, 34])
    expect(roundPercentages([0.505, 0.245, 0.25]).reduce((a, b) => a + b)).toBe(100)
  })

  it('does not claim a winner when the displayed top outcomes are tied', () => {
    const fixture = fixtures.find((match) => match.id === 'milan-napoli')
    const result = predictMatch(fixture)
    expect(result.probabilities.home).toBe(result.probabilities.away)
    expect(result.lean.key).toBe('tie')
  })

  it('counts recent form and gives otherwise identical sides a home adjustment', () => {
    expect(formPoints(['W', 'D', 'L', 'W', 'D'])).toBe(8)
    const team = { goalsFor: 1.7, goalsAgainst: 1.2, form: ['W', 'D', 'L', 'W', 'D'] }
    const result = predictMatch({ home: team, away: team })
    expect(result.expectedGoals.home).toBeGreaterThan(result.expectedGoals.away)
    expect(result.probabilities.home).toBeGreaterThan(result.probabilities.away)
  })
})
