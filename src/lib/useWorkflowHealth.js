import { useCallback, useEffect, useState } from 'react'
import { loadWorkflowHealth, repositoryLinks } from './operationalHealth.js'

const INTERVAL = 30 * 60 * 1000

export function useWorkflowHealth(repository, publication, trackerStatus) {
  const links = repositoryLinks(repository)
  const [state, setState] = useState({ state: 'loading', label: 'Checking', detail: 'Checking the latest workflow.' })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    if (!links || trackerStatus === 'loading' || publication === 'local-preview') return undefined
    const timer = window.setInterval(retry, INTERVAL)
    return () => window.clearInterval(timer)
  }, [repository, publication, trackerStatus, retry])

  useEffect(() => {
    // Wait for the ledger to distinguish a local preview before making an
    // external GitHub request. If the ledger fails, still check the workflow.
    if (trackerStatus === 'loading') {
      setState({ state: 'loading', label: 'Checking', detail: 'Waiting for the history to load.' })
      return undefined
    }
    if (publication === 'local-preview') {
      setState({ state: 'preview', label: 'Local preview', detail: 'Workflow and backup status are not checked in a preview.' })
      return undefined
    }
    if (!links) {
      setState({ state: 'unknown', label: 'Not connected', detail: 'Workflow status is not configured in this build.' })
      return undefined
    }
    const controller = new AbortController()
    let active = true
    let timedOut = false
    const timer = window.setTimeout(() => { timedOut = true; controller.abort() }, 10_000)
    setState({ state: 'loading', label: 'Checking', detail: 'Checking the latest workflow.' })
    loadWorkflowHealth(repository, { signal: controller.signal }).then((result) => {
      if (active && !timedOut) setState(result)
    }).catch(() => {
      if (active && (!controller.signal.aborted || timedOut)) {
        setState({ state: 'unknown', label: 'Status unavailable', detail: 'GitHub status could not be checked; the last published history may still be available.', runUrl: links.runs })
      }
    }).finally(() => window.clearTimeout(timer))
    return () => { active = false; window.clearTimeout(timer); controller.abort() }
  }, [repository, publication, trackerStatus, attempt])

  return { ...state, retry, links }
}
