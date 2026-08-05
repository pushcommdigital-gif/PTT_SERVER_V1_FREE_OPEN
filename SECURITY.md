# Security Policy

PushComm Community Edition is push-to-talk and safety software. People use it to
call for help. We take reports seriously and we would rather hear about a
problem early and awkwardly than late and politely.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report privately, either way:

- **GitHub Security Advisories** — the *Security* tab → *Report a vulnerability*.
  This is preferred: it gives us a private thread with you and a clean path to a
  CVE and a published advisory.
- **Email** — pushcommdigital@gmail.com, subject prefixed `[SECURITY]`.

Please include, as far as you can:

- what the issue is and roughly how bad you think it is,
- the version, commit SHA or image tag you tested,
- steps to reproduce, or a proof of concept,
- anything about your deployment that matters (reverse proxy, TLS termination,
  whether LiveKit is reachable from the internet).

If you would like credit in the advisory, say so and tell us the name or handle
to use. If you would rather stay anonymous, that is fine too.

## What to expect

| | |
|---|---|
| First response | within **3 business days** |
| Assessment and severity | within **10 business days** |
| Fix for high/critical | as fast as we can; you will get progress updates |
| Advisory published | when the fix ships, crediting you unless you decline |

Community Edition is maintained on a best-effort basis and most things here are
low-priority by design (see CONTRIBUTING.md). **Security reports are the
exception.** If you have not heard back within a week, please chase us — assume
the mail went astray rather than that it was ignored.

## Scope

**In scope** — anything in this repository: the API, the dispatch console, the
management dashboard, the Android app, the Docker deployment, and the default
configuration we ship. Findings we especially want:

- authentication or session flaws (JWT handling, refresh tokens, device
  activation and provisioning codes),
- **cross-department data leaks** — every query is supposed to be scoped by
  `departmentId` from the JWT; a path that isn't is a serious bug,
- privilege escalation across the role levels (dispatcher → admin → super-admin),
- unauthenticated access to voice recordings, locations, messages or SOS data,
- injection, SSRF, path traversal (particularly around recording file paths),
- anything that lets one field device act as another.

**Out of scope**

- The commercial PushComm add-ons — they are not in this repository. Report
  those to pushcommdigital@gmail.com directly.
- Vulnerabilities in third-party dependencies or container images with no
  PushComm-specific exploit path. Report those upstream; tell us if we should
  bump a pin.
- Findings that require an already-compromised server, physical access to an
  unlocked device, or a malicious administrator.
- Missing hardening headers, TLS configuration, or rate limits on a deployment
  *you* configured — unless our defaults or documentation led you there.
- Reports that are only automated-scanner output with no demonstrated impact.

## Deploying safely

Most real-world problems with self-hosted installs are configuration, not code:

- **Set strong, unique secrets.** `JWT_SECRET`, `DB_PASSWORD` and
  `LIVEKIT_API_SECRET` must each be a fresh random value
  (`openssl rand -hex 32`). Never reuse the examples.
- **Serve everything over TLS.** Browsers only grant microphone access on HTTPS,
  and tokens and voice traffic should never cross the network in the clear.
- **Do not expose Postgres or Valkey to the internet.** The compose file binds
  them to loopback; keep it that way.
- **Keep `.env`, `docker/livekit.yaml` and `docker/egress.yaml` off version
  control.** They hold secrets and are gitignored for that reason.
- **Rotate device provisioning codes** and disable lost devices promptly — a
  disabled device loses access within ~15 minutes regardless of its session
  length setting.

## Supported versions

Until `v1.0.0` is tagged, only `main` is supported. After that, security fixes
land on `main` and in the latest tagged release. Older tags are not backported.
