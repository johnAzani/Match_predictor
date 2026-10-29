# Pitchside

A responsive football match-prediction dashboard built with React and Vite. It shows community fixtures, league filters, team search, locally saved matches, prediction breakdowns, a historical walk-forward backtest, and a separate prospective track record. It can run as a static GitHub Pages site or with the included Node/Express server.

> **Data limitations:** The current feed is community-maintained, updated approximately daily, **not an in-play/live feed**, and is shared for **informational, non-commercial use**. Kick-off times are supplied in a fixed UTC+1 convention and can be inaccurate, especially around daylight-saving changes. Verify fixtures with official sources. Predictions are not guarantees or betting advice.

## Local development

Requires Node.js 22.15+ within the Node 22 line, Node 24, or Node 26+ (matching the build/test tooling's supported versions).

```bash
npm install
npm run snapshot  # optional: generate a local-only track record and fixture snapshot
npm run dev
```

Open the URL printed by the server. The browser uses the same-origin `/api/matchday` endpoint; no API key is required for the public community feed. An internet connection to the GitHub API is needed to load data. The optional snapshot creates a **local preview**, not a published record; without it, tracking is shown as unavailable. `HOST` and `PORT` can be set in the environment; the defaults are `0.0.0.0` and `5173`.

```bash
npm test       # model, feed, backtest, tracker and interaction tests
npm run build  # production browser assets in dist/
npm start      # Node server serves dist/ and /api/matchday
```

`npm run preview` also serves the production build via the Node server.

## GitHub Pages deployment

The workflow in `.github/workflows/pages.yml` builds and deploys a **static** site; GitHub Pages does not run the Node server. It generates a data snapshot, runs the tests, builds with the correct repository subpath, and deploys the Pages artifact. No personal access token is required: the workflow uses GitHub's short-lived `GITHUB_TOKEN` for the public data requests.

1. In the repository, open **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**.
2. Merge the application and workflow into `main` to publish. The **Deploy GitHub Pages** workflow runs on pushes to `main`; this repository's Pages environment permits deployment from `main` only. Check the run in the repository's **Actions** tab. The expected site address is `https://johnazani.github.io/Match_predictor/` once deployment succeeds.
3. The workflow is scheduled for **06:17 UTC daily**, and can also be run manually from `main` in the Actions tab. GitHub only executes schedules from the default branch, and schedules or deployments can be delayed.

The build does not commit generated data. If snapshot generation fails, the workflow fails rather than replacing the last successful deployment with invented data. The Pages site starts from the deployed snapshot, and if it is over 24 hours old the browser attempts to fetch a fresh community snapshot directly from the public GitHub API and keeps a local cache. This can be rate-limited, especially on a shared IP. When refresh fails, the last snapshot is retained and marked stale; with no usable snapshot, clearly labelled demo data is shown. Elapsed kick-offs are removed from an old snapshot in the browser.

To reproduce a Pages build locally (replace the base path if the repository name differs):

```bash
npm run snapshot
VITE_STATIC_FEED=true VITE_BASE=/Match_predictor/ npm run build
VITE_BASE=/Match_predictor/ npx vite preview --host 0.0.0.0
```

`public/data/matchday.json`, `public/data/track-record.json` and `dist/` are generated and ignored by Git. A locally generated ledger is labelled **local preview**: it is not the public track record and cannot be promoted into it. The snapshot command can optionally use the `GITHUB_TOKEN` environment variable to avoid unauthenticated API limits; it is never written into the site.

## Data and reliability

- The current-season Premier League, La Liga, Bundesliga and Serie A fixture/result CSVs come from [open-matchday](https://github.com/oladeeayo/open-matchday). The site displays the next 14 days of available fixtures and the source's reported update time. The source compiles data from FixtureDownload, OpenLigaDB, ESPN and football-data.co.uk; their terms also apply.
- Previous-season results for the backtest come from [openfootball/football.json](https://github.com/openfootball/football.json), which describes its data as public domain. Historical records can contain gaps. The model dialog reports how many current leagues have previous-season data available.
- The Node server caches data in memory for 30 minutes and combines concurrent refreshes. If a refresh fails after a successful load, the last server snapshot is marked stale. An unknown source-update time is also treated as potentially stale. If no snapshot is available, the browser explicitly switches to **demo** fixtures and offers a retry. Partial league failures are shown in the notice.
- The community repository currently publishes 2026/27 data; if future-season files are unavailable, the app falls back rather than inventing fixtures. Team spelling changes can leave a club without enough matched history. Those matches are shown without a prediction. Conflicting duplicate scores or fixture dates are excluded instead of choosing one arbitrarily.
- Saved match IDs are held in the browser's `localStorage`, not an account. Only fixtures in the current 14-day window appear in the saved view.

## Prediction model and backtest

For each team, the model uses up to its last **10 available completed league matches in the current season**, strictly before the current UTC date. It averages the team's goals scored with the opponent's goals conceded, adjusts for the team's last five results and a modest home/away factor, then uses independent Poisson distributions to estimate scorelines and home-win/draw/away-win probabilities. At least three prior results per team are required. Future fixtures in the window all use the currently available history; results from matches that have not yet happened are not projected into it.

The backtest runs separately for each league and season using available previous- and current-season results. Matches are evaluated chronologically, and **all games on the same date are predicted before any result from that date is added**. Games with fewer than three earlier results for either team are skipped. It reports top-outcome accuracy using unrounded probabilities, an always-predict-home-win baseline, multiclass Brier score and log loss. Brier and log loss are lower-is-better. The results are a limited historical check, **not proof of future accuracy or calibration**, and reflect only the records available from the sources.

## Prospective track record

The **Track record** section begins when this feature is first successfully deployed; it never manufactures historical predictions. It measures correct home/draw/away picks divided by the number of scored forecasts, overall, by league and by the month of the match. Pending matches and the most recent results are shown separately. The historical backtest above is a simulation, **not** the prospective record, and it uses unrounded probabilities; the track record excludes a rounded tie rather than scoring a hidden tiebreaker. Small samples are not reliable evidence of future accuracy.

The embedded **Full record** lets visitors browse every recorded forecast, including pending and excluded entries. It supports team or league search, league/status/date filters, sorting and pagination. Dates use the reported result date where available, otherwise the latest known scheduled date; filters change the list, not the all-time scorecard above. Expanding a record shows its frozen pick, probabilities, expected goals, model inputs, original and latest known kick-offs, any observed score, verification timing and exclusion reason. The verification timestamp is when a later build observed the forecast on the published site, not its exact publication time. This is a read-only view of the same Pages ledger; browser filters never change the stored forecasts.

On each successful Pages build:

1. Restore and validate the ledger from the previously published site. A prediction is frozen only if it has at least three previous results per team, a known kick-off, no existing result or rounded tie, and a fresh source. It must be **2–48 hours before the approximate kick-off**, and the fixture's listed calendar date must be later than the forecast's UTC date. The pick, probabilities, model inputs and original kick-off are saved; the pick is never replaced by a later estimate. Matches outside these rules are not tracked. Browser-only fixture refreshes do not create ledger entries.
2. A subsequent build must actually observe the forecast on the published Pages site **before the original and latest known kick-off**, while a fresh source still lists it as upcoming and has no result. Until then it is awaiting a publication check. If verification is too late, it is permanently excluded rather than being counted as an apparently advance prediction. Outages, delayed deployments and the daily schedule can therefore leave some matches untracked or excluded.
3. A result is considered no earlier than the **next UTC day**, when a unique completed score appears in the community feed. Reschedules retain the original forecast, and score corrections update the result; contradictory duplicate scores or dates are excluded until the conflict is resolved. If an available source later removes a scored result, it is excluded until the result reappears. A result dated before the verification day is also excluded. Missing leagues, renamed clubs or unavailable results can leave forecasts pending. Accuracy only includes verified, unambiguous results; it is not a measure of all fixtures.

The feed's fixed **UTC+1 kick-off convention is approximate**, the provider can be late or wrong, and a source error can still affect whether a match is considered upcoming. This is not an independent timestamping or official results service. Verify fixtures with official sources. The UI marks delayed tracking data and does not pretend that demo or browser-only estimates have been recorded.

### Refresh health and alerts

The on-site **Refresh & backups** panel shows the published ledger time, its community-source time and the latest `main` Pages workflow status. It marks history over 36 hours old, a source over 48 hours old, unavailable data and failed checks; the thresholds use the visitor's device clock. Workflow status is read from GitHub's public API in the browser, every 30 minutes or on retry. A rate limit, network failure or unconfigured/local preview is shown as **unknown**, never as a successful run. This request exposes the visitor's IP to GitHub. A successful workflow means its build, deployment and post-deployment backup completed; it does not guarantee the source's football data is correct or live.

If the build, deployment, confirmed backup or source-health check fails, a separate least-privilege job opens or updates a public **Forecast refresh or backup needs attention** issue and links the run. A later fully healthy run closes that bot-owned issue. GitHub email or mobile notifications depend on the owner's GitHub notification/watch settings; no separate email or SMS service is configured. A cancelled workflow, disabled schedule, GitHub/API outage, or failure of the issue job itself may prevent an issue being opened. The site can still warn about an aging ledger when someone visits, but this is **not independent uptime monitoring**. Scheduled runs can also be delayed.

### Backups and recovery

Pages remains the primary ledger: each build restores the last public copy and fails closed if it is missing or invalid. The existing `forecast-ledger` Actions artifact is kept for 90 days, but it is created **before** deployment and is not, by itself, proof of publication.

After a successful deployment, the backup job downloads that build artifact and waits until the exact bytes are observable on the public Pages URL. Only then does it upload a copy to the public, machine-managed [`forecast-ledger-backups` GitHub Release](https://github.com/johnAzani/Match_predictor/releases/tag/forecast-ledger-backups), download it again and verify its SHA-256 checksum and ledger schema. The tag is a storage location, not a code release or independent timestamp. After the new upload is verified, rotation keeps the 10 newest copies plus the newest on each of the latest 30 backup days, 24 months and 5 years; only matching assets uploaded by `github-actions[bot]` are removed. The Release and its files are public, remain on GitHub and can be changed or deleted by repository administrators. Download **history** from the site and save an independent copy elsewhere if stronger protection is needed.

Before a normal deployment the workflow compares the restored public ledger with the latest checksum-verified Release backup and refuses to proceed if recorded forecasts, frozen inputs or earlier publication verifications disappeared or changed. It also checks continuity between the restored and newly generated ledgers. Once the site indicates that backups are enabled, a missing, unreadable or corrupt managed backup fails the build rather than silently starting over. On the first deployment of this feature the old site has no backup marker; the new Release is created after that deployment. If the first backup job fails, fix the reported permission or network problem and rerun its failed job in GitHub Actions before expecting later builds to proceed.

To check a downloaded Release asset without publishing anything, keep its original filename and run `npm run verify-backup -- /path/to/forecast-ledger-...json`. This verifies the filename's checksum, timestamp and schema, **not independent proof of publication**. Consult the associated successful deployment and backup job as well; a failed pre-deployment artifact is not proof that its forecasts were public.

For deliberate recovery, first inspect the latest public ledger, the successful deployment history, available 90-day artifacts and independent copies. Forecasts newer than the most recent Release backup may be permanently lost and must never be reconstructed as genuine predictions. Then, in Actions, select **Recover forecast history (manual)** on `main` and type `RESTORE LATEST VERIFIED BACKUP`. The workflow uses only the latest bot-created managed Release asset after checksum/schema verification; it refuses network/5xx errors, an already-current backup and overwriting a newer valid public ledger. It restores the saved ledger byte-for-byte without generating predictions, builds a fresh fixture snapshot separately, and checks that the exact ledger can be observed on Pages after deployment. The next normal Pages run continues from that ledger. Recovery requires Actions/Pages permissions, a reachable community feed and the existing `github-pages` environment approval rules. It cannot prove that a missing or corrupt public ledger had no newer, unbacked forecasts; the explicit confirmation accepts that risk.

The Release backup job needs `contents: write`, and the isolated alert job needs `issues: write` through `GITHUB_TOKEN`; repository or organization policy may deny these permissions. Failure is visible in Actions and on the site's run-status panel when GitHub's API is reachable. No personal access token is stored in the site or required by the workflows.

## Usage rights and deployment

The open-matchday compilation permits informational, non-commercial use with attribution and says that upstream provider rights also apply. Check its [disclaimer and provider terms](https://github.com/oladeeayo/open-matchday/blob/master/DISCLAIMER.md) before publishing or redistributing. A commercial product or real-time service needs an appropriately licensed football-data provider, reliable time-zone-aware kick-offs, an operational cache, and further model evaluation/calibration.

## Assets

- Club crests are included for illustrative identification, sourced from the [football-logos collection](https://github.com/JoseArroyave/football-logos). Club names and marks belong to their respective owners; check rights before commercial use.
- The stadium hero image was generated for this project.
- Icons use [Lucide](https://lucide.dev/); fonts are Manrope and Barlow Condensed via Fontsource.
