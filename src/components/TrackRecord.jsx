import { ArrowRight, CalendarClock, Crosshair } from 'lucide-react'
import { leagues } from '../data/fixtures.js'
import { summarizeTracker } from '../lib/tracker.js'
import ForecastHistory from './ForecastHistory.jsx'

function shortDate(value) {
  const date = value.length === 10 ? new Date(`${value}T12:00:00Z`) : new Date(value)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function monthName(value) {
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T12:00:00Z`))
}

function pct(correct, count) {
  return count ? `${(100 * correct / count).toFixed(1)}%` : '—'
}

function pickName(record) {
  const pick = record.prediction.pick
  return pick === 'draw' ? 'Draw' : `${pick === 'home' ? record.home.shortName : record.away.shortName} win`
}

function LeaguePerformance({ summary }) {
  const existing = new Map(summary.byLeague.map((league) => [league.id, league]))
  const entries = leagues.map((league) => existing.get(league.id) || { id: league.id, name: league.name, evaluated: 0, correct: 0 })
  return (
    <div className="track-panel">
      <div className="track-panel__heading"><div><span>01 / THE BREAKDOWN</span><h3>BY LEAGUE</h3></div><Crosshair size={18} aria-hidden="true" /></div>
      <div className="track-leagues">
        {entries.map((league) => <div className="track-league" key={league.id}>
          <div className="track-league__top"><strong>{league.name}</strong><span>{league.evaluated ? `${league.correct} / ${league.evaluated} correct` : 'No results yet'}</span><b>{pct(league.correct, league.evaluated)}</b></div>
          <div className="track-league__bar" aria-hidden="true"><span style={{ width: league.evaluated ? `${100 * league.correct / league.evaluated}%` : '0%' }} /></div>
        </div>)}
      </div>
    </div>
  )
}

function TimePerformance({ summary }) {
  const months = summary.byMonth.slice(-6)
  return (
    <div className="track-panel">
      <div className="track-panel__heading"><div><span>02 / THE LONG VIEW</span><h3>ACCURACY OVER TIME</h3></div><CalendarClock size={18} aria-hidden="true" /></div>
      {months.length ? <div className="track-months">{months.map((month) => <div className="track-month" key={month.month}>
        <span>{monthName(month.month)}</span><div className="track-month__bar" aria-hidden="true"><span style={{ width: `${100 * month.correct / month.evaluated}%` }} /></div><b>{pct(month.correct, month.evaluated)}</b><small>{month.correct}/{month.evaluated}</small>
      </div>)}</div> : <div className="track-empty"><span>THE STORY STARTS HERE</span><p>Monthly accuracy will appear once recorded matches have finished and their results are available.</p></div>}
      <p className="track-panel__footnote">Most recent six months with results. Accuracy is correct picks ÷ scored matches.</p>
    </div>
  )
}

function RecordRows({ summary }) {
  return (
    <div className="track-lists">
      <div className="track-panel track-panel--list">
        <div className="track-panel__heading"><div><span>03 / FINAL WHISTLE</span><h3>RECENT RESULTS</h3></div></div>
        {summary.recent.length ? <ul className="track-rows">{summary.recent.slice(0, 5).map((record) => <li key={record.id}>
          <div><strong>{record.home.shortName} <span>vs</span> {record.away.shortName}</strong><small>{shortDate(record.result.date)} · Pick: {pickName(record)}</small></div>
          <div className="track-row__result"><strong>{record.result.homeGoals} : {record.result.awayGoals}</strong><span className={record.correct ? 'is-correct' : 'is-missed'}>{record.correct ? 'CORRECT' : 'MISSED'}</span></div>
        </li>)}</ul> : <div className="track-empty track-empty--small"><p>No predictions have been scored yet. Finished matches appear here when the community results are available.</p></div>}
        {summary.evaluated > 5 && <p className="track-panel__footnote">Showing 5 of {summary.evaluated} scored results.</p>}
        <a className="track-history-link" href="#forecast-history">Browse the full record <ArrowRight size={13} aria-hidden="true" /></a>
      </div>
      <div className="track-panel track-panel--list">
        <div className="track-panel__heading"><div><span>04 / ON THE RECORD</span><h3>AWAITING RESULTS</h3></div><span className="track-panel__count">{summary.pending} PENDING</span></div>
        {summary.awaiting.length ? <ul className="track-rows">{summary.awaiting.slice(0, 5).map((record) => <li key={record.id}>
          <div><strong>{record.home.shortName} <span>vs</span> {record.away.shortName}</strong><small>{shortDate(record.latestKickoff.date)} · {record.latestKickoff.time} approx. UTC+1</small></div>
          <div className="track-row__pick"><small>{record.verifiedAt ? 'VERIFIED PICK' : 'CHECK PENDING'}</small><strong>{pickName(record)}</strong></div>
        </li>)}</ul> : <div className="track-empty track-empty--small"><p>No eligible forecasts are awaiting results yet. New predictions are recorded as fixtures approach.</p></div>}
        {summary.pending > 5 && <p className="track-panel__footnote">Showing 5 of {summary.pending} awaiting results.</p>}
        <a className="track-history-link" href="#forecast-history">Browse the full record <ArrowRight size={13} aria-hidden="true" /></a>
      </div>
    </div>
  )
}

export default function TrackRecord({ tracker }) {
  const data = tracker.data
  const summary = data ? summarizeTracker(data) : null
  const delayed = data && (tracker.loadFailed || data.sourceStale || Date.now() - Date.parse(data.updatedAt) > 48 * 60 * 60 * 1000)
  return (
    <section id="track-record" className="track-section" aria-labelledby="track-title">
      <div className="track-heading">
        <div><div className="section-kicker"><span /> THE SCORECARD <i>/</i> 02</div><h2 id="track-title">THE TRACK RECORD<span aria-hidden="true">.</span></h2><p>Predictions recorded before the match, checked against the final score. A forward-looking record, separate from our historical backtest.</p></div>
        {data && <div className="track-heading__meta"><span className="track-heading__dot" /> {data.publication === 'local-preview' ? 'LOCAL PREVIEW · NOT PUBLISHED' : delayed ? 'UPDATES MAY BE DELAYED' : 'FORWARD TEST'}<small>Tracking since {shortDate(data.startedAt)} · Updated {shortDate(data.updatedAt)} UTC</small></div>}
      </div>
      {tracker.status === 'loading' ? <div className="track-unavailable" role="status">Loading the forecast track record…</div> : tracker.status === 'unavailable' ? (
        <div className="track-unavailable" role="status"><div><strong>THE TRACK RECORD ISN’T AVAILABLE YET.</strong><p>The tracking snapshot may not be published yet, or it could not be loaded. Please try again shortly.</p></div><button type="button" className="button button--outline" onClick={tracker.retry} aria-label="Retry loading track record">Try again <ArrowRight size={15} /></button></div>
      ) : <>
        <div className="track-overview">
          <div className="track-overview__hero"><span>RECORDED PICKS CORRECT</span><strong>{summary.accuracy === null ? '—' : `${(summary.accuracy * 100).toFixed(1)}%`}</strong><small>{summary.evaluated ? `${summary.correct} correct out of ${summary.evaluated} scored` : 'No matches scored yet'}</small></div>
          <div className="track-overview__stat"><strong>{String(summary.evaluated).padStart(2, '0')}</strong><span>MATCHES<br />SCORED</span></div>
          <div className="track-overview__stat"><strong>{String(summary.pending).padStart(2, '0')}</strong><span>AWAITING<br />RESULTS</span></div>
          <p>{summary.excluded ? `${summary.excluded} match${summary.excluded === 1 ? '' : 'es'} excluded because publication or a result could not be verified. ` : ''}Results update from community data, not in play. Small samples can be misleading.</p>
        </div>
        <div className="track-panels"><LeaguePerformance summary={summary} /><TimePerformance summary={summary} /></div>
        <RecordRows summary={summary} />
        <ForecastHistory records={data.records} publication={data.publication} />
        <p className="track-method">The first eligible prediction is locked within 48 hours of kick-off, at least two hours early and before the match’s calendar day. A later build must observe it on the published site before its original kick-off, or it is excluded from accuracy. Tied leans, unknown kick-offs and insufficient history are not tracked. Scores are checked no earlier than the following UTC day; postponements, source gaps and approximate UTC+1 times can affect coverage. Historical accuracy does not guarantee future performance.</p>
      </>}
    </section>
  )
}
