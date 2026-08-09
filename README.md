<h1 align="center">PushComm Community Edition</h1>

<p align="center">
  A free, self-hosted push-to-talk platform that turns any Android phone or
  rugged handset into a business PTT device over cellular or Wi-Fi —
  <strong>no per-seat fees, no user caps, no strings.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licence: AGPL-3.0" src="https://img.shields.io/badge/licence-AGPL--3.0-blue.svg"></a>
  <img alt="Self-hosted" src="https://img.shields.io/badge/deploy-self--hosted-informational.svg">
  <img alt="Node 22+" src="https://img.shields.io/badge/node-22%2B-green.svg">
</p>

Run a real dispatch operation from day one: live push-to-talk, a real-time map of
your team, a browser-based dispatch console, messaging, and safety features — all
on your own server, with your data staying on it.

This is not a trial or a crippled demo. It is the production core of a
commercial product, and a small team can run it forever without paying anyone.

---

## Features

- **Push-to-talk voice** — group channels, all-call, private 1:1, half-duplex
  with a server-arbitrated floor (LiveKit SFU)
- **Live map** — real-time GPS positions of every unit, follow-the-talker
- **Dispatch console** — floating panels you can pop out to a second monitor
- **Messaging** — direct and group conversations, with photo and location
  attachments
- **SOS / Lone Worker** — one-tap emergency, dispatcher acknowledge/resolve, and
  check-in safety timers
- **Geofences, zones & POIs** — with entry/exit alerts
- **Call recording & CDR** — every transmission captured as a clip, linked to a
  call record, playable and downloadable
- **Users, groups, roles, devices** — IMEI activation, QR provisioning, remote
  disable
- **Android app** for the field, **web dispatch console** and **admin dashboard**
  for the office
- **Self-hosted** with Docker Compose

## Quickstart

You need a Linux machine with a public IP (or a LAN address for a private
trial), and about ten minutes. 2 vCPU and 4 GB RAM is enough — that is what
this was last verified on.

**Install Docker first.** A fresh Ubuntu or Debian has no Docker, and every
step below depends on it:

```bash
curl -fsSL https://get.docker.com | sh
```

