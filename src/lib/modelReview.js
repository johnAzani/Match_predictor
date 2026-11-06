import { predictWithModel } from './predictions.js'
import { outcome } from './tracker.js'

// A model change is only considered once the published record can tell a real
// improvement apart from luck. Both numbers are fixed, public and deliberately
// conservative: 100 scored picks and two standard errors.
export const REVIEW_MIN_SAMPLE = 100
export const PROMOTION_Z = 2

const OUTCOMES = ['home', 'draw', 'away']

// Shadow models. They are re-scored on the matches already in the ledger, so
// they never enter the record as forecasts. The published pick stays poisson-v1
// until one of these clears the promotion gate.
export const CHALLENGERS = Object.freeze([
  { id: 'flat-advantage', label: 'No home edge', note: 'Home and away treated the same', model: { homeAdvantage: 1, awayAdvantage: 1 } },
  { id: 'home-edge-1.20', label: 'Bigger home edge', note: 'Home advantage raised to 1.20', model: { homeAdvantage: 1.2, awayAdvantage: 0.94 } },
  { id: 'form-off', label: 'Ignore recent form', note: 'Form weight set to zero', model: { formWeight: 0 } },
  { id: 'form-strong', label: 'Heavier form weight', note: 'Form can move the rate by ±20%', model: { formWeight: 0.4 } },
])

export const CONFIDENCE_BANDS = Object.freeze([
  { label: 'Under 50%', from: 0, to: 0.5 },
  { label: '50–<60%', from: 0.5, to: 0.6 },
  { label: '60–<70%', from: 0.6, to: 0.7 },
  { label: '70–<80%', from: 0.7, to: 0.8 },
  { label: '80%+', from: 0.8, to: 1.01 },
])

const brier = (probabilities, actual) => OUTCOMES.reduce(
  (total, key) => total + (probabilities[key] - Number(key === actual)) ** 2,
  0,
)

const logLoss = (probabilities, actual) => -Math.log(Math.min(1, Math.max(1e-12, probabilities[actual])))

// Match the forward test exactly: published forecasts that were verified before
// kick-off and have an unambiguous result. Local previews are not evidence.
export function evidenceRecords(tracker) {
  if (!tracker || tracker.publication !== 'github-pages' || !Array.isArray(tracker.records)) return []
  return tracker.records.filter((record) => record.result && !record.excludedReason && Boolean(record.verifiedAt))
}

const percentage = (wins, settled) => (settled ? wins / settled : null)

// The same picks, priced three ways. "Safer" markets are measured, not assumed:
// a draw is a win on +0.5, and a one-goal defeat only returns the stake on +1.
export function marketBreakdown(records) {
  const tally = {
    straight: { bets: 0, wins: 0, losses: 0 },
    doubleChance: { bets: 0, wins: 0, losses: 0, skipped: 0 },
    handicap: { bets: 0, wins: 0, pushes: 0, losses: 0, skipped: 0 },
  }
  for (const record of records) {
    const actual = outcome(record.result)
    const pick = record.prediction.pick
    tally.straight.bets += 1
    if (pick === actual) tally.straight.wins += 1
    else tally.straight.losses += 1
    // A draw pick has no double-chance or handicap side to defend.
    if (pick === 'draw') {
      tally.doubleChance.skipped += 1
      tally.handicap.skipped += 1
      continue
    }
    const margin = pick === 'home'
      ? record.result.homeGoals - record.result.awayGoals
      : record.result.awayGoals - record.result.homeGoals
    tally.doubleChance.bets += 1
    if (margin >= 0) tally.doubleChance.wins += 1
    else tally.doubleChance.losses += 1
    tally.handicap.bets += 1
    if (margin >= 0) tally.handicap.wins += 1
    else if (margin === -1) tally.handicap.pushes += 1
    else tally.handicap.losses += 1
  }
  return {
    straight: { ...tally.straight, hitRate: percentage(tally.straight.wins, tally.straight.bets) },
    doubleChance: {
      ...tally.doubleChance,
      settled: tally.doubleChance.wins + tally.doubleChance.losses,
      hitRate: percentage(tally.doubleChance.wins, tally.doubleChance.wins + tally.doubleChance.losses),
    },
    handicap: {
      ...tally.handicap,
      settled: tally.handicap.wins + tally.handicap.losses,
      hitRate: percentage(tally.handicap.wins, tally.handicap.wins + tally.handicap.losses),
    },
  }
}

// Does a 60% pick happen 60% of the time? Each band compares the average
// stated probability with the share of those picks that actually landed.
export function confidenceBands(records) {
  const bands = CONFIDENCE_BANDS.map(({ label }) => ({ label, count: 0, predictedSum: 0, wins: 0 }))
  for (const record of records) {
    const confidence = record.prediction.probabilitiesExact[record.prediction.pick]
    const index = Math.min(bands.length - 1, Math.max(0, CONFIDENCE_BANDS.findIndex(
      (band) => confidence >= band.from && confidence < band.to,
    )))
    bands[index].count += 1
    bands[index].predictedSum += confidence
    bands[index].wins += Number(record.prediction.pick === outcome(record.result))
  }
  return bands.map((band) => ({
    label: band.label,
    count: band.count,
    wins: band.wins,
    meanForecast: band.count ? band.predictedSum / band.count : null,
    observedRate: band.count ? band.wins / band.count : null,
  }))
}

