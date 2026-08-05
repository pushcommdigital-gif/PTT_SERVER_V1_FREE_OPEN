# Phase 2 — De-vendor & Scaffold (2026-08-05)

Status of CLAUDE.md §10 Phase 2: **complete**. CI is green on all five jobs.
Remaining items are owner actions and verification that needs other hardware —
listed at the end.

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

## 5. Dispatch pop-out — resolved

The owner supplied two screenshots. The bug was two things, both now fixed.

### The text turned black

`index.html` sets the console's white text as an inline `color:#fff` on
`<body>`. `text-text-primary`, used for transcript lines and similar body copy,
refers to a token that **is not defined in the `@theme` block in either
edition**. Tailwind emits no rule for it, so the element simply **inherits** its
colour: `#fff` in the console, and — because `PopoutWindow` set the popup body's
background but never its colour — the browser default in the popped-out window.
Black text on a dark panel.

The screenshot itself confirms the mechanism: badges, secondary greys, borders
and backgrounds all use explicit tokens and rendered correctly. A stylesheet
that failed to load would have broken everything, not one line.

Fixed at both levels — `PopoutWindow` mirrors the opener's root/body classes and
computed colour, and `--color-text-primary` is now a real token in dispatch and
dashboard. In CE the token is currently latent (every file that used it was
stripped as an add-on), so the shell sync is what protects CE today; the token
protects whatever uses it next, and V2 at Phase 4.

### The empty shell

Popping a panel out left a full-size panel behind containing only "Opened in a
separate window / Bring back" — the map stayed covered by a dead rectangle,
which is the opposite of the point. The panel now disappears from the console
while popped out; its top tab stays lit, and closing the popped-out window
re-docks it at the same position and size.

### Window chrome

The popup opened on `about:blank`, which browsers display in the location strip
and which reads as broken. It now opens a real same-origin host document,
`apps/dispatch/public/popout.html`, with `popup=yes`. That also gives the child
a proper base URL so cloned stylesheet links resolve natively, and the host page
carries the same `class="dark"` root and `color:#fff` body as the console.

Earlier in the phase three further defects were fixed in the same file: an
orphaned window left behind on console reload, stylesheet hrefs resolved against
an unreliable base URL, and later style additions never mirrored.

**Known and not fixed:** React unmounts and remounts a portal's subtree when the
portal container changes, so popping a panel out still resets that panel's
internal state — the map re-initialises, list scroll is lost. Inherent to the
portal approach.

**Decision recorded:** fixes land in CE only. V2 shows the black text until
Phase 4 re-plumbs it onto this core.

## 6. Open items

1. **`CLA_SIGNATURES_TOKEN`** — owner action; the bot is inert without it.
2. **Legal review of `CLA.md`** — before the first outside PR.
3. **Confirm the pop-out fix on a real second monitor.** Verified as far as this
   machine allows (build, image serves `/popout.html` as the host page rather
   than falling through to the SPA, served markup carries the root class and
   body colour), but nobody has yet dragged a popped-out panel onto a second
   display and read the text.
4. **Carried from Phase 1: verify LiveKit end-to-end on a Linux host.** Docker
   Desktop for Windows cannot exercise `network_mode: host`, so the API→LiveKit
   leg is still unproven. CI's stack job does not cover it either. **This must
   happen before tagging v1.0.0** — it is the difference between "the stack
   boots" and "voice actually works".

## 7. Next (Phase 3)

Tag `v1.0.0`, flip the repository public, and verify a clean-room
`docker compose up` from the public repo alone on a Linux host.
