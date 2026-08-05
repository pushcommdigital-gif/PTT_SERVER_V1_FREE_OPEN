# Phase 1 — Clean Extraction (2026-08-04)

Status of CLAUDE.md §10 Phase 1: **complete and verified**. CE builds and runs
standalone. Not yet pushed to GitHub.

## 1. Repository

Fresh `git init` inside `D:\PTT_SERVER_V1_FREE_OPEN`, tracking
`origin/main` (the AGPL `LICENSE` + `README.md` initial commits). **No V2 history.**

A stray `.git` existed at the **`D:\` drive root** with `worktree = D:/`, so the
whole drive was one repo and every git command inside this folder resolved to it.
It held no commits, refs or index, but 1000+ dangling loose objects from an
aborted `git add` that had swept `D:\`. Deleted on the owner's instruction before
anything else — this had to be cleared or CE could not have its own repository.

`.gitignore` was written **before** any source was copied, secrets block first.

## 2. Extension points (CLAUDE.md §4)

| Seam | Where | CE state |
|---|---|---|
| API registrars | `apps/api/src/lib/registrar.ts`, consumed by `buildApp({ registrars })` | `index.ts` passes none; nothing in the repo implements `Registrar` |
| Core event bus | `apps/api/src/lib/events.ts` | Core emits `recording:finalized` from the LiveKit webhook; no subscribers |
| Multi-source migrations | `apps/api/src/db/migrate.ts` | Core dir only; refuses to start on a filename collision |
| WS event union | `packages/shared/src/types/ws-events.ts` | `WsEventMap` interface — add-ons widen it by declaration merging |
| Dispatch panels | `apps/dispatch/src/addons/registry.ts` + empty `index.ts` | No panels registered |
| Dashboard routes/nav | `apps/dashboard/src/addons/registry.ts` + empty `index.ts` | No routes registered |
| Android flavors | `apps/android-ptt/app/build.gradle.kts` | `smartphone` only |

Add-on routes register **after** core routes, and both registries reserve core
ids/paths, so an add-on can never shadow core behaviour.

**Iron rule verified:** `git grep` finds no import of any add-on package
anywhere in the core. The only matches are illustrative comments in the two
`addons/index.ts` files.

## 3. Boundary decisions applied

Locked by the owner before extraction:

- **Track Replay → CE, raw GPS only.** Kept the cleaned/segmented raw trail and
  playback. Removed `matchedShape`, the Valhalla map-matching call in
  `routes/locations.ts`, the outlier filter that only fed it, and the
  road-snapped playback branch (with its `sliceAtFraction` walker) in the panel.
- **Timeline (trips) → paid.** Panel, hook, routes, service, schema all stripped.
- **DDNS → dropped entirely.** `routes/ddns.ts` was 102 lines of pure Cloudflare
  API; nothing vendor-neutral remained once the CF specifics came out. The
  `cloudflare` config block went with it. Self-hosters use their own DDNS client.

## 4. What was stripped

**API** — routes: transcript-keywords, trips, traffic, incidents, media,
media-requests, incident-categories, app-updates, backups, license, ddns.
Services: transcription, valhalla, trip-builder, license-store,
media-request-expiry, and `crypto.ts` (it existed only to encrypt the customer's
TomTom key at rest — no core route used it). `lib/license.ts` and every
`hasFeature()`/license call site, including the **user seat cap** (CE is
unlimited by design), the setup wizard's license step, and the transcription
error path in voice-recordings.

**Baseline migration** — 41 add-on object blocks removed (incidents,
incident_notes, incident_categories, media_assets, media_requests, app_releases
and their indexes/FKs) plus the `transcript_*` columns and index on
`voice_recordings`. Filenames `0001`/`0002` are **reserved** for the add-on
migration source so an existing commercial DB stays consistent in Phase 4; the
runner fails loudly on a collision. Next free core number: `0004`.

**Dispatch** — LiveAudioTraffic, RoadTraffic, Timeline, Incidents,
RequestMediaModal, DemoChatter. The TomTom traffic overlay was the real work: it
had reached into `MapPanel` (flow-tile layer, incident icon bitmaps, category
tables, rich popup builder — ~220 lines), `DispatchConsole` (config fetch,
idle/visibility pause loop, incident polling, filtered-incident memo, six props
threaded through both MapPanel instances), `SettingsContext`/`SettingsPanel`
(incident-type filters) and `AlertToasts`. MapPanel keeps a generic `mapFocus`
fly-to-with-popup any caller can use.

**Dashboard** — Incidents, Evidence, IncidentCategories, KeywordAlerts, License,
AppUpdates, Backups, TrackReplayPage (Track Replay lives in dispatch), their
hooks/components, the Traffic and Transcription settings cards, and the wizard's
license step (setup is now two steps).

**Android** — four OEM flavors and source sets, the whole `kiosk/` package
(Device-Owner policy, lock-task launcher, device-admin receiver, SOS
accessibility service) and its resources, `AppUpdater` + `ApkInstallReceiver`,
and the camera/audio/incident capture activities with the dispatcher
media-request flow. Dropped the CameraX dependency and the `CAMERA` +
`REQUEST_INSTALL_PACKAGES` permissions.

Chat photo attachments **stay** — they are core messaging, not the paid capture
suite — but now use `ACTION_IMAGE_CAPTURE` and the system photo picker. The
in-app CameraX path existed for OEM handsets with no camera app running under
lock-task, so it belongs to the commercial build.

**De-vendored everywhere** — Cloudflare DDNS, the kiosk `demo-login` endpoint and
`DEMO_MODE` sinks, `demoKiosk` client flag, demo seeds/simulators, 3.2 MB of demo
chatter audio, our VPS IPs and compose, `LICENSE_KEY`, and the hardcoded
`api.pushcomm.cloud` in **two** places that would have pointed a fresh CE install
at commercial infrastructure: the Android app's default server URL (now blank —
the operator enters their own) and the provisioning-QR host fallback in
`routes/devices.ts` (now derived from the request, no vendor fallback).

## 5. Bugs found by running it

1. **Stale-PTT-session cleanup never ran.** It passed a `Date` into a raw `sql`
   template, which postgres.js rejects with `ERR_INVALID_ARG_TYPE` — the exact
   gotcha CLAUDE.md §7 documents. The surrounding try/catch made it fail
   silently on every boot. Now bound as `.toISOString()`. **Inherited from V2**,
   so V2 gets the fix when it is re-plumbed onto CE in Phase 4.
2. **API crash-looped ~6× on a fresh volume.** `pg_isready` succeeds over the
   unix socket during initdb's temporary-server phase while TCP is still
   refused, so `depends_on: service_healthy` released the API too early. The
   healthcheck now forces TCP (`-h 127.0.0.1`) and has a `start_period`.
3. Minor: `/api/health` reported a stale hardcoded version; both SPAs referenced
   a `favicon.svg` that was never shipped.

## 6. Verification

- `pnpm build` — shared, api, dispatch, dashboard all build; API `tsc --noEmit`
  clean.
- `./gradlew assembleSmartphoneDebug` — **BUILD SUCCESSFUL**, APK produced, with
  no `google-services.json` present (Firebase is now applied only if the file
  exists, so a fresh clone builds; push wake-ups are simply inactive).
- `docker compose build` + `up` on a **wiped volume** — zero errors, migrations
  applied (`0000_baseline`, `0003_locations_dedupe`), both SPAs served with
  working deep-link fallback.
- Smoke test against the running stack: first-boot setup wizard → login by
  username → seeded roles/group-types → group + user creation (no seat cap) →
  direct message + conversations → GPS ingest → geofence + POI creation →
  **geofence entry alert fired** → SOS trigger + acknowledge → **PTT floor
  request granted and released** via the server-arbitrated endpoint.

**Not verified on this machine:** the API→LiveKit leg. LiveKit uses
`network_mode: host`, which on Docker Desktop for Windows binds the Linux VM's
namespace rather than the Windows host, so `host.docker.internal:7880` is
unreachable and `/api/health` reports `livekit: false`. This is a Docker Desktop
artifact, not a config fault — the same arrangement is what V2 runs in
production on Linux. Floor arbitration itself was proven working (grant →
release); only the egress capture reported "no audio track", which is expected
with no real participant publishing. **Re-verify end-to-end audio on a Linux
host before tagging v1.0.0.**

## 7. Next (Phase 2)

`NOTICE`, `SECURITY.md`, `CONTRIBUTING`, CLA bot, issue/PR templates, CI
(build + release), Dependabot, a CE-specific `README` quickstart, and the
dispatch multi-monitor pop-out placeholder bug.
