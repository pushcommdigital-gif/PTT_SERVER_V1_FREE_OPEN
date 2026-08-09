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
import { config } from './config.js';
import { buildApp } from './app.js';

async function main() {
  // Community Edition boots the core with NO add-on registrars — that is the
  // entire free/paid boundary (CLAUDE.md §3). The commercial entrypoint passes
  // its private registrars here instead.
  const app = await buildApp();

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down...`);
      await app.close();
      process.exit(0);
    });
  }

  try {
    await app.listen({ port: config.api.port, host: config.api.host });
    app.log.info(`PushComm API running on ${config.api.host}:${config.api.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
