/**
 * Swarm heartbeat: periodically self-register with the registry
 */

import { registerSelf } from './swarm-client';

let started = false;
let timer: NodeJS.Timer | null = null;
let currentBase = '';

export function ensureSwarmHeartbeat(selfBaseUrl: string, intervalMs = 30000) {
  const base = (selfBaseUrl || '').replace(/\/$/, '');
  if (!base) return;
  if (started && base === currentBase) return;

  currentBase = base;
  started = true;
  // Fire immediately
  registerSelf(base).catch(() => {});

  if (timer) clearInterval(timer as any);
  timer = setInterval(() => {
    registerSelf(base).catch(() => {});
  }, intervalMs);
}
