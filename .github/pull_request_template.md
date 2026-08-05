<!--
Thanks for contributing.

For anything beyond a small fix, please open an issue first so we can agree the
approach — it's genuinely unpleasant to decline a large PR someone spent a
weekend on, and that happens when nobody talked first.
-->

## What does this change?

<!-- Briefly: what and, more usefully, why. -->

Fixes #

## How did you test it?

<!--
"Builds clean" isn't testing. Say what you actually exercised, e.g.
"brought the stack up, triggered an SOS from a second account, saw the toast,
the map marker turned red, and acknowledging it cleared both."
-->

## Screenshots / clip

<!-- For any UI change. Before and after if you're changing existing behaviour. -->

## Checklist

- [ ] I have signed the [CLA](../blob/main/CLA.md) (the bot will prompt on first PR)
- [ ] `pnpm build` passes
- [ ] `pnpm -F @pushcomm/api exec tsc --noEmit` passes
- [ ] Any new source file carries the AGPL header
- [ ] Conventional commit messages (`feat(api): …`, `fix(dispatch): …`)

If your change touches the API or database:

- [ ] Every new query is scoped by `departmentId` from the JWT
- [ ] Schema changes are a **new** numbered migration in `apps/api/migrations/`
      (never edit a released one), with no `BEGIN`/`COMMIT`
- [ ] No add-on code is imported by the core — new integration points go through
      a registrar, the event bus, or a panel/route registry

## Anything reviewers should know?

<!-- Trade-offs, things you're unsure about, follow-ups you deliberately left out. -->
