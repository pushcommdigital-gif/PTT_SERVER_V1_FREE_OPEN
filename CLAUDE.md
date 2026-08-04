# PushComm Community Edition — Project Guide & Build Plan

> This file is the working context for **PushComm Community Edition (CE)** — the free,
> open-source core of the commercial PushComm platform. It is both the onboarding doc
> (read first) and the extraction/build plan. Source lives in `D:\PTT_SERVER_V1_FREE_OPEN`;
> the commercial product lives separately in `D:\PTT_SERVER_V2` (private).

---

## 1. What this is

PushComm CE is a **real, fully working, self-hosted PTT-over-cellular server + clients** —
not a crippled demo. A small team can run it forever, unlimited users, no strings attached.
It is the **open core** of the commercial product: the paid version is *CE + private add-ons*.

- **License:** **AGPL-3.0** + a **Contributor License Agreement (CLA)**.
- **Brand:** "PushComm Community Edition." The trademark stays with the commercial side.
- **Deploy:** self-hosted via Docker Compose only (no hosted/SaaS in CE).
- **Model (RESGRID-style open core):** CE builds credibility, community, contributors, and
  bug-finders, and is a lead funnel. Revenue comes from the **paid add-ons, a future SaaS,
  managed VPS deployment, and support/SLA** — never from crippling CE.

## 2. The free ⇄ paid boundary

CE is the whole stack **minus** the paid add-ons. This table is the canonical reference.

| **In CE (free, this repo)** | **Commercial add-on (private, NOT in this repo)** |
|---|---|
| PTT voice: groups, all-call, private 1:1, server-arbitrated floor control | Transcription (on-box Whisper) + transcript search/keyword alerts |
| Live map (real-time GPS positions) | Telematics / Location Intelligence: Valhalla snap-to-road, trips/timeline, speeding, scorecards, adaptive GPS |
| Messaging (direct + conversations) | Traffic overlay (TomTom) |
| Users / groups / group-types / roles | AI copilot (planned) |
| Devices (IMEI activation, sessions) | Visual Verification Suite (incidents + media capture) |
| Call recording + CDR (LiveKit egress) | OTA fleet updates (app releases + Device-Owner silent install) |
| **SOS / Lone Worker** | DB backups (scheduled/off-site) |
| **Zones / POIs / geofence alerts** | Seat-tier licensing enforcement (`hasFeature`, seat caps) |
| Dispatch console (floating panels; multi-monitor pop-out once fixed) | Priority support / SLA / managed hosting / SaaS |
| Management dashboard (admin) | OEM **kiosk flavors** (F400 / Talkpod / Ulefone) + Device-Owner kiosk provisioning |
| Android app — **`smartphone` flavor only** | |
| Self-hosted Docker Compose + docs | |

**Borderline items to CONFIRM with the owner before finalizing (do not silently decide):**
- **Track Replay:** raw historical GPS playback (no map-matching) → *proposed CE*; the
  snap-to-road enhancement is telematics → *paid*. The **Timeline (trips)** view is fully
  telematics → *paid*. Confirm the split.
- **DDNS:** the current Cloudflare-specific DDNS is vendor-tied → *proposed: strip the
  Cloudflare specifics; ship a generic/no DDNS in CE.* Confirm.

## 3. Repo & sync model — Option B (public core = upstream)

**CE is the canonical core.** The commercial product consumes CE, it does **not** contain a
copy of it.

```
D:\PTT_SERVER_V1_FREE_OPEN   (this repo, public, AGPL)   =  the CORE
D:\PTT_SERVER_V2             (private, commercial)        =  CE (git submodule) + addons/ overlay + registrars
```

- The commercial repo pins CE at a commit via **git submodule**, adds a private `addons/`
  pnpm workspace, and injects the add-ons through the extension points below. One `pnpm` build.
- **Iron rule: the CORE never imports add-on code.** A community bugfix to PTT lands here and
  both editions get it — we never fix the same bug twice. Anything the core `import`s must be
  free/AGPL and shippable in this repo.
- **Feature flags protect nothing in open source.** What protects paid features is that their
  *source is not in this repo.* There is no `hasFeature`/license gate in CE at all — CE is
  simply the code without the add-ons.

## 4. Extension-point architecture (the heart of Option B)

The core must expose clean seams so the private layer plugs in without the core referencing it.

