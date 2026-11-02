import { reportScheduledHeartbeat } from './lib/schedule-heartbeat.js'

try {
  const result = await reportScheduledHeartbeat({
    event: process.env.GITHUB_EVENT_NAME, attempt: process.env.GITHUB_RUN_ATTEMPT,
    build: process.env.BUILD_RESULT, deploy: process.env.DEPLOY_RESULT,
    backup: process.env.BACKUP_RESULT, notify: process.env.NOTIFY_RESULT,
    pingUrl: process.env.SCHEDULE_HEALTHCHECK_URL,
  })
  if (!result.ok) {
    console.error(`Could not send the independent schedule heartbeat: ${result.reason}`)
    process.exitCode = 1
  } else {
    console.log(result.reason === 'not-configured' ? 'Independent schedule heartbeat is not configured.' : 'Independent schedule heartbeat sent.')
  }
} catch {
  // Never print an unexpected exception, which could contain a secret URL.
  console.error('Could not send the independent schedule heartbeat: unexpected-error')
  process.exitCode = 1
}
