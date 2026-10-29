import { useEffect, useRef } from 'react'
import { ArrowRight, BarChart3, House, Lightbulb, X } from 'lucide-react'
import { CountryFlag, Crest, FormGuide, ProbabilityBar, ProbabilityLabels } from './Shared.jsx'

function Modal({ children, onClose, titleId, className = '' }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const originalOverflow = document.body.style.overflow
    const backdrop = panelRef.current?.closest('.modal-backdrop')
    const background = backdrop ? [...backdrop.parentElement.children].filter((element) => element !== backdrop) : []
    const inertStates = background.map((element) => element.hasAttribute('inert'))
    background.forEach((element) => element.setAttribute('inert', ''))
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') onCloseRef.current()
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = originalOverflow
      background.forEach((element, index) => { if (!inertStates[index]) element.removeAttribute('inert') })
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus()
    }
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef}>
        <button className="modal__close" ref={closeRef} type="button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
        {children}
      </section>
    </div>
  )
}

export function AnalysisDialog({ fixture, prediction, lockedAt, trackingStatus, onClose, isCommunity }) {
  const lean = prediction?.lean
  return (
    <Modal onClose={onClose} titleId="analysis-title" className="analysis-modal">
      <div className="modal-kicker"><CountryFlag country={fixture.league.country} /> {fixture.league.name} <span> / </span> {fixture.day} · {fixture.time} <span> / </span> {isCommunity ? 'COMMUNITY FIXTURE' : 'DEMO FIXTURE'}</div>
      <h2 id="analysis-title" className="modal-title">THE MATCH BREAKDOWN<span aria-hidden="true">.</span></h2>
      <p className="modal-subtitle">{lockedAt ? `This ${trackingStatus === 'preview' ? 'preview ' : ''}forecast and its inputs were recorded for tracking on ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(lockedAt))} UTC.` : isCommunity ? `A closer look at the recent league results behind this estimate. ${trackingStatus === 'loading' ? 'Tracking status is loading.' : trackingStatus === 'unavailable' ? 'Tracking status could not be checked.' : 'This estimate is not in active tracking.'}` : 'A closer look at what the sample numbers are saying.'}</p>

      <div className="dialog-matchup">
        <div className="dialog-team"><Crest team={fixture.home} /><strong>{fixture.home.name}</strong><span>HOME</span></div>
        <div className="dialog-score"><span>{prediction ? 'MOST LIKELY SCORE' : 'PREDICTION'}</span>{prediction ? <strong>{prediction.likelyScore.home}<i>:</i>{prediction.likelyScore.away}</strong> : <strong>—</strong>}<small>{prediction ? 'MODEL ESTIMATE' : 'NOT AVAILABLE'}</small></div>
        <div className="dialog-team"><Crest team={fixture.away} /><strong>{fixture.away.name}</strong><span>AWAY</span></div>
      </div>

      <div className="dialog-section">
        <div className="dialog-section__heading"><h3>THE THREE-WAY PICTURE</h3><span>{!lean ? 'MORE RESULTS NEEDED' : lean.key === 'tie' ? 'NO CLEAR LEAN' : `MODEL LEANS ${lean.team ? `${lean.team.shortName.toUpperCase()} WIN` : 'DRAW'}`}</span></div>
        {prediction ? <><ProbabilityBar probabilities={prediction.probabilities} /><ProbabilityLabels probabilities={prediction.probabilities} /><p className="dialog-note">The most likely individual score may differ from the overall winning outcome, which combines many possible scores.</p></> : <p className="dialog-note">We need at least three earlier league results for each team before calculating a prediction. Missing results are never replaced with invented statistics.</p>}
      </div>

      <div className="dialog-grid">
        <div className="dialog-stat">
          <div className="dialog-stat__top"><h3>RECENT FORM</h3><span>OLDEST → NEWEST</span></div>
          <div className="form-row"><span>{fixture.home.shortName}</span><FormGuide form={fixture.home.form} teamName={fixture.home.name} /></div>
          <div className="form-row"><span>{fixture.away.shortName}</span><FormGuide form={fixture.away.form} teamName={fixture.away.name} /></div>
        </div>
        <div className="dialog-stat">
          <div className="dialog-stat__top"><h3>{prediction ? 'ESTIMATED GOALS' : 'RESULTS AVAILABLE'}</h3><span>{prediction ? 'PER MATCH' : 'MIN. 3 EACH'}</span></div>
          <div className="estimate-row"><span>{fixture.home.shortName}</span><strong>{prediction ? prediction.expectedGoals.home.toFixed(1) : fixture.home.sampleSize ?? 0}</strong></div>
          <div className="estimate-row"><span>{fixture.away.shortName}</span><strong>{prediction ? prediction.expectedGoals.away.toFixed(1) : fixture.away.sampleSize ?? 0}</strong></div>
        </div>
      </div>
      <div className="modal-disclaimer"><Lightbulb size={16} aria-hidden="true" /><span>{isCommunity ? 'Community fixtures update daily, not live. Kick-off times are approximate UTC+1. Predictions are not guarantees or betting advice.' : 'Demo only. Fixtures, form and team statistics are illustrative, not live. Predictions are not guarantees or betting advice.'}</span></div>
    </Modal>
  )
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
}

