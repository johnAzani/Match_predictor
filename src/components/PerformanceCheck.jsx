import { useMemo, useState } from 'react'
import { BarChart3, Target } from 'lucide-react'
import { CALIBRATION_VIEWS, summarizeProspectivePerformance } from '../lib/prospectivePerformance.js'

const percent = (value) => value === null ? '—' : `${(value * 100).toFixed(1)}%`
const matchLabel = (count) => `${count.toLocaleString()} scored ${count === 1 ? 'match' : 'matches'}`

function ComparisonCard({ label, rate, correct, total, preview, baseline = false }) {
  return <div className={`performance-comparison__card${baseline ? ' is-baseline' : ''}`}>
    <span>{label}</span>
    <strong>{percent(rate)}</strong>
    <small>{preview ? 'Not available in preview' : total ? `${correct.toLocaleString()} of ${total.toLocaleString()} correct` : 'No verified results yet'}</small>
    <div className="performance-comparison__bar" aria-hidden="true"><span style={{ width: `${(rate ?? 0) * 100}%` }} /></div>
  </div>
}

function CalibrationTable({ bands, view }) {
  return <table className="calibration-table">
    <caption className="sr-only">Calibration for {view}: average forecast probability compared with observed frequency</caption>
    <thead><tr><th scope="col">Probability band</th><th scope="col">Chances</th><th scope="col">Avg forecast</th><th scope="col">Happened</th></tr></thead>
    <tbody>{bands.map((band) => <tr key={band.label}>
      <th scope="row">{band.label}</th>
      <td>{band.count.toLocaleString()}</td>
      <td><span>{percent(band.meanForecast)}</span><span className="calibration-table__bar" aria-hidden="true"><i style={{ width: `${(band.meanForecast ?? 0) * 100}%` }} /></span></td>
      <td><span>{percent(band.observedRate)}</span>{band.count > 0 && <small>{band.occurred.toLocaleString()} of {band.count.toLocaleString()}</small>}<span className="calibration-table__bar is-observed" aria-hidden="true"><i style={{ width: `${(band.observedRate ?? 0) * 100}%` }} /></span></td>
    </tr>)}</tbody>
  </table>
}

export default function PerformanceCheck({ tracker }) {
  const [view, setView] = useState('all')
  const performance = useMemo(() => summarizeProspectivePerformance(tracker), [tracker])
  const preview = tracker.publication !== 'github-pages'
  const selected = CALIBRATION_VIEWS.find((option) => option.id === view)
  const hasResults = performance.evaluated > 0

  return <section className="performance" aria-labelledby="performance-title">
    <div className="performance__heading">
      <div><div className="performance__kicker"><BarChart3 size={15} aria-hidden="true" /> THE FORWARD TEST</div><h3 id="performance-title">THE PERFORMANCE CHECK<span aria-hidden="true">.</span></h3><p>How do the recorded picks and their probabilities hold up after the final whistle?</p></div>
      <div className="performance__sample"><Target size={15} aria-hidden="true" /><span>{preview ? 'LOCAL PREVIEW' : matchLabel(performance.evaluated).toUpperCase()}</span></div>
    </div>

    <div className="performance__comparison">
      <div className="performance-comparison">
        <div className="performance__subheading"><div><span>01 / SAME MATCHES, TWO APPROACHES</span><h4>MODEL VS. ALWAYS HOME</h4></div></div>
        <div className="performance-comparison__cards">
          <ComparisonCard label="MODEL PICKS" rate={performance.accuracy} correct={performance.correct} total={performance.evaluated} preview={preview} />
          <ComparisonCard label="ALWAYS HOME" rate={performance.baselineAccuracy} correct={performance.baselineCorrect} total={performance.evaluated} preview={preview} baseline />
        </div>
        <p className="performance__note">Always home is a fixed rule that picks the home team in every scored match—not a second set of published forecasts. Both rates use the same verified results.</p>
      </div>
      <div className="performance-brier">
        <span>PROBABILITY ERROR</span>
        <strong>{performance.brier === null ? '—' : performance.brier.toFixed(3)}</strong>
        <b>BRIER SCORE · LOWER IS BETTER</b>
        <p>Measures all three probabilities together: 0 is perfect and 2 is worst. It reflects overall error, not calibration alone.</p>
      </div>
    </div>

    <div className="calibration">
      <div className="performance__subheading"><div><span>02 / PROBABILITIES VS. REALITY</span><h4>HOW WELL CALIBRATED?</h4></div></div>
      <p className="calibration__intro">A well-calibrated set of probabilities tends to match how often those outcomes happen. Compare the average forecast with the observed frequency in each band. Bands use saved, unrounded probabilities; values shown are rounded.</p>
      {hasResults ? <>
        <div className="calibration__controls" role="group" aria-label="Filter calibration by outcome">
          <span aria-hidden="true">VIEW</span>
          {CALIBRATION_VIEWS.map((option) => <button type="button" key={option.id} aria-pressed={view === option.id} onClick={() => setView(option.id)}>{option.label}</button>)}
        </div>
        <p className="calibration__context" aria-live="polite">{view === 'all' ? 'Each match contributes three related chances: home win, draw and away win. These counts are not independent matches; inspect each outcome separately too.' : 'Each scored match contributes one chance for the selected outcome.'} Bands include their lower limit; 100% is included in the final band.</p>
        <CalibrationTable bands={performance.calibration[view]} view={selected.label.toLowerCase()} />
      </> : <div className="performance__empty"><strong>{preview ? 'PUBLISHED RESULTS ONLY' : 'WAITING FOR THE FIRST RESULT'}</strong><p>{preview ? 'Local-preview forecasts are not published or verified, so they are not included in this comparison.' : 'Calibration will appear once a published forecast has been verified and its result is available. No earlier predictions are invented.'}</p></div>}
      <p className="performance__caveat">Small samples and sparsely populated bands can swing sharply. These figures are descriptive, not proof of future performance. Results may change if the source corrects a score.</p>
    </div>
  </section>
}
