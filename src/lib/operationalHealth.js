import { findOverdueResults, OVERDUE_HOURS } from './overdueResults.js'

const HOUR = 60 * 60 * 1000
const CLOCK_SKEW = 5 * 60 * 1000
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export function repositoryLinks(repository) {
  if (typeof repository !== 'string' || !REPOSITORY.test(repository) || repository.split('/').some((part) => part === '.' || part === '..')) return null
  const [owner, name] = repository.split('/').map(encodeURIComponent)
  const path = `${owner}/${name}`
  return {
    runs: `https://github.com/${path}/actions/workflows/pages.yml`,
    api: `https://api.github.com/repos/${path}/actions/workflows/pages.yml/runs?branch=main&per_page=1`,
    backups: `https://github.com/${path}/releases/tag/forecast-ledger-backups`,
    alerts: `https://github.com/${path}/issues?q=is%3Aissue+is%3Aopen+%22Forecast+refresh+or+backup+needs+attention%22`,
    overdueAlerts: `https://github.com/${path}/issues?q=is%3Aissue+is%3Aopen+%22Overdue+forecast+results+need+attention%22`,
    run: (id) => `https://github.com/${path}/actions/runs/${id}`,
  }
}

export function historyHealth(tracker, now = Date.now()) {
  if (tracker.status === 'loading') return { state: 'loading', label: 'Loading', detail: 'Checking the published history.' }
  if (!tracker.data) return { state: 'attention', label: 'Unavailable', detail: 'The published history could not be loaded.' }
  if (tracker.data.publication === 'local-preview') return { state: 'preview', label: 'Local preview', detail: 'This is not the published history.' }
  const timestamp = Date.parse(tracker.data.updatedAt)
  if (tracker.loadFailed) return { state: 'attention', label: 'Connection issue', detail: 'Showing the last loaded copy; the latest check failed.' }
  if (!Number.isFinite(timestamp) || timestamp > now + CLOCK_SKEW) return { state: 'unknown', label: 'Time unknown', detail: 'The publication time could not be checked against this device.' }
  if (now - timestamp > 36 * HOUR) return { state: 'attention', label: 'Update delayed', detail: 'The published history is over 36 hours old.' }
  return { state: 'ok', label: 'Recently updated', detail: null }
}

export function sourceHealth(tracker, now = Date.now()) {
  if (tracker.status === 'loading') return { state: 'loading', label: 'Loading', detail: 'Checking source freshness.' }
  if (!tracker.data) return { state: 'unknown', label: 'Unknown', detail: 'Source timing is unavailable.' }
  if (tracker.data.publication === 'local-preview') return { state: 'preview', label: 'Local preview', detail: 'Not a public-source health check.' }
  const timestamp = Date.parse(tracker.data.sourceUpdatedAt)
  if (!Number.isFinite(timestamp) || timestamp > now + CLOCK_SKEW) return { state: 'unknown', label: 'Time unknown', detail: 'The source update time is unavailable or in the future.' }
  if (tracker.data.sourceStale || now - timestamp > 48 * HOUR) return { state: 'attention', label: 'Source delayed', detail: 'Community data may be stale; results are not live.' }
  return { state: 'ok', label: 'Recently updated', detail: null }
}

// The list is a warning based on the last published ledger and this device's
// clock. It does not establish that a match was played or postponed.
export function overdueHealth(tracker, now = Date.now()) {
  const none = { records: [] }
  if (tracker.status === 'loading') return { ...none, state: 'loading', label: 'Loading', detail: 'Checking pending results.' }
  if (!tracker.data) return { ...none, state: 'unknown', label: 'Unknown', detail: 'The published history is unavailable.' }
  if (tracker.data.publication === 'local-preview') return { ...none, state: 'preview', label: 'Local preview', detail: 'Not a check of published forecasts.' }
  const updated = Date.parse(tracker.data.updatedAt)
  if (!Number.isFinite(now) || !Number.isFinite(updated) || updated > now + CLOCK_SKEW || !Array.isArray(tracker.data.records)) {
    return { ...none, state: 'unknown', label: 'Time unknown', detail: 'The ledger or this device’s clock could not be checked.' }
  }
  const sourceTime = Date.parse(tracker.data.sourceUpdatedAt)
  if (Number.isFinite(sourceTime) && sourceTime > now + CLOCK_SKEW) return { ...none, state: 'unknown', label: 'Time unknown', detail: 'The source time or this device’s clock could not be checked.' }
  const records = findOverdueResults(tracker.data.records, now)
  if (records.length) return { records, state: 'attention', label: `${records.length} ${records.length === 1 ? 'needs' : 'need'} review`, detail: `Pending for at least ${OVERDUE_HOURS} hours after the last known kick-off. The schedule or source could be delayed.` }
  if (tracker.loadFailed || now - updated > 36 * HOUR || tracker.data.sourceStale || !Number.isFinite(sourceTime) || now - sourceTime > 48 * HOUR) {
    return { ...none, state: 'unknown', label: 'None flagged', detail: 'Based on the last saved ledger; the source or history may be delayed.' }
  }
  return { ...none, state: 'ok', label: 'None flagged', detail: `No pending record is ${OVERDUE_HOURS} hours past its last known kick-off.` }
}

export async function loadWorkflowHealth(repository, { fetchImpl = globalThis.fetch, signal } = {}) {
  const links = repositoryLinks(repository)
  if (!links) throw new Error('Workflow status is not configured')
  const response = await fetchImpl(links.api, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal })
  if (!response.ok) throw new Error(`Workflow status unavailable (${response.status})`)
  const data = await response.json()
  if (!Array.isArray(data?.workflow_runs)) throw new Error('Unexpected workflow status')
  const run = data.workflow_runs[0]
  if (!run) return { state: 'unknown', label: 'No runs found', detail: 'No refresh run has been reported yet.', runUrl: links.runs }
  if (!Number.isSafeInteger(run.id) || run.id <= 0 || typeof run.status !== 'string') throw new Error('Unexpected workflow run')
  const runUrl = links.run(run.id)
  const startedAt = Number.isFinite(Date.parse(run.run_started_at)) ? run.run_started_at : Number.isFinite(Date.parse(run.created_at)) ? run.created_at : null
  if (run.status !== 'completed') return { state: 'running', label: 'Refresh in progress', detail: 'GitHub is running or waiting to run the workflow.', runUrl, startedAt }
  if (run.conclusion === 'success') return { state: 'ok', label: 'Last run succeeded', detail: 'The last refresh workflow completed successfully.', runUrl, startedAt }
  if (['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale'].includes(run.conclusion)) {
    return { state: 'attention', label: 'Run needs attention', detail: 'A refresh, source-health, deployment, backup or alert step needs review.', runUrl, startedAt }
  }
  return { state: 'unknown', label: 'Run status unknown', detail: 'GitHub did not report a conclusive result.', runUrl, startedAt }
}
