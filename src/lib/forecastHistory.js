import { outcome } from './tracker.js'

export const DEFAULT_HISTORY_FILTERS = Object.freeze({ query: '', league: 'all', status: 'all', from: '', to: '', sort: 'newest' })

export function historyStatus(record) {
  if (record.excludedReason) return 'excluded'
  if (!record.result) return 'pending'
  return record.prediction.pick === outcome(record.result) ? 'correct' : 'missed'
}

// Filter and sort by the reported match date. A finished result's date takes
// precedence; otherwise the latest known scheduled date is the best we have.
export function historyMatchDate(record) {
  return record.result?.date ?? record.latestKickoff.date
}

export function historyPickName(record) {
  if (record.prediction.pick === 'draw') return 'Draw'
  return `${record.prediction.pick === 'home' ? record.home.shortName : record.away.shortName} win`
}

const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()

export function filterHistory(records, filters = DEFAULT_HISTORY_FILTERS) {
  const search = normalize(filters.query.trim())
  const matches = records.filter((record) => {
    const date = historyMatchDate(record)
    const text = `${record.home.name} ${record.home.shortName} ${record.away.name} ${record.away.shortName} ${record.league.name}`
    return (filters.league === 'all' || record.league.id === filters.league) &&
      (filters.status === 'all' || historyStatus(record) === filters.status) &&
      (!search || normalize(text).includes(search)) &&
      (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to)
  })
  return matches.sort((a, b) => {
    const order = historyMatchDate(a).localeCompare(historyMatchDate(b)) || a.latestKickoff.timestamp - b.latestKickoff.timestamp
    return (filters.sort === 'oldest' ? order : -order) || a.id.localeCompare(b.id)
  })
}

export const EXCLUSION_EXPLANATIONS = Object.freeze({
  'ambiguous-result': 'The source has conflicting scores or match dates. The forecast is excluded until the conflict is resolved.',
  'result-before-forecast': 'The source reports a result from on or before the forecast date, so it cannot be counted as a prospective pick.',
  'result-before-verification': 'The reported match date is before the day the forecast was verified on the published site.',
  'unverified-publication': 'The forecast could not be verified on the published site before kick-off, or the source already reported a result.',
  'result-unavailable': 'A previously observed result is no longer present in an available source. It can be counted again if the result reappears.',
})
