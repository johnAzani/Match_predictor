import { useEffect, useState } from 'react'
import { Activity, ArrowUpRight, Download, RefreshCw } from 'lucide-react'
import { historyHealth, overdueHealth, sourceHealth } from '../lib/operationalHealth.js'
import { useWorkflowHealth } from '../lib/useWorkflowHealth.js'

function timeLabel(value) {
  if (typeof value !== 'string' || !value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return `${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(date)} UTC`
}

function kickoffLabel(kickoff) {
  const date = new Date(`${kickoff.date}T12:00:00Z`)
  return `${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)} · ${kickoff.time} approx. UTC+1`
}

function OverdueList({ records }) {
  if (!records.length) return null
  return <details className="data-overdue">
    <summary>View {records.length.toLocaleString()} {records.length === 1 ? 'result' : 'results'} needing review</summary>
    <p>These forecasts are still pending in the last loaded ledger. A missing score can mean a changed schedule or a delayed source; it does not confirm a postponement or that a match was played. The 48-hour check uses this device’s clock; kick-offs are approximate UTC+1.</p>
    <ul>{records.map((record) => <li key={record.id}>
      <div><strong>{record.home.shortName} <span>vs</span> {record.away.shortName}</strong><small>{record.league.name} · Last known kick-off: {kickoffLabel(record.latestKickoff)}</small></div>
      <b>AWAITING RESULT</b>
    </li>)}</ul>
    <a href="#forecast-history">Browse the full record <ArrowUpRight size={13} aria-hidden="true" /></a>
  </details>
}

function HealthItem({ title, health, timestamp, live = false }) {
  return <div className="data-health__item">
    <span>{title}</span>
    <strong className={`data-health__state data-health__state--${health.state}`} aria-live={live ? 'polite' : undefined}>{health.label}</strong>
    {timestamp && <small>{timestamp}</small>}
    {health.detail && <p>{health.detail}</p>}
  </div>
}

export default function DataHealth({ tracker, repository = import.meta.env.VITE_GITHUB_REPOSITORY || '' }) {
  const [now, setNow] = useState(() => Date.now())
  const workflow = useWorkflowHealth(repository, tracker.data?.publication, tracker.status)
  const history = historyHealth(tracker, now)
  const source = sourceHealth(tracker, now)
  const overdue = overdueHealth(tracker, now)
  const published = tracker.data?.publication === 'github-pages'
  const localPreview = tracker.data?.publication === 'local-preview'

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  return <section className="data-health" aria-labelledby="data-health-title">
    <div className="data-health__heading">
      <div><div className="data-health__kicker"><Activity size={15} aria-hidden="true" /> DATA HEALTH</div><h3 id="data-health-title">REFRESH & BACKUPS</h3><p>See when the history and community source were last updated, whether the latest automated run completed, and which results may be overdue.</p></div>
      {workflow.links && !localPreview && <a href={workflow.runUrl || workflow.links.runs} target="_blank" rel="noreferrer">View workflow <ArrowUpRight size={14} aria-hidden="true" /></a>}
    </div>
    <div className="data-health__grid">
      <HealthItem title="PUBLISHED HISTORY" health={history} timestamp={published && timeLabel(tracker.data.updatedAt) ? `Updated ${timeLabel(tracker.data.updatedAt)}` : null} />
      <HealthItem title="COMMUNITY SOURCE" health={source} timestamp={published && timeLabel(tracker.data.sourceUpdatedAt) ? `Source updated ${timeLabel(tracker.data.sourceUpdatedAt)}` : null} />
      <HealthItem title="REFRESH & BACKUP RUN" health={workflow} timestamp={workflow.startedAt && timeLabel(workflow.startedAt) ? `Started ${timeLabel(workflow.startedAt)}` : null} live />
      <HealthItem title="OVERDUE RESULTS" health={overdue} live />
    </div>
    <OverdueList records={overdue.records} />
    <div className="data-health__footer">
      <p>{localPreview || !workflow.links ? 'This preview does not run the public refresh or create an automatic backup.' : 'Daily refresh is scheduled for 06:17 UTC. Failures and overdue results open GitHub issues when possible. Public-ledger backups stay on GitHub, not an independent off-site copy.'}</p>
      <div className="data-health__actions">
        {workflow.state === 'unknown' && workflow.links && !localPreview && <button type="button" onClick={workflow.retry}>Retry status <RefreshCw size={13} aria-hidden="true" /></button>}
        {tracker.data && <a href={`${import.meta.env.BASE_URL}data/track-record.json`} download={`pitchside-${localPreview ? 'preview' : 'forecast'}-ledger-${tracker.data.updatedAt.slice(0, 10)}.json`}><Download size={14} aria-hidden="true" /> Download {localPreview ? 'preview' : 'history'}</a>}
        {workflow.links && !localPreview && <a href={workflow.links.backups} target="_blank" rel="noreferrer">GitHub backups <ArrowUpRight size={14} aria-hidden="true" /></a>}
        {workflow.links && !localPreview && <a href={workflow.links.alerts} target="_blank" rel="noreferrer">Refresh alerts <ArrowUpRight size={14} aria-hidden="true" /></a>}
        {workflow.links && !localPreview && <a href={workflow.links.overdueAlerts} target="_blank" rel="noreferrer">Overdue alerts <ArrowUpRight size={14} aria-hidden="true" /></a>}
      </div>
    </div>
  </section>
}
