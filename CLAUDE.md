# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page Vietnamese team-lunch cost tracker (`index.html`, inline HTML/CSS/JS — no framework, no build step) plus two Vercel serverless functions that persist data by committing a JSON file to a dedicated branch on this same GitHub repo.

Deploys as a Vercel static site + serverless functions. No `package.json`, no bundler, no test suite — the API uses built-in `fetch` on Node 20+. Shared GitHub helpers live in `lib/github.js`; route handlers are in `api/data.js` (bulk GET/PUT) and `api/claim.js` (atomic task claim/release).

## Running / deploying

- **Local preview (UI only):** open `index.html` in a browser. The `/api/data` call will 404; the app falls back to 10 default members and an empty week set, which is enough to exercise the UI.
- **Full local run with persistence:** copy `.env.local.example` → `.env.local` and fill in `GITHUB_TOKEN`, then `vercel dev` from the project root. This serves `api/data.js` at `/api/data` with GitHub-backed persistence.
- **Production:** pushed to `main` on `github.com/thetai161/mkt-lunch` and auto-deployed by Vercel. `GITHUB_TOKEN` must be set in the Vercel project's environment variables (Settings → Environment Variables) for all environments that need persistence.
- There are no tests and no lint config.

## Architecture

### Persistence model (important — easy to get wrong)

The app has **two separate persistence layers that must not be conflated**:

1. **Shared data** (members, weeks, startWeekKey) lives in a file `data.json` on the dedicated `data` branch of this same repo. The app's `main` branch is code-only and never touched by the API, which is why saves don't re-trigger Vercel builds.
   - Auth: `GITHUB_TOKEN` env var (Fine-grained PAT with `Contents: Read and write` on this repo). Never hardcode. Owner/repo/branch/path/committer can be overridden via `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_DATA_PATH`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL`.
   - Committer is fixed (`Team Lunch Bot <bot@mkt-lunch.local>` default); commit **messages** are dynamic.
   - `Cache-Control: no-store` on both endpoints so Vercel's edge cache can't serve stale reads.

   Two write paths exist and they own different fields of the JSON — **don't confuse them**:

   **`api/data.js` — bulk GET/PUT** (everything EXCEPT task assignments)
   - `GET` → return the file contents (or `EMPTY_PAYLOAD` if missing)
   - `PUT` → fetch current file for `sha` + old data → **merge: take `weeks[*].assignments` from server, everything else from body** (`mergePreservingAssignments`) → `describeDiff(old, merged)` builds a human-readable commit message → commit
   - The merge is load-bearing: without it, a slow bulk save would silently overwrite claims made by others during the edit window.
   - On `409`/`422` stale sha → retry once with fresh sha. Still last-write-wins on the second attempt for the fields bulk-PUT owns (costs, members, contributors, qrImage, rolloverOverride, startWeekKey).

   **`api/claim.js` — atomic POST** (task assignments only)
   - Body: `{ weekKey, dayKey, task, memberId, action: "claim"|"release" }`
   - Validates `task ∈ {main, soup, fruit, rice}`, memberId exists in `members`.
   - Reads `weeks[weekKey].assignments[dayKey][task]`:
     - `claim` + slot null → set to memberId, commit
     - `claim` + slot = same memberId → 200 no-op (idempotent for double-click)
     - `claim` + slot = someone else → **409** with `currentClaimerName` (client shows toast)
     - `release` + slot = memberId → set null, commit
     - `release` + slot = someone else → **403** (first-writer-wins rule: only the claimer can release)
   - Retries up to 3 times on stale sha. Under concurrent claims to the *same* slot the second attempt re-reads the slot (now occupied) and returns 409 correctly — sha retry never silently overwrites a claim.
   - Commit message format is Vietnamese: `Nguyễn A nhận Canh (T3 15/04)` / `Trần B huỷ Cơm (T5 17/04)`.

2. **UI-only state** in `localStorage` under two keys:
   - `teamLunchUI` — active tab, active day, current week (scroll state). Never put shared data here.
   - `teamLunchUserId` — the **trust-based identity** of this device's user (a member id). There is no real auth: the user picks themselves from a modal on first visit; this id is sent as `memberId` in `/api/claim` calls. For a 10-person team with low stakes, this is fine. If identity becomes critical, replace `_loadCurrentUser` / `setCurrentUser` / `openUserModal` with a real auth flow.

### Save flow (two modes)

- **Bulk tabs (Chi phí, Quỹ, Team)** — explicit save. Mutating actions call `save()`, which only reveals the "Lưu" bar; the actual PUT happens on `doSaveClick`. `doDiscardClick` reloads from the API to drop in-memory edits. `_loaded` gates saves so a failed initial load can't wipe the file.
- **Task tab** — instant save. Each click on `+ Nhận` / `✕ Huỷ` directly POSTs to `/api/claim` (= one commit). The "Lưu" bar is **not** used for assignments. The server response returns the updated `assignments` for that day, which is merged back into `state.weeks[wk].assignments[dk]` — so other in-flight edits on non-assignment fields are preserved.

### Auto-refresh

A `setInterval` (every `REFRESH_INTERVAL_MS = 10000`) re-fetches `/api/data` and replaces `state.weeks` / `state.members` / `state.startWeekKey`. This is how users see each other's claims appear. It is **suppressed** when:
- The "Lưu" bar is showing (user has unsaved bulk edits — a refresh would wipe their inputs), OR
- The identity modal is open.

After each refresh, `currentMemberId` is revalidated against `state.members`; if the user was removed from the team, the id is cleared and they're reprompted.

### Week/rollover model

- Weeks are keyed by the Monday's date as `YYYY-MM-DD` (`getMondayOf`, `dateKey`). All week lookups go through these keys — don't build keys by hand.
- `state.startWeekKey` marks the first week the app tracks. Weeks before this key always contribute 0 to rollover calculations, which breaks infinite recursion when the history is empty or partial.
- `getWeekRollover` / `computeWeekEndingBalance` are **mutually recursive** and walk backwards week-by-week. Depth is capped at 104 (two years) as a safety rail — if you extend history further, raise the cap. A per-week `rolloverOverride` short-circuits the recursion, which is how the Fund tab's manual override works.
- Constants at the top of the `<script>` block drive the math: `FUND_PER_PERSON = 150000`, `WEEKDAYS = 5`, `RICE_PRICE = 0`. Changing these changes fund/spend calculations everywhere.

### Schema versioning

`SCHEMA_VERSION` in `index.html` and `schemaVersion` in `data.json` on the `data` branch must stay in sync. The current shape is v3:

```
{ schemaVersion: 3, members: [{id, name}], weeks: { "YYYY-MM-DD": { days, assignments, contributors, qrImage, rolloverOverride } }, startWeekKey: "YYYY-MM-DD" | null }
```

`data.json` at the repo root on `main` is a **reference/seed shape**, not a runtime file — nothing reads it. The live data lives at `data.json` on the `data` branch, which `api/data.js` reads and writes.

### Rendering

`render()` rebuilds the active tab into `#tabContent` on every state change — there's no diffing. The five tabs (`cost`, `summary`, `tasks`, `fund`, `team`) each have a `render*Tab(root)` function. Inputs call `save()` (queues UI save state) and mutate `state` directly; they don't go through a setter layer.

### UI language

All user-facing strings are **Vietnamese**. Keep that convention when adding UI; developer-facing comments/code are a mix of Vietnamese and English, follow whatever the surrounding code uses.
