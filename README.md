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

## Daily pick and ₦100 journal

The **Daily pick** panel uses the Nigerian calendar (WAT, UTC+1) and displays at most one single selection per day. When the page is visited, it chooses the highest unrounded model probability among that day's eligible forecasts in the **existing public ledger**. The forecast must already have been published and subsequently verified before the original kick-off, its current fixture must match the fresh community feed, the league must be available, and both original and latest approximate kick-off times must be at least two hours away. Ties between matches are resolved by earlier kick-off and then ID. It does not consider bookmaker odds, expected value or the user's circumstances; the model probability is not a guarantee of accuracy or profit. No pick is shown if the data is stale, missing, unverified, ambiguous or too close to kick-off. There are days with no pick. The four domestic leagues above are the only coverage; Europa League and external suggestions are **not** tracked by this panel.

The selected pick is saved **only on the browser where the page is opened**, before the cut-off, and is kept for that day even if rankings later change. This personal daily choice is not itself a publicly timestamped recommendation. No selections are made while the page is closed or invented for past days. The independent public forecast ledger and its Release backups are unchanged. The page polls for the community feed and public ledger while open, and checks saved picks when opened again. Community results are delayed and the public ledger does not score until at least the following UTC day; corrections, postponements and data failures can delay or change the displayed result. A changed schedule or a reported result on another date is flagged for settlement review, even if the source never reported a new fixture.

The optional calculator accepts a **combined maximum of ₦100 in the single saved bet** for a WAT day, a user-entered decimal price from 1.01 to 1000.00, and at most two decimal places. It uses integer kobo: estimated gross return is stake multiplied by entered odds, rounded to the nearest kobo; estimated profit subtracts the stake. A lost single can lose the whole stake. Fees, tax, voids and bookmaker settlement rules are not included. The calculator supplies no odds and does not place or verify any bet. A bet is recorded only when the user explicitly confirms having placed it; it can be edited only before the same two-hour cut-off, and edits correct that single rather than adding another bet. The user can mark or undo a void, but must verify any refund independently. Estimated net includes only recorded, non-void singles with a usable result and an unchanged schedule. Other wagers, browsers, devices and bookmaker accounts are **not** included or restricted; the site cannot enforce the user's real-world daily spend.

Personal picks, stakes, odds and void marks live in `localStorage`, not an account and not GitHub. Browser data can be cleared or tampered with and is not independent proof of a bet, prediction time or settlement. Export a private JSON backup and import it on a device as needed; import validates the format, adds missing days and can combine the same suggestion and a single non-conflicting bet. It refuses the entire import if a day has a different suggestion or conflicting bet details, rather than replacing a bet. Backups are not automatically synced or encrypted. If storage is corrupt, unavailable or full, the panel warns and does not silently replace the record or claim to save a new pick.

## Prediction model and backtest

For each team, the model uses up to its last **10 available completed league matches in the current season**, strictly before the current UTC date. It averages the team's goals scored with the opponent's goals conceded, adjusts for the team's last five results and a modest home/away factor, then uses independent Poisson distributions to estimate scorelines and home-win/draw/away-win probabilities. At least three prior results per team are required. Future fixtures in the window all use the currently available history; results from matches that have not yet happened are not projected into it.

The backtest runs separately for each league and season using available previous- and current-season results. Matches are evaluated chronologically, and **all games on the same date are predicted before any result from that date is added**. Games with fewer than three earlier results for either team are skipped. It reports top-outcome accuracy using unrounded probabilities, an always-predict-home-win baseline, multiclass Brier score and log loss. Brier and log loss are lower-is-better. The results are a limited historical check, **not proof of future accuracy or calibration**, and reflect only the records available from the sources.

## Prospective track record

The **Track record** section begins when this feature is first successfully deployed; it never manufactures historical predictions. It measures correct home/draw/away picks divided by the number of scored forecasts, overall, by league and by the month of the match. Pending matches and the most recent results are shown separately. The historical backtest above is a simulation, **not** the prospective record, and it uses unrounded probabilities; the track record excludes a rounded tie rather than scoring a hidden tiebreaker. Small samples are not reliable evidence of future accuracy.

