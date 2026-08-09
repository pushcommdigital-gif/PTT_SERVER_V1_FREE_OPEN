#!/usr/bin/env node
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
// Adds the AGPL-3.0 header to source files that don't already carry one.
//
// Idempotent — re-running is a no-op. Run it after adding new source files:
//   node scripts/add-license-headers.mjs          # apply
//   node scripts/add-license-headers.mjs --check  # fail if any file lacks one (CI)
//
// Deliberately short. A 15-line GPL preamble on top of every file makes the
// codebase tiresome to read; the SPDX identifier is machine-readable, legally
// sufficient alongside LICENSE, and the convention most modern projects use.

import { readFile, writeFile } from 'node:fs/promises';
import { globSync } from 'node:fs';

const YEAR_OWNER = '2026 Corbani Mauro';

const HEADER_LINES = [
  'PushComm Community Edition',
  `Copyright (C) ${YEAR_OWNER}`,
  '',
  'This program is free software: you can redistribute it and/or modify it',
  'under the terms of the GNU Affero General Public License as published by',
  'the Free Software Foundation, either version 3 of the License, or (at your',
  'option) any later version. See the LICENSE file for the full text.',
  '',
  'SPDX-License-Identifier: AGPL-3.0-or-later',
];

const PATTERNS = [
  'apps/api/src/**/*.ts',
  'apps/dispatch/src/**/*.{ts,tsx}',
  'apps/dashboard/src/**/*.{ts,tsx}',
  'packages/shared/src/**/*.ts',
  'apps/android-ptt/app/src/**/*.kt',
  'scripts/**/*.mjs',
];

const IGNORE = ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.d.ts'];

const block = (open, line, close) =>
  [open, ...HEADER_LINES.map((l) => (l ? `${line} ${l}` : line.trimEnd())), close, ''].join('\n');

const C_STYLE = block('/*', ' *', ' */');

function headerFor(file) {
  if (file.endsWith('.kt')) return C_STYLE;
  if (file.endsWith('.mjs')) return C_STYLE;
  return C_STYLE; // ts, tsx
}

const check = process.argv.includes('--check');
const files = PATTERNS.flatMap((p) => globSync(p, { exclude: IGNORE }));

let changed = 0;
const missing = [];

for (const file of files) {
  const src = await readFile(file, 'utf8');
  if (src.includes('SPDX-License-Identifier')) continue;

  if (check) {
    missing.push(file);
    continue;
  }

  // Keep a shebang or a 'use client'-style directive on the first line.
  let prefix = '';
  let body = src;
  const first = src.split('\n', 1)[0];
  if (first.startsWith('#!') || /^['"]use \w+['"];?$/.test(first.trim())) {
    prefix = `${first}\n`;
    body = src.slice(first.length + 1);
  }

  await writeFile(file, `${prefix}${headerFor(file)}${body.replace(/^\n+/, '')}`, 'utf8');
  changed++;
}

if (check) {
  if (missing.length) {
    console.error(`Missing AGPL header in ${missing.length} file(s):`);
    for (const f of missing.slice(0, 25)) console.error(`  ${f}`);
    if (missing.length > 25) console.error(`  …and ${missing.length - 25} more`);
    console.error('\nRun: node scripts/add-license-headers.mjs');
    process.exit(1);
  }
  console.log(`All ${files.length} source files carry the AGPL header.`);
} else {
  console.log(`Added the AGPL header to ${changed} file(s); ${files.length - changed} already had one.`);
}
