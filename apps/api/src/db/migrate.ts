/*
 * PushComm Community Edition
 * Copyright (C) 2026 Corbani Mauro
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. See the LICENSE file for the full text.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Minimal, dependency-light migration runner. Applies the ordered .sql files
// that haven't been applied yet, tracked in a `schema_migrations` table. Runs at
// API startup so a self-hosted customer never runs migrations manually.
//
// Design notes:
// - Uses the raw postgres.js client with the SIMPLE protocol (`.simple()`) so a
//   multi-statement file (the baseline is ~2k lines) runs in one shot.
// - Each file is applied together with its own bookkeeping insert, so applying a
//   file and recording it is atomic and crash-safe.
// - "Adopt": a database that predates this system (the schema already exists)
//   records the baseline as applied WITHOUT re-running it, then only newer files
//   run. This makes the runner safe to introduce on an existing production DB.
// - MULTI-SOURCE (EXTENSION POINT, CLAUDE.md §4): besides the core migrations
//   directory, each add-on registrar may contribute one. Sources are applied in
//   order — core first, then add-ons in registrar order — and within a source
//   files run in filename order. Bookkeeping is keyed by filename, so add-on
//   migration filenames must not collide with core ones (the runner refuses to
//   start if they do, rather than silently skipping one).

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { client } from './index.js';

// dist/db/migrate.js (prod) or src/db/migrate.ts (dev) → ../../migrations
const CORE_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);
const BASELINE = '0000_baseline.sql';

interface MigrateLogger {
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
}

/** An additional migration directory contributed by an add-on registrar. */
export interface MigrationSource {
  /** Registrar name, for logs and collision messages. */
  name: string;
  /** Absolute path to a directory of numbered `*.sql` files. */
  dir: string;
}

async function listSqlFiles(dir: string, log: MigrateLogger): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    log.warn(`[migrate] no migrations directory at ${dir} — skipping`);
    return [];
  }
}

export async function runMigrations(
  log: MigrateLogger,
  addonSources: MigrationSource[] = [],
): Promise<void> {
  if (process.env.AUTO_MIGRATE === 'false') {
    log.info('[migrate] AUTO_MIGRATE=false — skipping automatic migrations');
    return;
  }

  await client`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

  const appliedRows = await client<{ name: string }[]>`SELECT name FROM public.schema_migrations`;
  const applied = new Set(appliedRows.map((r) => r.name));

  const sources: MigrationSource[] = [
    { name: 'core', dir: CORE_MIGRATIONS_DIR },
    ...addonSources,
  ];

  // Resolve every source up front so a filename collision fails loudly at
  // startup instead of silently skipping one source's file.
  const plan: { source: MigrationSource; files: string[] }[] = [];
  const seen = new Map<string, string>(); // filename → source name
  for (const source of sources) {
    const files = await listSqlFiles(source.dir, log);
    for (const file of files) {
      const owner = seen.get(file);
      if (owner) {
        throw new Error(
          `[migrate] migration filename collision: "${file}" is provided by both ` +
            `"${owner}" and "${source.name}". Add-on migrations must use unique filenames.`,
        );
      }
      seen.set(file, source.name);
    }
    plan.push({ source, files });
  }

  if (plan.every((p) => p.files.length === 0)) {
    log.warn('[migrate] no migration files found — skipping');
    return;
  }

  // Adopt a pre-existing DB: schema already present but nothing tracked yet.
  if (applied.size === 0) {
    const reg = await client<{ reg: string | null }[]>`SELECT to_regclass('public.users') AS reg`;
    if (reg[0]?.reg != null) {
      await client`INSERT INTO public.schema_migrations (name) VALUES (${BASELINE}) ON CONFLICT DO NOTHING`;
      applied.add(BASELINE);
      log.info('[migrate] existing database detected — baseline adopted (not re-run)');
    }
  }

  let count = 0;
  for (const { source, files } of plan) {
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = await readFile(path.join(source.dir, file), 'utf8');
      log.info(`[migrate] applying ${file}${source.name === 'core' ? '' : ` (${source.name})`}`);
      // Apply the file + its bookkeeping insert as one multi-statement simple
      // query. Postgres runs a multi-statement simple query as a SINGLE implicit
      // transaction (atomic — a failure rolls the whole file back), so we must
      // NOT add explicit BEGIN/COMMIT here: postgres.js rejects manual
      // transaction control in a query (UNSAFE_TRANSACTION).
      const batch = `${body}\nINSERT INTO public.schema_migrations (name) VALUES ('${file}');`;
      await client.unsafe(batch).simple();
      count++;
    }
  }

  log.info(count > 0 ? `[migrate] applied ${count} migration(s)` : '[migrate] schema up to date');
}