The on-site **Performance check** compares the locked model picks with a fixed **always-home-win** rule on the same publication-verified, unambiguous scored matches. The baseline is computed from those results for comparison; it is not a separate archive of forecasts that were published before kick-off. Pending, unverified, excluded and local-preview records are not used. No percentages or probability scores are fabricated while the scored sample is empty.

Its **calibration** table groups the saved, unrounded home/draw/away probabilities into five bands: `[0%, 20%)`, `[20%, 40%)`, `[40%, 60%)`, `[60%, 80%)` and `[80%, 100%]`. Each row shows the number of chances, their average forecast probability and the number and proportion that occurred; displayed values are rounded. The all-outcomes view includes three related chances per scored match, so those counts are not independent matches and can mask outcome-specific effects. Use the home, draw and away views to inspect each separately. The three-class **Brier score** averages the sum of squared errors for all three probabilities per match (0 is best, 2 worst); it measures overall probability error, not calibration alone. Corrections or exclusions in the community data can change these descriptive figures, and neither a small sample nor a good past score guarantees future accuracy. The feature does not change the model or retrospectively recalibrate saved forecasts.

The embedded **Full record** lets visitors browse every recorded forecast, including pending and excluded entries. It supports team or league search, league/status/date filters, sorting and pagination. Dates use the reported result date where available, otherwise the latest known scheduled date; filters change the list, not the all-time scorecard above. Expanding a record shows its frozen pick, probabilities, expected goals, model inputs, original and latest known kick-offs, any observed score, verification timing and exclusion reason. The verification timestamp is when a later build observed the forecast on the published site, not its exact publication time. This is a read-only view of the same Pages ledger; browser filters never change the stored forecasts.

On each successful Pages build:

1. Restore and validate the ledger from the previously published site. A prediction is frozen only if it has at least three previous results per team, a known kick-off, no existing result or rounded tie, and a fresh source. It must be **2–48 hours before the approximate kick-off**, and the fixture's listed calendar date must be later than the forecast's UTC date. The pick, probabilities, model inputs and original kick-off are saved; the pick is never replaced by a later estimate. Matches outside these rules are not tracked. Browser-only fixture refreshes do not create ledger entries.
2. A subsequent build must actually observe the forecast on the published Pages site **before the original and latest known kick-off**, while a fresh source still lists it as upcoming and has no result. Until then it is awaiting a publication check. If verification is too late, it is permanently excluded rather than being counted as an apparently advance prediction. Outages, delayed deployments and the daily schedule can therefore leave some matches untracked or excluded.
3. A result is considered no earlier than the **next UTC day**, when a unique completed score appears in the community feed. Reschedules retain the original forecast, and score corrections update the result; contradictory duplicate scores or dates are excluded until the conflict is resolved. If an available source later removes a scored result, it is excluded until the result reappears. A result dated before the verification day is also excluded. Missing leagues, renamed clubs or unavailable results can leave forecasts pending. Accuracy only includes verified, unambiguous results; it is not a measure of all fixtures.

The feed's fixed **UTC+1 kick-off convention is approximate**, the provider can be late or wrong, and a source error can still affect whether a match is considered upcoming. This is not an independent timestamping or official results service. Verify fixtures with official sources. The UI marks delayed tracking data and does not pretend that demo or browser-only estimates have been recorded.

### Refresh health and alerts

The on-site **Refresh & backups** panel shows the published ledger time, its community-source time, the latest `main` Pages workflow status and overdue results. It marks history over 36 hours old, a source over 48 hours old, unavailable data and failed checks; the thresholds use the visitor's device clock. Workflow status is read from GitHub's public API in the browser, every 30 minutes or on retry. A rate limit, network failure or unconfigured/local preview is shown as **unknown**, never as a successful run. This request exposes the visitor's IP to GitHub. A successful workflow means its build, deployment and post-deployment backup completed; it does not guarantee the source's football data is correct or live.

