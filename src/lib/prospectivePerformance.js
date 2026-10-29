import { outcome } from './tracker.js'

export const CALIBRATION_VIEWS = Object.freeze([
  { id: 'all', label: 'All outcomes' },
  { id: 'home', label: 'Home wins' },
  { id: 'draw', label: 'Draws' },
  { id: 'away', label: 'Away wins' },
])

const OUTCOMES = ['home', 'draw', 'away']
const BAND_LABELS = ['0–<20%', '20–<40%', '40–<60%', '60–<80%', '80–100%']

function newBands() {
  return BAND_LABELS.map((label) => ({ label, count: 0, predictedSum: 0, occurred: 0 }))
}

function addChance(bands, probability, happened) {
  // Bands are left-inclusive and right-exclusive, except the last includes 1.
  const band = bands[Math.min(4, Math.floor(probability * 5))]
  band.count += 1
  band.predictedSum += probability
  band.occurred += Number(happened)
}

function finishBands(bands) {
  return bands.map(({ label, count, predictedSum, occurred }) => ({
    label, count, occurred,
    meanForecast: count ? predictedSum / count : null,
    observedRate: count ? occurred / count : null,
  }))
}

// Called with the validated tracker from useTrackRecord. Local previews are
// deliberately excluded: only published, re-observed forecasts are evidence.
export function summarizeProspectivePerformance(tracker) {
  const bands = { all: newBands(), home: newBands(), draw: newBands(), away: newBands() }
  let evaluated = 0, correct = 0, baselineCorrect = 0, brierSum = 0
  if (tracker.publication === 'github-pages') for (const record of tracker.records) {
    if (!record.result || record.excludedReason || !record.verifiedAt) continue
    const actual = outcome(record.result)
    evaluated += 1
    correct += Number(record.prediction.pick === actual)
    // This fixed rule is evaluated against the same matches, not stored as a
    // second set of purportedly published historical forecasts.
    baselineCorrect += Number(actual === 'home')
    for (const key of OUTCOMES) {
      const probability = record.prediction.probabilitiesExact[key]
      const happened = actual === key
      brierSum += (probability - Number(happened)) ** 2
      addChance(bands.all, probability, happened)
      addChance(bands[key], probability, happened)
    }
  }
  return {
    evaluated, correct, baselineCorrect,
    accuracy: evaluated ? correct / evaluated : null,
    baselineAccuracy: evaluated ? baselineCorrect / evaluated : null,
    // Three-class Brier score: sum over outcomes, then average over matches.
    brier: evaluated ? brierSum / evaluated : null,
    calibration: Object.fromEntries(Object.entries(bands).map(([key, value]) => [key, finishBands(value)])),
  }
}
