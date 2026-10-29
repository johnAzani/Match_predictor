const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))

export function formPoints(form) {
  return form.reduce((points, result) => points + (result === 'W' ? 3 : result === 'D' ? 1 : 0), 0)
}

// The inputs are simple per-match averages, not real-time statistics.
// A team's form adjusts its estimated scoring rate by at most +/- 10%.
function expectedGoals(team, opponent, homeAdvantage) {
  const formMultiplier = 0.9 + (formPoints(team.form) / (team.form.length * 3 || 1)) * 0.2
  return clamp(((team.goalsFor + opponent.goalsAgainst) / 2) * formMultiplier * homeAdvantage, 0.2, 3.8)
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

export function predictMatch(fixture) {
  const homeGoals = expectedGoals(fixture.home, fixture.away, 1.1)
  const awayGoals = expectedGoals(fixture.away, fixture.home, 0.94)
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