**Overdue results** flags a tracked forecast that is still pending, without a score or an exclusion, once the last known kick-off is at least **48 hours** in the past. The expandable list shows all flagged fixtures and their latest approximate UTC+1 kick-offs. Excluded records have their own status in the full record and are not counted as pending. The page rechecks the threshold each minute using the device clock and the last loaded ledger; the ledger itself is reloaded every 30 minutes. A wrong clock, stale history, a changed schedule or a delayed community source can affect the warning. No warning proves a match was played, postponed or ended with a particular score; check a reliable source. An unavailable or local-preview ledger is not treated as a healthy published check, and a stale ledger with no flags is not marked healthy.

After a successful deployment and backup have confirmed that the exact ledger is public, the workflow opens a separate public **Overdue forecast results need attention** issue if any entries meet the threshold. The alert job rechecks the public bytes before changing an issue, so retrying an older job cannot use an outdated artifact. It normally comments only when the set or latest kick-offs change, avoiding a daily repeat for unchanged entries; a retry after a partial failure may repeat a comment. A later confirmed ledger with no overdue pending entries closes the bot-owned issue; a result, reschedule or exclusion could all remove a flag. A failed build, deployment, backup or overdue check cannot close the existing overdue issue. A ledger more than 36 hours old or a suspect workflow clock makes the check fail rather than resolve an issue. Issue checks happen only on confirmed runs, not precisely at the threshold, and GitHub schedules can be delayed or skipped. The issue links to the on-site list and the workflow; no team names from the feed are copied into issue Markdown.

If the build, deployment, confirmed backup, source-health check or overdue monitor fails, a separate least-privilege job opens or updates a public **Forecast refresh or backup needs attention** issue and links the run. An overdue result by itself does not fail the workflow. A later fully healthy run closes the refresh issue. GitHub email or mobile notifications depend on the owner's GitHub notification/watch settings; no independent email or SMS service is configured by default. A cancelled workflow, disabled schedule, GitHub/API outage, or failure of the issue job itself may prevent an issue being opened. The site can still warn about an aging ledger when someone visits, but this is **not independent uptime monitoring**.

### Independent watchdog (optional)

The repository includes an **opt-in** watchdog. It is **not active just because this code is deployed**; the owner must set up both services and verify delivery. It has two separate checks, with two different secret ping URLs:

