/**
 * Swarm Client utilities (registry + routing)
 */

import { createHash } from 'crypto';
import { getAllModels, getServeStatus } from './ai-model-storage';
import { rescanLocalModelsFromDisk } from './ai-model-manager';
import type { ChatMessage } from '@/types/ai-model';

export function getPeerId(baseUrl: string): string {
  const norm = baseUrl.replace(/\/$/, '').toLowerCase();
  return createHash('sha1').update(norm).digest('hex').slice(0, 12);
}

export function getRegistryUrl(selfBaseUrl: string): string {
  const envUrl = process.env.SWARM_REGISTRY_URL;
  return (envUrl && envUrl.trim()) || selfBaseUrl.replace(/\/$/, '');
}

export function buildRegisterPayload(selfBaseUrl: string) {
  const peerId = getPeerId(selfBaseUrl);
  const all = getAllModels();
  const models = all.map(m => {
    const serve = getServeStatus(m.id);
    return {
      modelId: m.id,
      name: m.name || m.id,
      infoHash: m.infoHash,
      repoId: m.repoId,
      fileName: m.fileName,
      status: (serve?.isServing ? 'serving' : m.status) as any,
      capabilities: (serve?.isServing ? ['chat', 'next_token'] : []),
      seeders: m.seeders || 0,
      peers: m.peers || 0,
      uploadedBytes: m.uploadedBytes || 0,
      downloadedBytes: m.downloadedBytes || 0,
      serveHost: serve?.host,
      servePort: serve?.port,
    };
  });
  return {
    peerId,
    publicUrl: selfBaseUrl.replace(/\/$/, ''),
    version: '0.1.0',
    models,
  };
}

export async function registerSelf(selfBaseUrl: string): Promise<void> {
  const registry = getRegistryUrl(selfBaseUrl);
  try {
    // Best-effort: populate local store first if empty
    try { if (getAllModels().length === 0) { await rescanLocalModelsFromDisk(); } } catch {}
    const payload = buildRegisterPayload(selfBaseUrl);
    await fetch(`${registry}/api/swarm/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // short timeout
      signal: AbortSignal.timeout(3000),
    });
  } catch {}
}

export async function listAggregated(selfBaseUrl: string): Promise<any[]> {
  const registry = getRegistryUrl(selfBaseUrl);
  try {
    const res = await fetch(`${registry}/api/swarm/models`, { method: 'GET', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchWithRetries(url: string, init: RequestInit, attempts = 3, backoffMs = 800): Promise<Response> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} ${res.statusText}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, backoffMs * (i + 1)));
  }
  throw lastErr;
}

export async function remoteChat(peerBaseUrl: string, modelId: string, messages: ChatMessage[], maxTokens = 512, temperature = 0.7): Promise<{ content: string }>{
  const url = `${peerBaseUrl.replace(/\/$/, '')}/api/swarm/relay/chat`;
  const res = await fetchWithRetries(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId, messages, maxTokens, temperature }),
    // generous timeout per attempt
    signal: AbortSignal.timeout(45000),
  }, 3);
  return res.json();
}

export async function remoteNextToken(peerBaseUrl: string, modelId: string, prompt: string, temperature = 0.7): Promise<{ token: string }>{
  const url = `${peerBaseUrl.replace(/\/$/, '')}/api/swarm/relay/next-token`;
  const res = await fetchWithRetries(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId, prompt, temperature }),
    signal: AbortSignal.timeout(15000),
  }, 3);
  return res.json();
}