// A single signed number for the whole record: positive means the picks land
// less often than the model claims.
export function confidenceBias(records) {
  if (!records.length) return { bias: null, tolerance: null, state: 'unknown' }
  let predicted = 0
  let wins = 0
  for (const record of records) {
    predicted += record.prediction.probabilitiesExact[record.prediction.pick]
    wins += Number(record.prediction.pick === outcome(record.result))
  }
  const mean = predicted / records.length
  const observed = wins / records.length
  const bias = mean - observed
  const tolerance = 1.96 * Math.sqrt((mean * (1 - mean)) / records.length)
  const state = bias > tolerance ? 'overconfident' : bias < -tolerance ? 'underconfident' : 'calibrated'
  return { bias, tolerance, mean, observed, state }
}

// Re-run a shadow model over the settled matches and compare its Brier score
// with the probability set that was actually recorded. Deltas are paired: both
// scores come from the same match, so only the model differs.
export function scoreChallengers(records, challengers = CHALLENGERS) {
  if (!records.length) return []
  return challengers.map((challenger) => {
    const deltas = []
    let better = 0
    let worse = 0
    for (const record of records) {
      const actual = outcome(record.result)
      const champion = brier(record.prediction.probabilitiesExact, actual)
      const shadow = predictWithModel(
        { home: record.home, away: record.away, hasEnoughData: true },
        challenger.model,
      )
      const delta = brier(shadow.probabilitiesExact, actual) - champion
      deltas.push(delta)
      if (delta < -1e-12) better += 1
      else if (delta > 1e-12) worse += 1
    }
    const count = deltas.length
    const mean = deltas.reduce((total, value) => total + value, 0) / count
    const variance = count > 1
      ? deltas.reduce((total, value) => total + (value - mean) ** 2, 0) / (count - 1)
      : 0
    const standardError = count > 1 ? Math.sqrt(variance / count) : 0
    const z = standardError > 0 ? mean / standardError : 0
    return {
      id: challenger.id,
      label: challenger.label,
      note: challenger.note,
      count,
      better,
      worse,
      unchanged: count - better - worse,
      meanDelta: mean,
      z,
      // Negative delta means the shadow model scored closer to the truth.
      improvement: -mean,
      significant: Math.abs(z) >= PROMOTION_Z,
    }
  }).sort((a, b) => a.meanDelta - b.meanDelta)
}

export function reviewVerdict({ evaluated, challengers }) {
  if (!evaluated) {
    return {
      state: 'empty',
      headline: 'NOTHING SCORED YET',
      detail: 'The review starts once published forecasts have been verified and their results are in. No earlier forecasts are reconstructed to fill the gap.',
    }
  }
  if (evaluated < REVIEW_MIN_SAMPLE) {
    return {
      state: 'collecting',
      headline: 'KEEP COLLECTING',
      detail: `${evaluated} of ${REVIEW_MIN_SAMPLE} scored picks needed before a model change can be justified. Shadow models are measured below, but none of them can be promoted yet.`,
    }
  }
  // Significance is derived here from the reported z, not trusted from a flag.
  const candidate = challengers.find((challenger) => challenger.meanDelta < 0 && Math.abs(challenger.z) >= PROMOTION_Z)
  if (candidate) {
    return {
      state: 'candidate',
      headline: 'A CANDIDATE HAS EARNED A TRIAL',
      detail: `"${candidate.label}" scored better on ${candidate.count} scored picks by ${(-candidate.meanDelta).toFixed(3)} Brier points (z ${candidate.z.toFixed(1)}). That is enough to trial it as a new version, not to rewrite the record.`,
      challenger: candidate,
    }
  }
  const best = challengers[0]
  return {
    state: 'hold',
    headline: 'THE PUBLISHED MODEL STAYS',
    detail: best
      ? `No shadow model clears the gate. The closest, "${best.label}", moved the Brier score by ${(-best.meanDelta >= 0 ? '+' : '')}${(-best.meanDelta).toFixed(3)} points (z ${best.z.toFixed(1)}), which is inside the noise of ${evaluated} scored picks.`
      : `No shadow model clears the gate at ${evaluated} scored picks.`,
  }
}

export function reviewModel(tracker) {
  const records = evidenceRecords(tracker)
  let brierSum = 0
  let logSum = 0
  let correct = 0
  for (const record of records) {
    const actual = outcome(record.result)
    brierSum += brier(record.prediction.probabilitiesExact, actual)
    logSum += logLoss(record.prediction.probabilitiesExact, actual)
    correct += Number(record.prediction.pick === actual)
  }
  const challengers = scoreChallengers(records)
  return {
    evidence: records.length,
    minimum: REVIEW_MIN_SAMPLE,
    champion: {
      correct,
      accuracy: records.length ? correct / records.length : null,
      brier: records.length ? brierSum / records.length : null,
      logLoss: records.length ? logSum / records.length : null,
    },
    markets: marketBreakdown(records),
    bands: confidenceBands(records),
    bias: confidenceBias(records),
    challengers,
    verdict: reviewVerdict({ evaluated: records.length, challengers }),
  }
}
