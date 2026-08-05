# Phase 2 — De-vendor & Scaffold (2026-08-05)

Status of CLAUDE.md §10 Phase 2: **substantially complete**. CI is green on all
five jobs. Two items remain open, both listed at the end.

Phase 1 was pushed to GitHub this morning (still a **private** repo) after
rebasing onto the owner's README fix.

## 1. Community scaffolding

| File | Notes |
|---|---|
| `NOTICE` | Third-party inventory, licences read from the real lockfile and images |
| `SECURITY.md` | Private disclosure via GitHub advisories or email, with response times |
| `CLA.md` | Apache-ICLA-derived, per the owner's decision |
| `CONTRIBUTING.md` | Support boundary, architectural rules, dev setup |
| `README.md` | CE landing page: quickstart, TLS, architecture, free/paid table |
| `.github/workflows/{ci,release,cla}.yml` | |
| `.github/dependabot.yml` | Grouped, monthly |
| `.github/ISSUE_TEMPLATE/*`, `pull_request_template.md` | |
| `scripts/add-license-headers.mjs` | AGPL headers, idempotent, `--check` in CI |

**CLA choice.** Apache-ICLA-derived. Contributors keep copyright and grant a
perpetual, irrevocable, sublicensable copyright + patent licence — which is what
permits shipping community contributions inside the closed-source add-ons. The
document states that trade in plain language up front rather than burying it,
so someone can decline on an informed basis. **It has not been reviewed by a
lawyer.** Do that before accepting the first outside PR.

**Signature storage.** `pushcommdigital-gif/cla-signatures` was created
(private, initialised with `main`). Signatures land there rather than in the
public repo so contributor usernames and emails are not published.
**Outstanding:** the owner must create a PAT with `repo` scope on that
repository and add it to this repo as the secret `CLA_SIGNATURES_TOKEN`. Until
then `cla.yml` short-circuits and does not block PRs — deliberate, so the bot
cannot wedge merges before setup.

## 2. AGPL headers

251 source files across `apps/api`, `apps/dispatch`, `apps/dashboard`,
`packages/shared`, `apps/android-ptt` and `scripts/`.

An SPDX identifier plus a four-line notice, not the full GPL preamble — legally
sufficient alongside `LICENSE`, machine-readable, and it does not make every
file tiresome to open. `node scripts/add-license-headers.mjs` applies, `--check`
verifies, and CI runs the check.

## 3. CI

Five jobs. The first run failed three of them, all faults in the workflow
itself, all fixed:

- **Build order** — the API was typechecked before `pnpm build`, so
  `@pushcomm/shared` had no `dist/` and every import of it failed. It passed
  locally only because shared was already built. Classic works-on-my-machine,
  caught immediately.
- **`gradlew` not executable** — committed `0644` from Windows, so the Linux
  runner exited 126 before Gradle started. Fixed in the git index
  (`git update-index --chmod=+x`) so every clone gets it, plus a `chmod` in the
  job for the next Windows contributor.
- **Boundary guards matched themselves** — `git grep` searched the workflow file
  containing the patterns, and the Phase 1 record, which necessarily names what
  it removed. Both excluded.

The **boundary job** is the one worth keeping an eye on. It mechanically
enforces CLAUDE.md §3: no add-on imports, no `hasFeature`/seat-cap gating, no
vendor hostnames or placeholder secrets. A human reviewer will not catch those
every time; this will.

The **stack job** boots the full compose stack on a throwaway `.env`, waits for
health, asserts migrations ran and that neither Phase 1 startup bug regressed,
then drives the setup wizard, login, seeded roles and user creation. The user
creation assertion doubles as a guard that a seat cap never quietly returns.

## 4. Map licence compliance (found while writing NOTICE)

Two real defects, both fixed:

1. **The non-WebGL Leaflet fallback served OSM tiles with attribution
   disabled.** OSM data is ODbL and attribution is a licence condition, so this
   was a compliance failure rather than a cosmetic one. Restored on both
   renderers, embedded via `JSON.stringify` so any attribution string is
   quote-safe.
2. **The tile URL was hardcoded to the OSMF public tile server**, which its Tile
   Usage Policy asks redistributed products not to default to — every CE
   installation would have hit donated infrastructure. Now configurable via
   `VITE_MAP_TILE_URL` / `VITE_MAP_TILE_ATTRIBUTION`, with the reasoning at the
   call site.

`NOTICE` §4 also discloses honestly that the Android app links two
**proprietary** Google libraries (Play Services Location, Firebase Messaging).
Firebase is already optional. Play Services Location is not, so a fully
free-software build (F-Droid, de-Googled devices) would need it swapped for the
platform `LocationManager`. Recorded as a known limitation.

## 5. Dispatch pop-out

Three provable defects fixed in `PopoutWindow.tsx`:

1. **Orphaned window on console reload** — refreshing the console left the
   popped-out panel on the other monitor, portalled from a React tree that no
   longer existed: visible, frozen, silently stale. Now closed via `pagehide`.
2. **Stylesheets could fail to resolve** — `window.open('')` gives an
   `about:blank` document, and a cloned `<link href="/assets/…">` is relative,
   so whether it loads depends on how the browser assigns that document's base
   URL. When it doesn't, the panel renders unstyled. Hrefs are now resolved
   against the opener's `baseURI`.
3. **Later style additions were missed** — only a one-shot clone at open time,
   so Vite hot-updates never reached the popup. A `MutationObserver` on
   `document.head` mirrors additions now.

Also removed a stale-closure risk on `onClose` and kept the OS window title in
step with the panel title.

**Known and not fixed:** React unmounts and remounts a portal's subtree when the
portal container changes, so popping a panel out still resets that panel's
internal state — the map re-initialises, list scroll is lost. That is inherent
to the portal approach, not a defect in this file.

**Still open:** CLAUDE.md calls this "the pop-out placeholder bug", but the
pop-out is implemented and the in-console placeholder looks deliberate. The
owner has said the symptom is none of the three above and will describe it.
Do not close this out until that is reproduced.

## 6. Open items

1. **`CLA_SIGNATURES_TOKEN`** — owner action; the bot is inert without it.
2. **The actual pop-out symptom** — awaiting the owner's description.
3. **Legal review of `CLA.md`** — before the first outside PR.
4. **Carried from Phase 1: verify LiveKit end-to-end on a Linux host.** Docker
   Desktop for Windows cannot exercise `network_mode: host`, so the API→LiveKit
   leg is still unproven. CI's stack job does not cover it either. **This must
   happen before tagging v1.0.0** — it is the difference between "the stack
   boots" and "voice actually works".

## 7. Next (Phase 3)

Tag `v1.0.0`, flip the repository public, and verify a clean-room
`docker compose up` from the public repo alone on a Linux host.