That is Docker's own installation script and gives you both the engine and the
Compose plugin. If you would rather not pipe a script to a shell, follow
[Docker's install guide](https://docs.docker.com/engine/install/) instead — any
recent Docker with `docker compose` works.

> **Docker Desktop on Windows or macOS will not work for voice.** LiveKit needs
> host networking, which Docker Desktop binds to its own Linux VM rather than
> your machine, so the API can never reach it. Everything else runs, but PTT
> won't. Deploy on Linux.

Then get the code:

```bash
git clone https://github.com/pushcommdigital-gif/PTT_SERVER_V1_FREE_OPEN.git
cd PTT_SERVER_V1_FREE_OPEN
```

**1 — Create your environment file**

```bash
cp .env.example .env
```

Edit `.env` and set the three secrets. Generate each one separately:

```bash
openssl rand -hex 32
```

Then set `LIVEKIT_PUBLIC_URL` (the address your phones and browsers will dial)
and `CORS_ORIGIN` (your dispatch and dashboard URLs).

**2 — Create the LiveKit configs**

```bash
cp docker/livekit.yaml.example docker/livekit.yaml
cp docker/egress.yaml.example  docker/egress.yaml
```

> **The same `LIVEKIT_API_SECRET` must appear in all three places** — `.env`,
> `keys.pushcomm` in `livekit.yaml`, and `api_secret` in `egress.yaml`. A
> mismatch is the single most common reason voice doesn't work.

**3 — Bring it up**

```bash
docker compose --env-file .env -f docker/docker-compose.yml up -d --build
```

The API applies its own database migrations on first boot. Nothing to run by
hand.

**4 — Create your organisation**

Open the dashboard and complete the first-boot wizard — it creates your
organisation and the first super-admin account. That is the whole setup.

**5 — Add the field app**

Build the Android app and install it on a phone:

```bash
cd apps/android-ptt
./gradlew assembleSmartphoneDebug
```

In the app, enter your API URL and sign in — or provision the device by scanning
the QR code from the dashboard's Devices page.

### TLS

Browsers only grant microphone access over **HTTPS** (or on `localhost`), so a
real deployment needs TLS. Caddy is included and will obtain and renew
Let's Encrypt certificates for you:

```bash
cp docker/Caddyfile.example docker/Caddyfile   # then set your domain + email
docker compose --env-file .env -f docker/docker-compose.yml --profile tls up -d
```

Point `dispatch.`, `manage.`, `api.` and `live.` subdomains at the host first.

### If something doesn't come up

Check `docker compose --env-file .env -f docker/docker-compose.yml ps` first.

**`livekit` restart-looping with `dial tcp 127.0.0.1:6379: connection refused`** —
the SFU runs on the host network and reaches Valkey through the port the stack
publishes on loopback, so it fails if that publish didn't happen. Almost always
this means **port 6379 or 3000 was already in use** (an existing Redis, or a
second copy of this stack). Compose reports the clash once, on the container
that lost the race, and everything downstream then fails with a less obvious
error. Free the port — or change the published port in
`docker/docker-compose.yml` and the matching `redis.address` in
`docker/livekit.yaml` — then bring the stack up again.

**Voice doesn't work and `/api/health` shows `"livekit": false`** — the API
can't reach the SFU. Check `LIVEKIT_PUBLIC_URL` is an address your clients can
actually resolve, and that the same `LIVEKIT_API_SECRET` really is in all three
places. Note that this is also expected on **Docker Desktop for Windows/macOS**,
where `network_mode: host` binds the Linux VM rather than your machine — PushComm
is meant to be deployed on a Linux host, and voice will not work on Docker
Desktop.

**The dispatch console loads but the microphone won't work** — browsers only
grant microphone access over HTTPS or on `localhost`. Use the `tls` profile.

## Architecture

```
apps/
  api          Fastify — REST + WebSocket, JWT auth, floor control      @pushcomm/api
  dispatch     React/Vite dispatch console (floating panels)            @pushcomm/dispatch
  dashboard    React/Vite management dashboard (admin)                  @pushcomm/dashboard
  android-ptt  Kotlin/Compose field app (smartphone flavour)
packages/
  shared       Shared TypeScript types + constants                      @pushcomm/shared
docker/        Dockerfiles, compose stack, config templates
```

PostgreSQL 16 + PostGIS for storage, Valkey for pub/sub, LiveKit as the SFU with
per-clip egress recording. Real-time updates fan out over WebSocket, scoped per
department.

## Open core — what's free and what isn't

Everything in this repository is free software under AGPL-3.0 and always will
be. The work is funded by selling add-ons that build on it.

| In this repository (free, forever) | Commercial add-ons (separate) |
|---|---|
| PTT voice — groups, all-call, private 1:1, floor control | Voice transcription + keyword alerts |
| Live map, GPS tracking, track replay | Telematics: snap-to-road, trips, timeline, driver scorecards |
| Messaging, SOS / Lone Worker, zones & geofences | Live traffic overlay |
| Call recording + CDR | Visual verification (incidents + media capture) |
| Users, groups, roles, devices | OTA fleet updates, scheduled DB backups |
| Dispatch console + admin dashboard | OEM kiosk builds for rugged handsets |
| Android app, Docker deployment | Priority support, SLA, managed hosting |

No feature in this repository is gated, timed or licence-checked. There is no
licence key, and there is no seat cap — the paid features simply aren't here.

## Support

Community Edition is **community-supported, best-effort**. Paid support, an SLA
and managed hosting are available separately — that's what funds development.

- **Questions and help** — [Discussions](../../discussions)
- **Bugs** — [Issues](../../issues)
- **Security problems** — privately, please: see [SECURITY.md](SECURITY.md).
  Security reports are always answered.

See [CONTRIBUTING.md](CONTRIBUTING.md) for what to expect before you file.

## Contributing

Contributions are welcome. Please read
[CONTRIBUTING.md](CONTRIBUTING.md) first, and note that a
[Contributor Licence Agreement](CLA.md) is required before a pull request can be
merged — you keep your copyright, but the project owner needs the right to ship
your contribution in the commercial product too. Bug reports need no agreement
at all.

## Licence

[GNU Affero General Public License v3.0](LICENSE).

In short: you may run, study, modify and share this software freely. If you
modify it and let others use it **over a network**, you must offer them your
modified source too. Third-party components and their licences are listed in
[NOTICE](NOTICE).

Map data © OpenStreetMap contributors, licensed under the
[ODbL](https://www.openstreetmap.org/copyright).

"PushComm" and the PushComm logo are trademarks of Corbani Mauro. The AGPL
grants you rights to the code, not to the name — please rename your fork if you
redistribute it.
