// The single source name the published forecast ledger is allowed to grow
// from. Changing this constant is a migration event, not a configuration
// toggle: run the dry run first (`provider-migration-report.yml`), confirm zero
// contradicting scores, and keep every existing record untouched. A naive swap
// would orphan pending forecasts or rewrite history.
//
// 2026-11-05: migrated from `open-matchday` to `five-dollar-football`. The dry
// run confirmed all 39 previously scored forecasts agree, none were stranded,
// and every provider club maps onto the frozen roster. Existing records keep
// their original identities.
export const APPROVED_FEED_SOURCE = 'five-dollar-football'

// Sources the codebase knows how to read. Anything else is refused outright.
export const KNOWN_FEED_SOURCES = Object.freeze(['open-matchday', 'five-dollar-football'])
