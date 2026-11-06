const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))

export function formPoints(form) {
  return form.reduce((points, result) => points + (result === 'W' ? 3 : result === 'D' ? 1 : 0), 0)
}

// The published model. The model review re-runs these knobs against the
// recorded ledger, so a change has to be measured before it is promoted.
export const DEFAULT_MODEL = Object.freeze({ homeAdvantage: 1.1, awayAdvantage: 0.94, formWeight: 0.2 })

// The inputs are simple per-match averages, not real-time statistics.
// Form weight 0.2 adjusts a team's estimated scoring rate by at most +/- 10%.
function expectedGoals(team, opponent, advantage, formWeight) {
  const formMultiplier = 0.9 + (formPoints(team.form) / (team.form.length * 3 || 1)) * formWeight
  return clamp(((team.goalsFor + opponent.goalsAgainst) / 2) * formMultiplier * advantage, 0.2, 3.8)
}

function poissonSeries(rate, maxGoals = 10) {
  const probabilities = [Math.exp(-rate)]
  for (let goals = 1; goals <= maxGoals; goals += 1) {
    probabilities.push((probabilities[goals - 1] * rate) / goals)
  }
  return probabilities
}

// Largest-remainder rounding keeps the three visible percentages adding to 100.
export function roundPercentages(values) {
  const scaled = values.map((value) => value * 100)
  const rounded = scaled.map(Math.floor)
  let remaining = 100 - rounded.reduce((sum, value) => sum + value, 0)
  const order = scaled.map((value, index) => ({ index, remainder: value - rounded[index] }))
    .sort((a, b) => b.remainder - a.remainder)
  for (let index = 0; index < remaining; index += 1) rounded[order[index % order.length].index] += 1
  return rounded
}

export function hasPredictionData(fixture) {
  return fixture.hasEnoughData !== false && [fixture.home, fixture.away].every((team) =>
    team && Number.isFinite(team.goalsFor) && Number.isFinite(team.goalsAgainst) && Array.isArray(team.form) && team.form.length > 0,
  )
}

export function predictWithModel(fixture, model) {
  const { homeAdvantage, awayAdvantage, formWeight } = { ...DEFAULT_MODEL, ...model }
  const homeGoals = expectedGoals(fixture.home, fixture.away, homeAdvantage, formWeight)
  const awayGoals = expectedGoals(fixture.away, fixture.home, awayAdvantage, formWeight)
  const homeScores = poissonSeries(homeGoals)
  const awayScores = poissonSeries(awayGoals)
  const outcomes = [0, 0, 0]
  let total = 0
  let likelyScore = { home: 0, away: 0, probability: 0 }

  homeScores.forEach((homeProbability, home) => {
    awayScores.forEach((awayProbability, away) => {
      const probability = homeProbability * awayProbability
      total += probability
      outcomes[home > away ? 0 : home === away ? 1 : 2] += probability
      if (probability > likelyScore.probability) likelyScore = { home, away, probability }
    })
  })

  const exact = outcomes.map((value) => value / total)
  const [home, draw, away] = roundPercentages(exact)
  const choices = [
    { key: 'home', label: 'Home win', team: fixture.home, percent: home },
    { key: 'draw', label: 'Draw', team: null, percent: draw },
    { key: 'away', label: 'Away win', team: fixture.away, percent: away },
  ]
  const highestPercent = Math.max(home, draw, away)
  const strongest = choices.filter((choice) => choice.percent === highestPercent)
  // Do not claim a winner when the displayed percentages are tied after rounding.
  const lean = strongest.length === 1 ? strongest[0] : { key: 'tie', label: 'No clear lean', team: null, percent: highestPercent }
  return {
    probabilities: { home, draw, away },
    probabilitiesExact: { home: exact[0], draw: exact[1], away: exact[2] },
    expectedGoals: { home: homeGoals, away: awayGoals }, likelyScore, lean,
  }
}

// The published model is the default, so a fixture prediction can never depend
// on a caller remembering to pass the same knobs.
export function predictMatch(fixture) {
  return predictWithModel(fixture)
}
