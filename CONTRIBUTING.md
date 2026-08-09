# Contributing to PushComm Community Edition

Thanks for being here. This document is deliberately blunt about what this
project is and isn't, so you can decide whether to spend your time on it.

## What this project is

PushComm CE is the **open core** of a commercial product. It is a real,
complete, self-hostable PTT system — not a crippled demo. A team can run it
forever, unlimited users, no strings.

It is maintained by one person alongside paid work.

## Support expectations — please read before you file

**Community Edition is community-supported and best-effort.** There is no SLA
here. Paid support, priority fixes and managed hosting are how the project is
funded — see the README.

In practice:

| | |
|---|---|
| **Security reports** | Always answered. See [SECURITY.md](SECURITY.md). This is the one hard commitment. |
| **`main` is broken / won't build / won't deploy** | Treated seriously. |
| **Bug reports** | Read and labelled. Fixed when time allows, or when someone sends a PR. |
| **Feature requests** | Usually declined, or left open for a contributor. Not a promise. |
| **"How do I…" questions** | Please use [Discussions](../../discussions), not issues. Answered when possible. |
| **Large refactors / rewrites** | Almost always declined unless agreed in an issue first. |

None of this is meant coldly. A slow project that is honest about being slow is
more useful than one that quietly ignores you.

## Before you write code

**Open an issue first for anything non-trivial.** A small bug fix can go
straight to a pull request. Anything that adds a feature, changes an API
response, touches the database schema, or restructures a file is worth agreeing
on first — it is genuinely unpleasant to decline a large PR someone spent a
weekend on, and it happens when nobody talked first.

Good first contributions: issues tagged
[`good first issue`](../../labels/good%20first%20issue).

## The Contributor Licence Agreement

**You must sign the [CLA](CLA.md) before a pull request can be merged.**

The short version: you keep the copyright in your work, but you grant the
project owner the right to ship it in commercial closed-source products as well
as here under AGPL-3.0. This is what makes the open-core model legally workable.

It is not hidden and it is not a formality — please actually read
[CLA.md](CLA.md), and don't sign if you disagree with it. **Bug reports and
issues need no CLA at all**, and a good report is a real contribution.

Signing is one comment on your first PR; the bot walks you through it and never
asks again.

## Architectural rules

These are not style preferences. A PR that breaks one will be asked to change.

1. **The core never imports add-on code.** This repository must never reference
   the commercial add-ons. If a change seems to need one, it needs an
   *extension point* instead. The existing seams, each documented at the top of
   its own file:
   - `apps/api/src/lib/registrar.ts` — `buildApp({ registrars })`, for routes,
     workers and add-on migration directories
   - `apps/api/src/lib/events.ts` — an in-process event bus the core emits to
     and forgets
   - `apps/dispatch/src/addons/registry.ts` — dispatch panel registry
   - `apps/dashboard/src/addons/registry.ts` — dashboard route/nav registry
   - `WsEventMap` in `packages/shared` — the WebSocket event union, widened by
     declaration merging

   CI enforces this: the **Open-core boundary** job fails the build if add-on
   imports, licence gating or vendor hostnames appear.
2. **Every database query is scoped by `departmentId`** taken from the JWT. An
   unscoped query is a cross-tenant data leak, and this software carries
   people's locations and emergency alerts.
3. **No secrets, ever.** No keys, tokens, real hostnames, IPs or `.env` files.
   Add a `.example` template instead.
4. **Don't remove map attribution.** It is a licence condition of the map data,
   not decoration. See [NOTICE](NOTICE) §5.
5. **New source files carry the AGPL header** (see any existing file).

## Development setup

Requirements: Node 22+, pnpm 9+, Docker, and — for the app — JDK 17+ and the
Android SDK.

```bash
pnpm install
cp .env.example .env          # then set the three secrets
pnpm build                    # shared → api → dispatch → dashboard
pnpm dev                      # all web apps in watch mode
```

Running the full stack, which you need for anything touching voice:

```bash
cp docker/livekit.yaml.example docker/livekit.yaml
cp docker/egress.yaml.example  docker/egress.yaml
# put the SAME LIVEKIT_API_SECRET in .env and both files
docker compose --env-file .env -f docker/docker-compose.yml up -d --build
```

Android:

```bash
cd apps/android-ptt
./gradlew assembleSmartphoneDebug     # builds without google-services.json
```

Before you push:

```bash
pnpm build                                  # must be clean
pnpm -F @pushcomm/api exec tsc --noEmit     # must be clean
```

CI runs the same things. Keep `main` green.

## Conventions

- **Commits**: [Conventional Commits](https://www.conventionalcommits.org) —
  `feat(api): …`, `fix(dispatch): …`, `docs: …`, `chore: …`.
- **Commit bodies**: explain *why*, not what. The diff already says what.
- **ESM throughout** (`"type": "module"`); no `.js` extension in schema imports.
- **API responses**: `{ success, data, pagination? }`.
- **Migrations**: numbered SQL in `apps/api/migrations/`, applied on boot. No
  `BEGIN`/`COMMIT` inside them. Never edit a released migration — add a new one.
  Read `apps/api/migrations/README.md` first; some numbers are reserved.

### Gotchas that will bite you

Each of these has cost someone real time:

- **Raw `sql` template parameters must be primitives, not objects.** Passing a
  `Date` into a drizzle `sql` template makes postgres.js throw
  `ERR_INVALID_ARG_TYPE`. Use `.toISOString()`. This one shipped as a silent
  no-op for months because the failure was inside a `try/catch`.
- **`db.execute()` returns a RowList**, not an object with `.rows`. Spread it:
  `[...result]`.
- **Never send `Content-Type: application/json` with an empty body** — Fastify
  rejects it with `FST_ERR_CTP_EMPTY_JSON_BODY`.
- **`getUserMedia` needs HTTPS** (or `localhost`). A dispatch console served
  over plain HTTP cannot transmit.
- **React `const` is not hoisted** — define values before the `useEffect` that
  lists them as dependencies.
- **Migrations must not contain `BEGIN`/`COMMIT`.** postgres.js runs each file
  as one multi-statement simple query, which Postgres already wraps in an
  implicit transaction; explicit control is rejected.
- **Rebuild `@pushcomm/shared` after changing it** (`pnpm -F @pushcomm/shared
  build`) or the apps compile against stale types.

## Pull requests

- One logical change per PR. Split unrelated fixes.
- Say how you tested it. "Builds clean" is not testing; "brought the stack up,
  triggered an SOS from a second account, saw the toast and the map marker" is.
- Screenshots or a short clip for UI changes.
- Draft PRs are welcome for early feedback.

If your PR goes quiet, a nudge after a week is welcome and not rude.

## Code of conduct

Be decent. Assume good faith. No harassment, no personal attacks.

Behaviour that makes this project unpleasant to be around gets you blocked, with
no obligation on anyone to litigate it in public. Report concerns privately to
pushcommdigital@gmail.com.

## Licence

By contributing you agree that your contributions are licensed under
AGPL-3.0 for this repository, and that you have granted the additional rights
described in [CLA.md](CLA.md).
