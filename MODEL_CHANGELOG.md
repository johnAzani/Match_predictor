# Model changelog

The published model is not allowed to drift quietly. Every change to how a
prediction is produced gets an entry here, written *before* it ships, with the
evidence that justified it. The ledger keeps the probabilities that were actually
published, so an older entry can always be re-scored against a newer one.

## How a change is promoted

1. **Measure first.** The site's model review re-runs each shadow setting over
   the matches already recorded and compares its Brier score with the
   probabilities that were published at the time. Deltas are paired: both scores
   come from the same match, so only the model differs.
2. **Clear the gate.** Promotion needs **at least 100 published, verified,
   scored picks** and **|z| ≥ 2** on the paired Brier difference. A setting that
   only looks better is reported as "inside noise" and is not promoted.
3. **Ship a version.** A promoted change bumps `MODEL_VERSION` in
   `src/lib/tracker.js`, and this file records the date, the shadow setting, the
   sample size, the Brier change and the z score.
4. **Never rewrite the record.** Existing ledger entries keep the version they
   were recorded under. Nothing is retro-fitted, and no earlier forecast is
   invented to make a new version look better.

## Current published model

### `poisson-v1` — since tracking began

Poisson scoreline model. Each side's scoring rate is
`((goalsFor + opponent.goalsAgainst) / 2) × form multiplier × venue factor`,
clamped to 0.2–3.8 goals. The venue factors are 1.10 at home and 0.94 away, and
the form multiplier moves the rate by at most ±10% (form weight 0.2). The
score grid runs to ten goals per side, and the three outcomes are read off the
joint distribution.

- Chosen as a transparent baseline before the forward record started, so it has
  no measured promotion behind it. It is the incumbent every shadow model is
  scored against.

## Shadow settings under review

These are re-scored on the recorded matches in the site's **Model review** panel.
None of them is live; the published pick is always the model above.

| Setting | What changes |
| --- | --- |
| No home edge | Home and away venue factors both 1.00 |
| Bigger home edge | Home 1.20, away 0.94 |
| Ignore recent form | Form weight 0 |
| Heavier form weight | Form weight 0.4 (form can move the rate by ±20%) |

## What will not be accepted as an improvement

- Fitting parameters to the current sample and claiming the fitted result as
  out-of-sample evidence.
- A change justified by win rate alone, with no probability score behind it.
- Editing published probabilities, picks or results in the ledger.
- Any change whose only support is a hot streak, a league, or a single market.