- **Published-ledger freshness:** a Cloudflare Worker independently reads the [public ledger](https://johnazani.github.io/Match_predictor/data/track-record.json) hourly at minute 43 UTC. It sends a Healthchecks.io success ping only if the ledger is reachable, has the valid published schema, has no suspicious future update time and is at most 36 hours old. A Healthchecks simple schedule of **1 hour with 2 hours' grace** alerts after about three hours without a healthy ping, including when the Worker itself stops. The Worker does not check football-source freshness, confirm backup success or verify the truth of scores.
- **Scheduled refresh:** after the first attempt of an actual `schedule` event, GitHub sends a separate success ping only if build, deployment, verified backup and the notification/overdue-monitor job all succeeded. Pushes, manual refreshes and reruns never send this ping, so they cannot hide a missed schedule. Configure this Healthchecks check for cron **`17 6 * * *`, timezone UTC, with 3 hours' grace**. A sufficiently delayed or failed run can therefore cause an alert even if it later recovers.

A freshness alert may arrive several hours after the ledger first goes stale; this is not immediate uptime monitoring. A very late scheduled event could also arrive after a later due time and make the schedule check look recovered; a rerun cannot. The checks depend on Cloudflare, Healthchecks.io and email delivery as well as the public Pages endpoint. They detect problems; they do not automatically rerun or repair GitHub Actions. If the external ping itself fails, the scheduled-heartbeat job fails visibly even though deployment and backup may already have succeeded. The website links to this guide but **cannot determine whether your private external checks are active**.

**Set up the checks** (requires your own Cloudflare and Healthchecks.io accounts):

1. Create two checks in Healthchecks.io with the settings above. Configure and verify an email notification integration for each. Use the default UUID-based `https://hc-ping.com/...` **success** URL for each check, not a `/start` or `/fail` URL, and keep both URLs private. Do not paste them into an issue, commit, log or chat. Optionally set each check's filtering rule to **Only POST**, but leave content filters off; these pings have no body. A paused or filtered check might acknowledge a ping without changing state, so confirm it is `Up`. The public ledger is read without a GitHub token; no match data is sent in the ping body.
2. In your GitHub repository, go to **Settings → Secrets and variables → Actions → New repository secret**. Add the schedule check's URL as `SCHEDULE_HEALTHCHECK_URL`. When it is absent, the optional heartbeat job explicitly says it is not configured and does not make an external request. If present but invalid or unreachable, the heartbeat job fails instead of pretending it succeeded.
3. From a local checkout with Node 22+, check that the Worker name `pitchside-ledger-watchdog` in `watchdog/wrangler.toml` is unused in your Cloudflare account. If it already exists, choose a unique name in that file first: deploying to an existing name can overwrite its Worker. Sign in using Wrangler's own browser flow, deploy the Worker, then add the freshness check's URL as a **Cloudflare Worker secret**. Enter the URL directly into Wrangler's prompt, not in chat or on the command line:

   ```sh
   npx wrangler@4.156.0 login
   npx wrangler@4.156.0 deploy --config watchdog/wrangler.toml
   npx wrangler@4.156.0 secret put FRESHNESS_HEALTHCHECK_URL --config watchdog/wrangler.toml
   ```

   The Worker has no HTTP handler; its configuration declares no custom routes and disables its `workers.dev` and Version URLs. It does not require a GitHub credential and reads the fixed Pages URL in `watchdog/ledger-health.js`. Change that URL if deploying a fork. Cron configuration changes can take time to propagate. The Worker logs fixed reason codes, not ping URLs or ledger contents. A bundling-only check without deployment is `npx wrangler@4.156.0 deploy --dry-run --config watchdog/wrangler.toml`.
4. **Arm and test both checks.** Healthchecks.io checks start as `New` and cannot detect a missed ping until they have received an initial success. Wait for the freshness check to turn `Up` after the Worker runs. The schedule check stays `New` until a successful scheduled run, unless you initialize it manually once. A one-time manual initialization is **not evidence of a successful scheduled run**; confirm that its next due time is 06:17 UTC. In a private local Bash shell, with shell tracing off, you can initialize it without putting the URL in command history:

   ```bash
   read -r -s -p 'Schedule check success URL (hidden): ' SCHEDULE_PING; printf '\n'
   if RESPONSE=$(printf 'url = "%s"\n' "$SCHEDULE_PING" | curl --config - --fail --silent --show-error --max-time 10 --proto '=https' --request POST) && [ "$RESPONSE" = 'OK' ]; then
     printf 'Ping accepted. Confirm the check is Up in Healthchecks.io.\n'
   else
     printf 'Ping not confirmed. Check the URL and dashboard.\n' >&2
   fi
   unset SCHEDULE_PING RESPONSE
   ```

   Check that notifications reach the intended inbox. Test expiry and recovery with a **disposable** check rather than falsifying the real schedule's history. Check Cloudflare logs and Actions job summaries if either check remains `New`; do not assume an alert is active until it is armed and delivery has been tested.

[Healthchecks.io pricing](https://healthchecks.io/pricing/) and [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) can change. Free tiers may suffice for these two checks and one hourly Worker, depending on account usage; monitor quota and billing. The Worker validates the full ledger, which grows over time; exceeding a Worker CPU or memory limit stops its ping and can raise an alert even if the public ledger is valid. Do not commit `.dev.vars`, `.env` or `.wrangler` credentials.

### Backups and recovery

Pages remains the primary ledger: each build restores the last public copy and fails closed if it is missing or invalid. The existing `forecast-ledger` Actions artifact is kept for 90 days, but it is created **before** deployment and is not, by itself, proof of publication.

After a successful deployment, the backup job downloads that build artifact and waits until the exact bytes are observable on the public Pages URL. Only then does it upload a copy to the public, machine-managed [`forecast-ledger-backups` GitHub Release](https://github.com/johnAzani/Match_predictor/releases/tag/forecast-ledger-backups), download it again and verify its SHA-256 checksum and ledger schema. The tag is a storage location, not a code release or independent timestamp. After the new upload is verified, rotation keeps the 10 newest copies plus the newest on each of the latest 30 backup days, 24 months and 5 years; only matching assets uploaded by `github-actions[bot]` are removed. The Release and its files are public, remain on GitHub and can be changed or deleted by repository administrators. Download **history** from the site and save an independent copy elsewhere if stronger protection is needed.

Before a normal deployment the workflow compares the restored public ledger with the latest checksum-verified Release backup and refuses to proceed if recorded forecasts, frozen inputs or earlier publication verifications disappeared or changed. It also checks continuity between the restored and newly generated ledgers. Once the site indicates that backups are enabled, a missing, unreadable or corrupt managed backup fails the build rather than silently starting over. On the first deployment of this feature the old site has no backup marker; the new Release is created after that deployment. If the first backup job fails, fix the reported permission or network problem and rerun its failed job in GitHub Actions before expecting later builds to proceed.

To check a downloaded Release asset without publishing anything, keep its original filename and run `npm run verify-backup -- /path/to/forecast-ledger-...json`. This verifies the filename's checksum, timestamp and schema, **not independent proof of publication**. Consult the associated successful deployment and backup job as well; a failed pre-deployment artifact is not proof that its forecasts were public.

For deliberate recovery, first inspect the latest public ledger, the successful deployment history, available 90-day artifacts and independent copies. Forecasts newer than the most recent Release backup may be permanently lost and must never be reconstructed as genuine predictions. Then, in Actions, select **Recover forecast history (manual)** on `main` and type `RESTORE LATEST VERIFIED BACKUP`. The workflow uses only the latest bot-created managed Release asset after checksum/schema verification; it refuses network/5xx errors, an already-current backup and overwriting a newer valid public ledger. It restores the saved ledger byte-for-byte without generating predictions, builds a fresh fixture snapshot separately, and checks that the exact ledger can be observed on Pages after deployment. The next normal Pages run continues from that ledger. Recovery requires Actions/Pages permissions, a reachable community feed and the existing `github-pages` environment approval rules. It cannot prove that a missing or corrupt public ledger had no newer, unbacked forecasts; the explicit confirmation accepts that risk.

The Release backup job needs `contents: write`, and the isolated alert job needs `issues: write` through `GITHUB_TOKEN`; repository or organization policy may deny these permissions. Failure is visible in Actions and on the site's run-status panel when GitHub's API is reachable. No personal access token is stored in the site or required by the workflows.

## Usage rights and deployment

The open-matchday compilation permits informational, non-commercial use with attribution and says that upstream provider rights also apply. Its disclaimer states that its data is not betting advice or a prediction product and asks users to check providers' terms and seek permission for uses beyond personal consumption, including apps and redistribution. The [league index](https://github.com/oladeeayo/open-matchday/blob/master/LEAGUE_INDEX.md) lists FixtureDownload among the sources for all four leagues. [FixtureDownload's terms](https://fixturedownload.com/terms) restrict republishing and transmitting its materials to another website without express written permission. The compilation does not establish that this project has that permission or resolve which rights apply to each row. This concern may also affect the already-deployed site and its public history. Attribution and public availability are not a substitute for permission.

The daily panel is an informational display and calculator, not a bookmaker, but its betting-related context does **not** establish permission to publish or redistribute the underlying data. Check the [compilation disclaimer and each provider's terms](https://github.com/oladeeayo/open-matchday/blob/master/DISCLAIMER.md) and obtain any necessary rights before publication or further distribution. A commercial product or real-time service needs an appropriately licensed football-data provider, reliable time-zone-aware kick-offs, an operational cache, and further model evaluation/calibration.

### Replacement-source research — not integrated

[5DollarFootballAPI](https://5dollarfootballapi.com/) is the intended replacement, **checked against the real API but not yet integrated**. Its [terms](https://5dollarfootballapi.com/terms) expressly allow data in websites, models and public displays and caching; free public products must link the credit “Football data by 5DollarFootballAPI”. The terms prohibit redistributing raw responses as a competing data feed, so whether this site's public JSON snapshots and ledger backups qualify should be confirmed with the provider. The provider disclaims accuracy and suitability for betting.

On 5 November 2026 the read-only preflight passed with a real free-plan key: 7 requests over an 85-day history and 14-day future window returned 90 finished / 10 scheduled / 1 unknown (Premier League), 110 / 10 / 6 (La Liga), 72 / 9 / 0 (Bundesliga) and 100 / 10 / 0 (Serie A). That confirms authenticated access, the four documented league IDs, UTC kick-off fields, `finished` plus `status_code: full` settlement, pagination and the documented response shapes. It does **not** confirm result accuracy, update frequency, that old forecasts can be matched to new team names, or permission to publish. The key stays in the Actions secret and is never written to the site, the ledger or the browser.

The advertised [free plan](https://5dollarfootballapi.com/pricing) requires an account and covers the existing four leagues, with 60 requests/hour (at most 20/minute) and the most recent three months of results. It does **not** cover Europa League; the provider lists that competition on its $5/month Pro tier. A paid plan would require a separate decision and would not by itself add Europa to this model. Do not paste an API key into chat, source code or a browser build; a future integration must read it only as a server-side GitHub Actions secret.

The `.github/workflows/provider-preflight.yml` is an **opt-in, read-only check**, not an integration or a deployment. The owner saved its free-plan key as the repository's Actions secret `FIVE_DOLLAR_API_KEY`; the Copilot “Agents” secret store looks similar but is not readable by workflows. Adding the `run-provider-preflight` label to a pull request from this same repository runs the check against the four leagues. It makes at most 12 requests per run, refuses redirects and incomplete or malformed pages, reports aggregate counts only (as a workflow annotation, because public-repository logs need a signed-in session), and does not save raw data or change the site or ledger. A passing check does not prove the results are accurate or fresh, that old forecasts can be matched safely, or that publication is permitted. The live site and the Pages workflow do not use this key.

Switching future fixtures would not settle the rights question for old source-derived forecasts already in the public ledger and Release backups. The live-prediction model only needs each team's last ten results, so a three-month window is enough for new forecasts; the historical backtest stays on the CC0 openfootball files and does not depend on the new provider. Those records must not be silently dropped or rewritten. The current tracker intentionally refuses a feed whose source name is not `open-matchday`: this guard is not a licence check, but prevents a simple source substitution from silently changing the historical record. A real migration must explicitly handle changed team and fixture identities, review ambiguous or unmatched pending forecasts, preserve frozen predictions and publication checks, and avoid treating results outside a provider's rolling history window as retracted. It must also replace the Pages browser fallback, preserve backup/restore continuity, and verify the new provider's actual data and permissions before deployment.

### Migration preparation

`server/providers/five-dollar.js` is a read-only adapter, tested offline against synthetic provider payloads. It is designed to keep one identity space so the ledger survives a source change:

- league ids stay this site's ids, never the provider's numeric ones;
- season labels reuse the shared `seasonFor` helper, so `matchId(season, league, home, away)` is unchanged;
- provider club names resolve through `server/providers/team-aliases.js` onto the frozen roster in `server/providers/community-teams.js`, which holds the exact community spellings already baked into published forecasts.

Resolution fails closed: an unmapped club is dropped and reported, never matched by similarity, and an alias pointing outside the roster resolves to nothing. Only `finished` rows with `status_code: full` become results; `in_play`, `unknown` and stale `scheduled` rows become neither results nor fixtures. Kick-offs convert from UTC to the fixed UTC+1 the site displays.

The adapter is **not wired into the live site**: `createDataService` still reads the community feed, and the tracker still refuses any other source name. `npm run audit:teams`, or the label-triggered `provider-audit.yml`, runs it against the real provider and reports per competition how many results and fixtures it would produce, how many clubs it saw, and the exact provider names it could not map — no scores, odds or raw rows. The report is posted as a pull-request comment. A clean audit only proves name mapping, not accuracy, freshness or publication rights.

## Assets

- Club crests are included for illustrative identification, sourced from the [football-logos collection](https://github.com/JoseArroyave/football-logos). Club names and marks belong to their respective owners; check rights before commercial use.
- The stadium hero image was generated for this project.
- Icons use [Lucide](https://lucide.dev/); fonts are Manrope and Barlow Condensed via Fontsource.
