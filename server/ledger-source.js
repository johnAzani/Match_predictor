// The single source name the published forecast ledger is allowed to grow
// from. Changing this constant is a migration event, not a configuration
// toggle: run the dry run first (`provider-migration-report.yml`), confirm zero
// contradicting scores, and keep every existing record untouched. A naive swap
// would orphan pending forecasts or rewrite history.
export const APPROVED_FEED_SOURCE = 'open-matchday'

// Sources the codebase knows how to read. Anything else is refused outright.
export const KNOWN_FEED_SOURCES = Object.freeze(['open-matchday', 'five-dollar-football'])
