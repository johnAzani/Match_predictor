import { useEffect, useId, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, Search } from 'lucide-react'
import { leagues } from '../data/fixtures.js'
import { DEFAULT_HISTORY_FILTERS, EXCLUSION_EXPLANATIONS, filterHistory, historyMatchDate, historyPickName, historyStatus } from '../lib/forecastHistory.js'
import { CountryFlag, FormGuide, ProbabilityBar, ProbabilityLabels } from './Shared.jsx'

const PAGE_SIZE = 10

function dateLabel(value) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
}

function instantLabel(value) {
  return `${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(new Date(value))} UTC`
}

function kickoffLabel(kickoff) {
  return `${dateLabel(kickoff.date)} · ${kickoff.time} approx. UTC+1`
}

function statusLabel(record, publication) {
  const status = historyStatus(record)
  if (status === 'correct') return 'Correct'
  if (status === 'missed') return 'Missed'
  if (status === 'excluded') return 'Excluded'
  if (publication === 'local-preview') return 'Preview'
  return record.verifiedAt ? 'Awaiting result' : 'Check pending'
}

function HistoryDetails({ record, publication }) {
  const result = record.result
  const rescheduled = record.latestKickoff.date !== record.originalKickoff.date || record.latestKickoff.time !== record.originalKickoff.time
  const verification = record.verifiedAt ? <time dateTime={record.verifiedAt}>{instantLabel(record.verifiedAt)}</time> :
    publication === 'local-preview' ? 'Not published · local preview' : record.excludedReason ? 'Not verified' : 'Awaiting a later publication check'
  return (
    <div className="history-detail__inner">
      {record.excludedReason && <div className="history-exclusion"><strong>WHY THIS IS EXCLUDED</strong><p>{EXCLUSION_EXPLANATIONS[record.excludedReason]}</p></div>}
      <div className="history-detail__grid">
        <div className="history-forecast">
          <div className="history-detail__eyebrow">THE FORECAST AT RECORDING</div>
          <div className="history-forecast__pick"><div><span>MODEL LEAN</span><strong>{historyPickName(record)}</strong></div><div><span>MOST LIKELY SCORE</span><strong>{record.prediction.likelyScore.home} : {record.prediction.likelyScore.away}</strong></div><div><span>EXPECTED GOALS (HOME : AWAY)</span><strong>{record.prediction.expectedGoals.home.toFixed(2)} : {record.prediction.expectedGoals.away.toFixed(2)}</strong></div></div>
          <ProbabilityBar probabilities={record.prediction.probabilities} />
          <ProbabilityLabels probabilities={record.prediction.probabilities} />
          <p>The likely score is an estimate, not the actual final score. Model: {record.modelVersion}.</p>
        </div>
        <div className="history-audit">
          <div className="history-detail__eyebrow">THE AUDIT TRAIL</div>
          <dl>
            <div><dt>Recorded in build</dt><dd><time dateTime={record.recordedAt}>{instantLabel(record.recordedAt)}</time></dd></div>
            <div><dt>Seen on published site</dt><dd>{verification}</dd></div>
            <div><dt>Original kick-off</dt><dd>{kickoffLabel(record.originalKickoff)}</dd></div>
            {rescheduled && <div><dt>Latest known kick-off</dt><dd>{kickoffLabel(record.latestKickoff)}</dd></div>}
            {result && <div><dt>{record.excludedReason ? 'Last reported score' : 'Final score'}</dt><dd>{result.homeGoals} : {result.awayGoals} · {dateLabel(result.date)}</dd></div>}
            {result && <div><dt>Score observed</dt><dd><time dateTime={result.observedAt}>{instantLabel(result.observedAt)}</time></dd></div>}
          </dl>
          {record.verifiedAt && <p>Verification is when a later build observed the forecast on the site, not its exact publication time.</p>}
        </div>
      </div>
      <div className="history-inputs">
        <div className="history-detail__eyebrow">SAVED MODEL INPUTS <span>UP TO 10 EARLIER LEAGUE MATCHES</span></div>
        {[record.home, record.away].map((team, index) => <div className="history-inputs__team" key={index}>
          <strong>{team.name} <small>{index === 0 ? 'HOME' : 'AWAY'}</small></strong>
          <span>{team.sampleSize} matches · {team.goalsFor.toFixed(2)} scored / {team.goalsAgainst.toFixed(2)} conceded per match</span>
          <FormGuide form={team.form} teamName={team.name} />
        </div>)}
      </div>
    </div>
  )
}

function HistoryRow({ record, publication, expanded, onToggle }) {
  const status = historyStatus(record)
  const panelId = useId()
  return (
    <li className={`history-row${expanded ? ' is-expanded' : ''}`}>
      <button type="button" className="history-row__button" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}>
        <span className="history-row__match"><CountryFlag country={record.league.country} /><span><strong>{record.home.shortName} <i>vs</i> {record.away.shortName}</strong><small>{record.league.name} · {record.season} · {dateLabel(historyMatchDate(record))}</small></span></span>
        <span className="history-row__pick"><small>LOCKED PICK</small><strong>{historyPickName(record)}</strong></span>
        <span className="history-row__score"><small>{status === 'excluded' && record.result ? 'LAST REPORTED' : 'FINAL SCORE'}</small><strong>{record.result ? `${record.result.homeGoals} : ${record.result.awayGoals}` : '—'}</strong></span>
        <span className={`history-status history-status--${status}`}>{statusLabel(record, publication)}</span>
        <ChevronDown className="history-row__chevron" size={17} aria-hidden="true" />
      </button>
      <div id={panelId} hidden={!expanded}>{expanded && <HistoryDetails record={record} publication={publication} />}</div>
    </li>
  )
}

