import { useMemo } from 'react'
import { Gauge, FlaskConical } from 'lucide-react'
import { PROMOTION_Z, REVIEW_MIN_SAMPLE, reviewModel } from '../lib/modelReview.js'

const percent = (value) => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`)
const count = (value) => value.toLocaleString()

// Say which way the model leans, in words, instead of printing a bare sign.
function biasDetail(bias) {
  if (bias.bias === null) return 'No scored picks yet'
  const points = Math.abs(bias.bias * 100).toFixed(1)
  if (bias.state === 'overconfident') return `${points} pts above reality`
  if (bias.state === 'underconfident') return `${points} pts below reality`
  return `${points} pts — inside noise`
}

const CALIBRATION_LABELS = Object.freeze({ calibrated: 'CALIBRATED', overconfident: 'OVERCONFIDENT', underconfident: 'UNDERCONFIDENT' })

const VERDICT_LABELS = Object.freeze({
  candidate: 'TRIAL EARNED',
  hold: 'NO CHANGE',
  collecting: 'COLLECTING',
  empty: 'AWAITING RESULTS',
})

function MarketRow({ label, note, market, highlight = false }) {
  const settled = market.settled ?? market.bets
  return (
    <tr className={highlight ? 'is-highlight' : undefined}>
      <th scope="row">{label}<small>{note}</small></th>
      <td>{count(market.bets)}</td>
      <td>{count(market.wins)}</td>
      <td>{market.pushes === undefined ? '—' : count(market.pushes)}</td>
      <td>{count(market.losses)}</td>
      <td><strong>{percent(market.hitRate)}</strong><span className="model-review__bar" aria-hidden="true"><i style={{ width: `${(market.hitRate ?? 0) * 100}%` }} /></span><small>{count(settled)} settled</small></td>
    </tr>
  )
}

export default function ModelReview({ tracker }) {
  const review = useMemo(() => reviewModel(tracker), [tracker])
  const { champion, markets, bands, bias, challengers, verdict, evidence } = review
  const progress = Math.min(100, (evidence / REVIEW_MIN_SAMPLE) * 100)
  const hasResults = evidence > 0

  return (
    <section className="model-review" id="model-review" aria-labelledby="model-review-title">
      <div className="model-review__heading">
        <div>
          <div className="performance__kicker"><FlaskConical size={15} aria-hidden="true" /> THE SELF-REVIEW</div>
          <h3 id="model-review-title">MODEL REVIEW<span aria-hidden="true">.</span></h3>
          <p>The published model auditing itself: how often its picks land, whether its probabilities are honest, and whether a different setting would have scored better on the same matches.</p>
        </div>
        <div className="model-review__sample">
          <Gauge size={15} aria-hidden="true" />
          <span>{count(evidence)} / {REVIEW_MIN_SAMPLE} SCORED</span>
          <div className="model-review__progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
        </div>
      </div>

      <div className={`model-review__verdict is-${verdict.state}`} role="status">
        <span>{VERDICT_LABELS[verdict.state] ?? 'REVIEW'}</span>
        <strong>{verdict.headline}</strong>
        <p>{verdict.detail}</p>
      </div>

      {hasResults ? (
        <>
          <div className="model-review__champion">
            <div><span>PICKS CORRECT</span><strong>{percent(champion.accuracy)}</strong><small>{count(champion.correct)} of {count(evidence)} scored</small></div>
            <div><span>BRIER SCORE</span><strong>{champion.brier.toFixed(3)}</strong><small>0 perfect · 2 worst</small></div>
            <div><span>LOG LOSS</span><strong>{champion.logLoss.toFixed(3)}</strong><small>Punishes confident misses</small></div>
            <div><span>CALIBRATION</span><strong>{CALIBRATION_LABELS[bias.state] ?? '—'}</strong><small>{biasDetail(bias)}</small></div>
          </div>

          <div className="model-review__grid">
            <div className="model-review__panel">
              <div className="performance__subheading"><div><span>01 / SAME PICKS, DIFFERENT MARKETS</span><h4>WIN, +0.5 AND +1</h4></div></div>
              <table className="calibration-table model-review__table">
                <caption className="sr-only">Each recorded pick scored as a straight win, as a double chance (+0.5) and as a one-goal handicap (+1)</caption>
                <thead><tr><th scope="col">Market</th><th scope="col">Picks</th><th scope="col">Won</th><th scope="col">Pushed</th><th scope="col">Lost</th><th scope="col">Hit rate</th></tr></thead>
                <tbody>
                  <MarketRow label="Straight win" note="1X2 on the recorded pick" market={markets.straight} highlight />
                  <MarketRow label="+0.5" note="Win or draw" market={markets.doubleChance} />
                  <MarketRow label="+1" note="Refund if they lose by one" market={markets.handicap} />
                </tbody>
              </table>
              <p className="model-review__note">{markets.doubleChance.skipped > 0 ? `Draw picks have no side to defend, so ${count(markets.doubleChance.skipped)} of them are left out of +0.5 and +1. ` : ''}A push returns the stake and is excluded from the hit rate rather than counted as a win.</p>
            </div>

            <div className="model-review__panel">
              <div className="performance__subheading"><div><span>02 / STATED VS ACTUAL</span><h4>CONFIDENCE BANDS</h4></div></div>
              <table className="calibration-table model-review__table">
                <caption className="sr-only">Average stated probability for the picked outcome compared with how often it happened</caption>
                <thead><tr><th scope="col">Stated</th><th scope="col">Picks</th><th scope="col">Average</th><th scope="col">Happened</th><th scope="col">Gap</th></tr></thead>
                <tbody>{bands.map((band) => <tr key={band.label}>
                  <th scope="row">{band.label}</th>
                  <td>{count(band.count)}</td>
                  <td>{percent(band.meanForecast)}</td>
                  <td>{percent(band.observedRate)}</td>
                  <td>{band.count ? `${band.observedRate >= band.meanForecast ? '+' : ''}${((band.observedRate - band.meanForecast) * 100).toFixed(1)}` : '—'}</td>
                </tr>)}</tbody>
              </table>
              <p className="model-review__note">A positive gap means the picks landed more often than the model claimed. Bands with a handful of picks swing wildly; the verdict above uses the whole record with a {REVIEW_MIN_SAMPLE}-pick gate.</p>
            </div>
          </div>

          <div className="model-review__panel model-review__panel--wide">
            <div className="performance__subheading"><div><span>03 / WOULD ANOTHER SETTING DO BETTER?</span><h4>SHADOW MODELS</h4></div></div>
            <table className="calibration-table model-review__table">
              <caption className="sr-only">Alternative model settings re-scored on the same settled matches, compared with the recorded probabilities</caption>
              <thead><tr><th scope="col">Setting</th><th scope="col">Brier change</th><th scope="col">Better</th><th scope="col">Worse</th><th scope="col">z</th><th scope="col">Status</th></tr></thead>
              <tbody>{challengers.map((challenger) => {
                const status = challenger.significant && challenger.meanDelta < 0
                  ? 'BEATS PUBLISHED'
                  : challenger.significant && challenger.meanDelta > 0 ? 'WORSE' : 'INSIDE NOISE'
                return <tr key={challenger.id}>
                  <th scope="row">{challenger.label}<small>{challenger.note}</small></th>
                  <td>{(-challenger.meanDelta >= 0 ? '+' : '')}{(-challenger.meanDelta).toFixed(3)}</td>
                  <td>{count(challenger.better)}</td>
                  <td>{count(challenger.worse)}</td>
                  <td>{challenger.z.toFixed(1)}</td>
                  <td><span className={`model-review__chip${challenger.significant ? ' is-significant' : ''}`}>{status}</span></td>
                </tr>
              })}</tbody>
            </table>
            <p className="model-review__note">A positive Brier change means the shadow setting was closer to the truth. These are counterfactuals re-run on stored team stats, never new forecasts — the published pick is not rewritten. Promotion needs {REVIEW_MIN_SAMPLE}+ scored picks and |z| ≥ {PROMOTION_Z}, so a lucky month cannot change the model.</p>
            <a className="track-history-link" href="https://github.com/johnAzani/Match_predictor/blob/main/MODEL_CHANGELOG.md">Read the model changelog and promotion rule</a>
          </div>
        </>
      ) : (
        <div className="performance__empty">
          <strong>{tracker?.publication === 'github-pages' ? 'WAITING FOR THE FIRST RESULT' : 'PUBLISHED RESULTS ONLY'}</strong>
          <p>{tracker?.publication === 'github-pages'
            ? 'The review begins once a published forecast has been verified and its result is available.'
            : 'Local-preview forecasts are not published or verified, so they are not reviewed. No earlier forecasts are invented to fill the table.'}</p>
        </div>
      )}
    </section>
  )
}
