// The season label follows the European calendar: July starts a new season.
// Shared by the community loader and the replacement-provider adapter so both
// produce identical `matchId` prefixes.
export function seasonFor(date) {
  const year = date.getUTCFullYear()
  const start = date.getUTCMonth() >= 6 ? year : year - 1
  const end = start + 1
  return { label: `${start}-${String(end).slice(-2)}`, code: `${String(start).slice(-2)}${String(end).slice(-2)}`, previous: `${start - 1}-${String(start).slice(-2)}` }
}