**API (Fastify) — a registrar list.** `buildApp({ registrars })` where a registrar is:
```ts
interface Registrar {
  registerRoutes?(app: FastifyInstance): Promise<void> | void;  // add Fastify plugins
  startWorkers?(deps): void;                                     // background workers
  stopWorkers?(): void;
  migrationsDir?: string;                                        // add-on SQL migrations
}
```
- Core registers only core routes/workers and passes **zero** add-on registrars.
- The migrate runner accepts **multiple migration sources** (core dir + each registrar's dir).
- Add-ons that react to core events (e.g. transcription on "recording finalized") use a core
  **hook/event bus** — the core emits, the add-on subscribes; the core has no knowledge of it.

**Web (dispatch + dashboard) — a panel/route registry.** Core exposes `registerPanel()` /
`registerRoute()`; the core app boots with an **empty add-ons index**. The commercial build
swaps in an add-ons index that registers the paid panels (LiveAudioTraffic, RoadTraffic,
Timeline, Incidents, etc.). Core ships the slots empty.

**Android — build flavors + source sets.** CE's app = `smartphone` flavor, core features only,
buildable standalone. The commercial build adds OEM flavors + paid features (kiosk/Device-Owner,
visual-verification camera capture, OTA self-update) via flavor-specific source sets / a private
Gradle module. Keep `main` free of paid code.

**Shared package (`@pushcomm/shared`).** Core types/constants only. Add-on-specific types
(e.g. `transcript:alert`, telematics events) live in the private add-on package; the core WS
event union is extensible.

## 5. Keep / strip manifest (from the V2 tree)

Reference — verify against V2 at extraction time; V2 layout: `apps/{api,dispatch,dashboard,
android-ptt}`, `packages/shared`, `docker/`.

**API — KEEP:** auth, users, groups, group-types, roles, stats, custom-states, user-states,
calls, units, audio-library, devices, messages, broadcast, private-calls, voice-channels,
voice-recordings (CDR), voice/floor (floor-control), geocoding, map, locations, sos,
zone-alerts, geofences, pois, settings, health, setup, livekit-webhook, ws. Services:
floor-control, livekit-egress (recording + stuck-recording reconciler), fcm, geocoding, crypto
(only if a core route needs it), media-request-expiry only if incidents are stripped→drop.

**API — STRIP (→ private addons):** routes `transcript-keywords`, `trips`, `traffic`,
`incidents`, `media`, `media-requests`, `incident-categories`, `app-updates` (OTA), `backups`,
`license`; services `transcription`, `valhalla`, `trip-builder`, traffic; `lib/license.ts`
(`hasFeature`) + `services/license-store.ts`; db/schema `trips` (+ transcript-keywords,
incidents/media schema); their migrations move to the add-on migration source. Remove all
`hasFeature()`/license calls and the add-on imports/registrations from `app.ts` (replaced by
the registrar mechanism).

**Dispatch — KEEP:** MapPanel, PttWidget + MicSettings, floating panels (fix the pop-out
placeholder bug), messages, SOS, zones/geofences/POIs, voice recordings panel, settings.
**STRIP:** LiveAudioTraffic (transcription), RoadTraffic (traffic), Timeline (telematics),
Incidents (visual verification); Track Replay per the boundary decision above.

**Dashboard — KEEP:** users, groups, roles, group-types, devices, custom-states, audio-library,
settings, zones. **STRIP:** transcription/traffic/telematics/map-data settings, License page,
incidents/visual-verification, OTA app-releases, backups.

**Android — KEEP:** `smartphone` flavor; PTT, map, messages, private call, SOS/lone-worker, GPS
(single-uploader foreground service). **STRIP:** OEM flavors + `kiosk/` package (Device-Owner),
camera/incident capture (visual verification), `AppUpdater` (OTA self-update).

**Strip everywhere (vendor/secret):** demo/kiosk mode, Cloudflare DDNS specifics, our VPS deploy
configs & IPs, license keys, `.env` with secrets → replace with generic Docker + `.env.example`.

## 6. License, CLA, notices, security

- **`LICENSE`:** AGPL-3.0. AGPL source headers on source files (script it).
- **CLA:** required from all contributors, wired via **CLA Assistant** bot. It must grant the
  project owner a **broad license-back / assignment** so contributions can be relicensed into
  the commercial product — this is what makes "AGPL core inside a proprietary add-on product"
  legal (the owner holds copyright + can dual-license their own core). Use a Harmony-style or
  Apache-ICLA-derived CLA. **Without this, Option B + proprietary add-ons is legally shaky.**
- **`NOTICE` / third-party attributions:** carry over the OSS inventory (note copyleft deps —
  PostGIS GPL-2.0, BusyBox/Alpine, etc.; LiveKit; MapLibre; OSM/ODbL for map data). No paid-only
  deps (Whisper/Valhalla/TomTom) appear in CE.
- **`SECURITY.md`:** private disclosure channel. Security response is non-negotiable (see §9).

## 7. Inherited architecture & conventions (same code as V2)

pnpm monorepo, ESM (`"type":"module"`, no `.js` ext in schema imports). **API:** Fastify plugin
routes, JWT `onRequest` auth hook, `{ success, data, pagination? }` shape, login by email OR
username. Every query scoped by `departmentId` from the JWT. **DB:** Postgres 16 + PostGIS,
Drizzle ORM, numbered SQL migrations in `apps/api/migrations/*.sql` auto-applied on boot (no
BEGIN/COMMIT — postgres.js simple protocol). **Real-time:** Redis/Valkey pub/sub →
`broadcast(departmentId, event)`; WS discriminated union in `packages/shared`. **Voice:** LiveKit
SFU, half-duplex, server-arbitrated floor (`floor-control.ts`), per-clip egress `.ogg` recordings.
**Gotchas:** raw `sql` template params must be primitives not `Date` (`.toISOString()`);
`db.execute()` returns a RowList (`[...result]`); never send `Content-Type: application/json`
with an empty body; `getUserMedia` needs HTTPS; React `const` not hoisted. (Pull the full detail
from `D:\PTT_SERVER_V2\CLAUDE.md` at extraction time.)

## 8. Deploy (CE)

Generic `docker/docker-compose.yml`: postgres+postgis, redis/valkey (ephemeral), livekit +
livekit-egress, api, dispatch, dashboard, optional martin (vector tiles), Caddy for TLS.
`.env.example` with placeholders (no secrets). A `README.md` quickstart: clone → copy env →
`docker compose up` → first-boot admin. No Whisper/Valhalla/TomTom services.

## 9. Community & maintenance model

Owner is the **primary maintainer initially** (community co-maintenance is aspirational; expect
bug reports first, PRs later, only after traction). Run it **low-support** with a hard floor:
- **Non-negotiable:** respond to security reports; keep `main` building & deployable (via **CI**).
- **Defer/decline at will:** features, non-critical bugs, most PRs, support questions.
- **Levers:** clear support-boundary note ("CE = community/best-effort; SLA is paid"); CI
  (build + tagged releases); Dependabot; issue/PR templates + `good first issue` labels; GitHub
  Discussions for self-serve support. A *neglected* repo (broken build / ignored security) hurts
  the paid brand — low-support is fine, neglected is not. Budget a few hours/month + release spikes.

## 10. Phased rollout plan

**Sequencing protects the live commercial product — ship CE first, re-plumb V2 second.**

- **Phase 1 — Clean extraction (this repo).** Fresh git init (NO V2 history). Copy the KEEP set;
  remove all add-on imports/`hasFeature` gates; introduce the **registrar** seam in `app.ts` and
  the web **panel registry** with empty core indexes; make the multi-source migrate runner. Get
  CE building & running standalone (Docker up, PTT + map + messaging + SOS + zones work).
- **Phase 2 — De-vendor & scaffold.** Generic compose + `.env.example`; strip demo/DDNS/VPS/secrets;
  add `LICENSE` (AGPL), `NOTICE`, `SECURITY.md`, `README`, `CONTRIBUTING`, CLA bot, issue/PR
  templates, CI (build + release), Dependabot. Fix the dispatch pop-out placeholder bug (it's CE).
- **Phase 3 — First public release.** Tag `v1.0.0`, publish the GitHub repo, verify a clean-room
  `docker compose up` from the public repo alone.
- **Phase 4 — Re-plumb V2 onto CE (private, careful, branch-first).** Add CE as a submodule in V2;
  move add-on code into `addons/`; register add-ons via the registrars; delete V2's now-duplicated
  core; verify the commercial build is identical in behavior before it replaces the running build.

## 11. Working conventions in THIS repo

- **Never commit secrets** (keys, real IPs, `.env`, license keys). `.gitignore` from the start.
- **Core never imports add-on/paid code.** If a change needs an add-on, it needs an extension point.
- AGPL header on new source files. Conventional commits. Keep `main` green (CI).
- After a meaningful change, note it in `Documentation/` (mirror V2's status-doc habit).
- Confirm the two **borderline boundary decisions** in §2 before Phase 1 finalizes anything.

---

*Owner: pushcommdigital@gmail.com. Commercial counterpart: `D:\PTT_SERVER_V2` (private).
GitHub: https://github.com/pushcommdigital-gif/PTT_SERVER_V1_FREE_OPEN (AGPL-3.0).
Decisions captured 2026-07-20; if any conflict with the owner's later direction, the owner wins.*