export default function ForecastHistory({ records, publication }) {
  const [filters, setFilters] = useState(DEFAULT_HISTORY_FILTERS)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState(null)
  const filtered = useMemo(() => filterHistory(records, filters), [records, filters])
  const leagueOptions = useMemo(() => {
    const names = new Map(leagues.map((league) => [league.id, league.name]))
    records.forEach((record) => names.set(record.league.id, record.league.name))
    return [...names].sort((a, b) => a[1].localeCompare(b[1]))
  }, [records])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // A background ledger refresh can remove records while a later page is open.
  const currentPage = Math.min(page, pageCount)
  const start = (currentPage - 1) * PAGE_SIZE
  const shown = filtered.slice(start, start + PAGE_SIZE)
  const invalidRange = filters.from && filters.to && filters.from > filters.to
  const hasFilters = Object.keys(DEFAULT_HISTORY_FILTERS).some((key) => filters[key] !== DEFAULT_HISTORY_FILTERS[key])

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount))
  }, [pageCount])

  function changeFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(1)
    setExpandedId(null)
  }

  function clearFilters() {
    setFilters(DEFAULT_HISTORY_FILTERS)
    setPage(1)
    setExpandedId(null)
  }

  function changePage(next) {
    setPage(next)
    setExpandedId(null)
  }

  return (
    <section id="forecast-history" className="history-section" aria-labelledby="history-title">
      <div className="history-heading">
        <div><div className="history-heading__kicker"><span /> 05 / EVERY RECORDED PICK</div><h3 id="history-title">THE FULL RECORD<span aria-hidden="true">.</span></h3><p>Explore every forecast in the prospective ledger. Select a match for its original pick and audit trail.</p></div>
        <div className="history-heading__count"><strong>{String(records.length).padStart(2, '0')}</strong><span>RECORDED<br />FORECASTS</span></div>
      </div>
      {publication === 'local-preview' && <p className="history-preview-note">LOCAL PREVIEW · This snapshot is not the published track record.</p>}
      <div className="history-controls">
        <div className="history-control history-control--search"><label htmlFor="history-query">TEAM OR LEAGUE</label><div><Search size={16} aria-hidden="true" /><input id="history-query" type="search" value={filters.query} onChange={(event) => changeFilter('query', event.target.value)} placeholder="Search teams..." /></div></div>
        <label className="history-control"><span>LEAGUE</span><select value={filters.league} onChange={(event) => changeFilter('league', event.target.value)}><option value="all">All leagues</option>{leagueOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="history-control"><span>STATUS</span><select value={filters.status} onChange={(event) => changeFilter('status', event.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="correct">Correct</option><option value="missed">Missed</option><option value="excluded">Excluded</option></select></label>
        <label className="history-control"><span>FROM DATE</span><input type="date" value={filters.from} onChange={(event) => changeFilter('from', event.target.value)} /></label>
        <label className="history-control"><span>TO DATE</span><input type="date" value={filters.to} onChange={(event) => changeFilter('to', event.target.value)} /></label>
        <label className="history-control"><span>SORT BY</span><select value={filters.sort} onChange={(event) => changeFilter('sort', event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      </div>
      <p className="history-filter-note">Dates use the reported match date or latest scheduled date. Pending includes publication checks and matches awaiting results. Filters affect this list only; the scorecard above remains all-time.</p>
      <div className="history-results-heading"><p aria-live="polite" aria-atomic="true">{filtered.length ? `SHOWING ${start + 1}–${start + shown.length} OF ${filtered.length} ${filtered.length === 1 ? 'RECORD' : 'RECORDS'}` : 'NO MATCHING RECORDS'}</p>{hasFilters && <button type="button" onClick={clearFilters}>Clear filters <span aria-hidden="true">×</span></button>}</div>
      {shown.length ? <ul className="history-list">{shown.map((record) => <HistoryRow key={record.id} record={record} publication={publication} expanded={expandedId === record.id} onToggle={() => setExpandedId((current) => current === record.id ? null : record.id)} />)}</ul> : <div className="history-empty"><strong>{invalidRange ? 'CHECK THE DATE RANGE' : records.length ? 'NO RECORDS FOUND' : 'THE RECORD STARTS HERE'}</strong><p>{invalidRange ? 'The from date must be on or before the to date.' : records.length ? 'Try another team, status, league or date range.' : publication === 'local-preview' ? 'No forecasts have been recorded in this local preview yet.' : 'Forecasts will appear here as eligible matches are recorded. We do not invent past predictions.'}</p>{hasFilters && <button className="button button--outline" type="button" onClick={clearFilters}>Reset filters <ArrowRight size={15} aria-hidden="true" /></button>}</div>}
      {filtered.length > PAGE_SIZE && <nav className="history-pagination" aria-label="Forecast history pages"><button type="button" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}><ArrowLeft size={15} aria-hidden="true" /> Previous</button><span aria-live="polite">PAGE {currentPage} OF {pageCount}</span><button type="button" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>Next <ArrowRight size={15} aria-hidden="true" /></button></nav>}
    </section>
  )
}
