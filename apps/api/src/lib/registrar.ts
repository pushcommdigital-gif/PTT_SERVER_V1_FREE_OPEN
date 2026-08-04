// The registrar seam — the primary API EXTENSION POINT (see CLAUDE.md §4).
//
// `buildApp({ registrars })` takes a list of registrars. Community Edition
// passes ZERO of them: the core registers only core routes and core workers,
// and nothing in this repository implements this interface. The commercial
// build supplies registrars from its private `addons/` workspace, which is how
// paid features attach without the core ever importing them.
//
// Iron rule (CLAUDE.md §3): the core never imports add-on code. If a change
// appears to need one, it needs an extension point instead.

import type { FastifyInstance } from 'fastify';

/** Logger passed to workers so add-on background loops log through Fastify. */
export interface WorkerLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

/** Dependencies handed to a registrar's background workers. */
export interface WorkerDeps {
  log: WorkerLogger;
}

export interface Registrar {
  /** Stable identifier, used only in startup logs. */
  name: string;

  /** Register Fastify plugins/routes. Runs after all core routes. */
  registerRoutes?(app: FastifyInstance): Promise<void> | void;

  /** Start background loops/workers. Runs after routes are registered. */
  startWorkers?(deps: WorkerDeps): void;

  /** Stop background loops. Runs from the Fastify `onClose` hook. */
  stopWorkers?(): void;

  /**
   * Absolute path to a directory of numbered `*.sql` migrations owned by this
   * add-on. The migrate runner treats it as an additional migration source
   * alongside the core's own directory (see db/migrate.ts). Add-on migration
   * filenames must not collide with core ones.
   */
  migrationsDir?: string;
}

export interface BuildAppOptions {
  /**
   * Add-on registrars. Empty/omitted in Community Edition — that is the whole
   * free/paid boundary: CE is this code with nothing plugged in.
   */
  registrars?: Registrar[];
}
