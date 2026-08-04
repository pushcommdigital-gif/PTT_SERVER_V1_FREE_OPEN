import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { devices } from '../db/schema/devices.js';
import { redisSub } from '../redis.js';
import { broadcast } from './broadcast.js';

// departmentId -> live socket set
const connections = new Map<string, Set<WebSocket>>();
// departmentId -> (userId -> connection count)
const onlineUsersByDept = new Map<string, Map<string, number>>();
// tracks whether each socket responded to the last ping (for dead-socket detection)
const alive = new WeakMap<WebSocket, boolean>();
// userId tracking per socket so the heartbeat can decrement the presence
// counter and broadcast user:presence:offline when it terminates a dead
// socket. Without this, a device going offline abruptly (cell radio dies,
// device powered off) leaves the user permanently marked online — the
// heartbeat removes the socket from `connections` but the user counter in
// `onlineUsersByDept` is never decremented. Witnessed 2026-05-24 with
// Unit4 staying on the dispatch map ~11h after the F400 was powered off.
const socketUserIds = new WeakMap<WebSocket, string>();

function addSocket(departmentId: string, socket: WebSocket) {
  let set = connections.get(departmentId);
  if (!set) {
    set = new Set();
    connections.set(departmentId, set);
  }
  set.add(socket);
}

function incrementOnlineUser(departmentId: string, userId: string) {
  let byUser = onlineUsersByDept.get(departmentId);
  if (!byUser) {
    byUser = new Map();
    onlineUsersByDept.set(departmentId, byUser);
  }
  byUser.set(userId, (byUser.get(userId) ?? 0) + 1);
}

function decrementOnlineUser(departmentId: string, userId: string) {
  const byUser = onlineUsersByDept.get(departmentId);
  if (!byUser) return;
  const current = byUser.get(userId) ?? 0;
  if (current <= 1) {
    byUser.delete(userId);
  } else {
    byUser.set(userId, current - 1);
  }
  if (byUser.size === 0) {
    onlineUsersByDept.delete(departmentId);
  }
}

function removeSocket(departmentId: string, socket: WebSocket, userId?: string) {
  const set = connections.get(departmentId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) connections.delete(departmentId);
  if (userId) decrementOnlineUser(departmentId, userId);
}

export function getOnlineUserIds(departmentId: string): string[] {
  const byUser = onlineUsersByDept.get(departmentId);
  if (!byUser) return [];
  return Array.from(byUser.keys());
}

async function resolvePresenceUserId(payload: { departmentId: string; sub: string; type?: string }) {
  if (payload.type !== 'device') {
    return payload.sub;
  }

  const [device] = await db
    .select({ assignedUserId: devices.assignedUserId })
    .from(devices)
    .where(and(eq(devices.id, payload.sub), eq(devices.departmentId, payload.departmentId), eq(devices.isDeleted, false)))
    .limit(1);

  return device?.assignedUserId ?? null;
}

/**
 * Register the /ws WebSocket route and wire up Redis subscription fan-out.
 */
export async function registerWsRoute(app: FastifyInstance) {
  await redisSub.psubscribe('ws:dept:*');

  redisSub.on('pmessage', (_pattern: string, channel: string, message: string) => {
    const departmentId = channel.slice('ws:dept:'.length);
    const sockets = connections.get(departmentId);
    if (!sockets || sockets.size === 0) return;

    for (const ws of sockets) {
      if (ws.readyState === 1) {
        ws.send(message);
      }
    }
  });

  const heartbeat = setInterval(() => {
    for (const [deptId, sockets] of connections) {
      for (const ws of sockets) {
        if (ws.readyState !== 1) {
          reapDeadSocket(deptId, ws);
          continue;
        }
        if (alive.get(ws) === false) {
          // No pong received since last ping — connection is dead (abrupt
          // network loss, device powered off, etc.). terminate() forces a
          // TCP RST without waiting for a graceful close, and may not fire
          // the 'close' handler reliably across all transports — so the
          // counter decrement + offline broadcast happen HERE, not via the
          // close listener.
          ws.terminate();
          reapDeadSocket(deptId, ws);
          continue;
        }
        alive.set(ws, false); // expect a pong before the next heartbeat
        ws.ping();
      }
    }
  }, 15_000);

  /**
   * Heartbeat-side teardown for a socket that has died without firing its
   * 'close' or 'error' listener (TCP RST, device power-off, network down).
   * Looks up the userId we stored on connect, decrements presence, and
   * broadcasts offline so dispatch updates immediately instead of seeing
   * the user lingering on the map forever.
   */
  function reapDeadSocket(departmentId: string, ws: WebSocket) {
    const userId = socketUserIds.get(ws);
    socketUserIds.delete(ws);
    removeSocket(departmentId, ws, userId ?? undefined);
    if (userId) {
      broadcast(departmentId, {
        event: 'user:presence',
        userId,
        online: false,
        timestamp: new Date().toISOString(),
      });
      app.log.info(`WS reaped (dead socket): user=${userId} dept=${departmentId}`);
    }
  }

  app.addHook('onClose', () => {
    clearInterval(heartbeat);
  });

  app.get('/api/ws', { websocket: true }, async (socket: WebSocket, request) => {
    const token = (request.query as Record<string, string>).token;
    if (!token) {
      socket.close(4401, 'Missing token');
      return;
    }

    let payload: { departmentId: string; sub: string; type?: string };
    try {
      const decoded = app.jwt.verify<{ departmentId: string; sub: string; type?: string }>(token);
      payload = decoded;
    } catch {
      socket.close(4401, 'Invalid token');
      return;
    }

    const { departmentId } = payload;
    const userId = await resolvePresenceUserId(payload);

    if (!userId) {
      socket.close(4403, 'Device is not assigned to a user');
      return;
    }

    addSocket(departmentId, socket);
    incrementOnlineUser(departmentId, userId);
    alive.set(socket, true); // treat as alive on connect
    socketUserIds.set(socket, userId); // remembered so the heartbeat can clean up
    broadcast(departmentId, {
      event: 'user:presence',
      userId,
      online: true,
      timestamp: new Date().toISOString(),
    });
    app.log.info(`WS connected: user=${userId} dept=${departmentId}`);

    socket.on('pong', () => {
      alive.set(socket, true);
    });

    socket.on('close', () => {
      // Guard against double-decrement: if the heartbeat already reaped
      // this socket, the userId entry will have been deleted from
      // socketUserIds. Only do the bookkeeping if it's still ours.
      if (!socketUserIds.has(socket)) return;
      socketUserIds.delete(socket);
      removeSocket(departmentId, socket, userId);
      broadcast(departmentId, {
        event: 'user:presence',
        userId,
        online: false,
        timestamp: new Date().toISOString(),
      });
      app.log.info(`WS disconnected: user=${userId} dept=${departmentId}`);
    });

    socket.on('error', () => {
      if (!socketUserIds.has(socket)) return;
      socketUserIds.delete(socket);
      removeSocket(departmentId, socket, userId);
      broadcast(departmentId, {
        event: 'user:presence',
        userId,
        online: false,
        timestamp: new Date().toISOString(),
      });
    });
  });
}
