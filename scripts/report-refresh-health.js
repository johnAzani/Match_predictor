import { githubApi } from './lib/github-api.js'
import { reportRefreshHealth } from './lib/refresh-alerts.js'

try {
  const repository = process.env.GITHUB_REPOSITORY
  const api = githubApi({ repository, token: process.env.GITHUB_TOKEN })
  const result = await reportRefreshHealth({
    api, repository, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT || '1',
    build: process.env.BUILD_RESULT, deploy: process.env.DEPLOY_RESULT, backup: process.env.BACKUP_RESULT,
    sourceHealth: process.env.SOURCE_HEALTH, overdueMonitor: process.env.OVERDUE_MONITOR_RESULT,
  })
  console.log(result.issue ? `Refresh monitor ${result.status} GitHub issue #${result.issue}.` : 'Refresh monitor: healthy; no alert issue is open.')
  // Degraded sources are visible as an unhealthy workflow even if deployment
  // and the public-ledger backup both succeeded.
  if (result.problems.length) process.exitCode = 1
} catch (error) {
  // A failed alert job remains visible as a failed Actions run and on the site.
  console.error(`Could not update the refresh alert: ${error.message}`)
  process.exitCode = 1
}