export function MethodDialog({ onClose, isCommunity, report, source }) {
  return (
    <Modal onClose={onClose} titleId="method-title" className="method-modal">
      <div className="modal-kicker"><span className="kicker-spark">✳</span> THE PITCHSIDE PLAYBOOK</div>
      <h2 id="method-title" className="modal-title">THE MODEL, MINUS<br />THE MYSTERY<span aria-hidden="true">.</span></h2>
      <p className="modal-subtitle">Football can be unpredictable. Here’s how a few simple inputs become a clearer picture.</p>
      <div className="method-list">
        <div className="method-item"><span className="method-icon"><BarChart3 size={19} /></span><div><strong>01 &nbsp; FORM & GOALS</strong><p>{isCommunity ? 'We use up to the last 10 completed league matches in the current season, with a small adjustment for the last five results. Both teams need at least three earlier results.' : 'We start with illustrative goals scored and conceded per match, then make a small adjustment for each team’s last five results.'}</p></div></div>
        <div className="method-item"><span className="method-icon"><House size={19} /></span><div><strong>02 &nbsp; HOME ADVANTAGE</strong><p>A modest home-and-away adjustment gives us an estimated scoring rate for each side.</p></div></div>
        <div className="method-item"><span className="method-icon"><ArrowRight size={19} /></span><div><strong>03 &nbsp; THE THREE-WAY VIEW</strong><p>A Poisson model estimates possible scores. We add them up into home win, draw and away win probabilities.</p></div></div>
      </div>
      {isCommunity && report?.evaluated > 0 && <div className="method-results">
        <div className="method-results__heading">WALK-FORWARD BACKTEST <span>{report.evaluated.toLocaleString()} MATCHES</span></div>
        <div className="method-results__metrics"><div><strong>{pct(report.accuracy)}</strong><span>MODEL ACCURACY</span></div><div><strong>{pct(report.baselineAccuracy)}</strong><span>ALWAYS-HOME BASELINE</span></div><div><strong>{report.brier.toFixed(3)}</strong><span>MULTICLASS BRIER ↓</span></div></div>
        <p>{report.firstDate} to {report.lastDate}. Each match uses only results from earlier dates in the same league and season; {report.skipped.toLocaleString()} matches without enough history were skipped. Accuracy uses unrounded probabilities. Multiclass Brier and log loss ({report.logLoss.toFixed(3)}) are lower-is-better. The source may have gaps.</p>
        {Number.isInteger(source?.historicalLeagueCount) && <p>Previous-season results available for {source.historicalLeagueCount} of {source.availableLeagueCount} current leagues.</p>}
      </div>}
      {isCommunity && <p className="modal-sources">The track record is separate from this historical simulation. Eligible forecasts are frozen and checked for publication before kick-off; accuracy appears only as verified final scores become available.</p>}
      {isCommunity && source?.delivery === 'github-pages' && <p className="modal-sources">GitHub Pages serves a static data snapshot. If it is over a day old, your browser attempts to refresh it from the public community source. Updates may be delayed or rate-limited.</p>}
      {isCommunity && <p className="modal-sources">Fixtures and current results: <a href="https://github.com/oladeeayo/open-matchday" target="_blank" rel="noreferrer">open-matchday</a> (sources include FixtureDownload, OpenLigaDB, ESPN and football-data.co.uk). Prior-season results: <a href="https://github.com/openfootball/football.json" target="_blank" rel="noreferrer">openfootball</a>.</p>}
      <div className="modal-disclaimer"><Lightbulb size={16} aria-hidden="true" /><span>{isCommunity ? 'Community data is updated daily, not live, and is for non-commercial use. The backtest is not proof of future performance or calibration; predictions are not betting advice.' : 'Everything here uses sample data, not a live feed. This is a demonstration, not a validated forecasting service or betting advice.'}</span></div>
      <button className="button button--lime method-done" type="button" onClick={onClose}>Got it <ArrowRight size={16} /></button>
    </Modal>
  )
}
