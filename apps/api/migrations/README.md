# Core migrations

Numbered `*.sql` files applied automatically on API boot by `src/db/migrate.ts`.
Bookkeeping lives in the `schema_migrations` table, keyed by **filename**.

## Rules

- No `BEGIN`/`COMMIT` — postgres.js runs each file as one multi-statement simple
  query, which Postgres already wraps in an implicit transaction. Explicit
  transaction control is rejected (`UNSAFE_TRANSACTION`).
- Never edit a released file. Add a new numbered one.
- `0000_baseline.sql` is the core schema only. Databases that predate the runner
  "adopt" it (recorded as applied, not re-run).

## Reserved numbers

`0001` and `0002` are intentionally **not used here**. Those filenames belong to
the private add-on migration source (`0001_transcript_search_keywords.sql`,
`0002_trips_stops.sql`). Keeping them reserved means an existing commercial
database — where those files are already recorded as applied — stays consistent
when it is re-plumbed onto this core.

The migrate runner treats core and add-on directories as separate sources and
**refuses to start on a filename collision**, so a future core migration must not
reuse a number an add-on already owns. Next free core number: `0004`.

## Add-on migrations

Add-ons contribute a directory via their registrar's `migrationsDir`. Because the
core baseline omits add-on tables and columns, add-on migrations must be
idempotent against a commercial database that already has them — use
`CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`.
