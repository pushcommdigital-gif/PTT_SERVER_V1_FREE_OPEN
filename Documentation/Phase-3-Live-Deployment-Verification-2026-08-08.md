# Phase 3 — Live deployment verification (2026-08-08)

The clean-room requirement from CLAUDE.md §10 Phase 3 is **met**, and the last
technical unknown — whether voice actually works — is **closed**.

Deployed to `ptt-deploy` (Hetzner, 178.104.118.139), the disposable
customer-install rehearsal box, rebuilt to bare Ubuntu 24.04 first so the result
would mean something. Domain `mccreates.com`, deliberately not a pushcomm.cloud
hostname.

## 1. What was verified

| | |
|---|---|
| Fresh Ubuntu 24.04, nothing pre-installed | ✔ rebuilt before starting |
| README quickstart followed verbatim | ✔ |
| Images build on 2 vCPU / 3.7 GB, **no swap** | ✔ (I expected this to need swap; it did not) |
| First boot, both migrations applied, zero startup errors | ✔ |
| Real Let's Encrypt certificates, four subdomains | ✔ issued in ~20 s |
| `/api/health` → `livekit: true` on a public host | ✔ |
| Setup wizard, login, seeded roles, group + users | ✔ |
| Android app installed and signed in (Ulefone Armor 20WT, Android 12) | ✔ |
| **Live PTT audio, dispatcher ↔ phone, both directions** | ✔ confirmed by the owner |
| **Clips recorded, valid Opus, real signal** | ✔ after the fix below |
| **Clips played back through the UI** | ✔ owner listened to both |
| CDR rows, webhook path | ✔ |

That last row matters more than it looks: it exercises the whole chain end to
end — egress writes the file, the API remaps `/recordings/...` through
`RECORDINGS_PATH` and streams it back, and the player decodes it. A clip that
exists on disk but 404s or won't decode would have looked identical in the
database.

Clip evidence — decoded with ffprobe/ffmpeg on the box, not inferred:

```
broadcast-…/…ogg   opus 48 kHz stereo   7.34 s   mean −18.7 dB   max  0.0 dB
group-…/…ogg       opus 48 kHz stereo  12.48 s   mean −16.3 dB   max −0.5 dB
```

Durations match the database (7 s, 12 s). Digital silence would be about
−91 dB, so those clips contain actual speech.

## 2. The bug this caught — recording failed on every transmission

**Audio worked both ways, and every single recording failed.** Zero `.ogg`
files; every `voice_recordings` row `status=failed`,
`ended_reason=egress_failed`:

```
Local upload failed: mkdir /recordings/<room>/: permission denied
```

The egress captured the audio perfectly — 194 packets, pipeline played, clean
EOS — and failed only on the final write. **Live PTT sounds completely fine and
the failure is invisible** until someone goes looking for the clips. For a
product that advertises call recording and CDR on its front page, that is the
worst shape a bug can take.

The cause is not guessable from the message: the `livekit/egress` image runs as
**uid 1001, gid 0**, while Docker creates a missing bind-mount source as
**root:root 0755** — no group write bit, so it cannot create the per-room
subdirectory. The API container runs as root and reads clips back happily, which
is why nothing else looked wrong.

Fixed with a one-shot `recordings-init` service granting group write (not world
write — egress is already in gid 0), which egress waits on via
`service_completed_successfully`. Preferred over running egress as root, which
would undo the non-root user the image deliberately ships.

**Why CE had this and V2 does not:** V2's installer creates the recordings
directory. CE has no installer, so it inherited a dependency on an invisible
setup step that no longer existed. This is precisely the class of defect the
clean-room exercise was for, and it could not have been found any other way —
CI's stack job never transmits audio, so egress never writes a file there.

## 3. Other gaps found and fixed

1. **Docker isn't installed on a fresh Ubuntu.** The README asserted "you need
   Docker and Docker Compose" without saying how to get them, so a stranger
   stalls in the first minute. Now gives the command, links Docker's own guide,
   states the verified machine size, and warns that Docker Desktop on
   Windows/macOS cannot run voice at all.
2. **`RECORDINGS_HOST_PATH` was misleading.** Documented as "./data/recordings
   next to the compose file", which reads like the repository root. Compose
   resolves a relative bind against the compose file's directory, so clips
   landed in `docker/data/recordings` — verified by inspecting the running
   mount. Default is now absolute in both `.env.example` and the compose
   fallback.
3. **Dispatch login page said "Management Dashboard"** — the other app's name.
   Now "Web Dispatch".
4. **Closing a detached panel lost it entirely**, needing a full page reload.
   Regression from switching the detached window to a real URL: listeners belong
   to a *document*, and the navigation destroyed the `beforeunload` handler
   registered before it. Now polls `closed`.

## 4. Deliberate decisions confirmed in the field

- **The Ulefone's hardware PTT key is not pre-bound.** In V2 that handset had
  its own flavour with the key mapped. CE ships `smartphone` only and the OEM
  key presets were removed on purpose; the generic capture flow in Profile binds
  it. Confirmed working as intended, not a regression.
- **The Android app starts with an empty server URL.** Verified in the installed
  APK — zero occurrences of the old `api.pushcomm.cloud` default.

## 5. Still open

- ~~Microphone selection.~~ **DIAGNOSED AND FIXED** — see §7.
- `CLA_SIGNATURES_TOKEN` secret (owner action).
- Legal review of `CLA.md` before the first outside PR.
- The detached-panel fix has not been eyeballed on a second physical monitor.

## 6. Note on the test box

`ptt-deploy` currently runs **CE**, not V2, at `mccreates.com`. Reinstalling V2
there is the one-line installer from the walkthrough doc whenever it is wanted
back. Test credentials were generated for this run and are throwaway; the box is
publicly reachable, so treat anything on it as disposable.

## 7. The silent-microphone defect

The dispatcher had to open audio settings and choose a microphone manually.
Asked to be precise about it, the owner confirmed the important detail:
**before switching, there was no audio at all.**

That makes it a real defect rather than an unhelpful OS default. The operator
pressed PTT, the floor was granted, the button and status text behaved exactly
as normal — and nobody could hear a word.

The only existing indication was the input level bar staying flat, which the
code itself commented as meaning a silent mic. That helps only someone who
already knows to look at it and knows what flat means. It went unnoticed, and
the operator had to work out for themselves that the mic picker was the answer.

Silence is now stated rather than implied: the context peak-holds the level of
the actually-published track and, after 1.2 s of transmitting with no signal,
the PTT widget says plainly that nobody can hear them and points at the picker.
Peak-hold rather than instantaneous level, so a pause between words never trips
it; the warning clears as soon as real audio arrives.

**Deliberately not changed:** which device gets chosen. Defaulting to the OS
input is correct, and probing devices for signal means opening a stream against
each one — invasive, slow, and still a guess. The defect was the absence of
feedback, not the choice of default.

Worth noting how this was found: only a person pressing a button on a real
deployment could have surfaced it. No test asserts "a human heard speech."
