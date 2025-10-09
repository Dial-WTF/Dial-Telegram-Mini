/**
 * Swarm Registry (in-memory)
 *
 * This acts as a Petals-style rendezvous/aggregator. Multiple peers can
 * register themselves and the models they are serving. We aggregate and
 * expose a list for /ai-seeding and provide routing hints.
 *
 * NOTE: In-memory for now. Deploy behind a single public URL to make it
 * effectively "central rendezvous". We can replace with Redis or DHT later.
 */

import { createHash } from 'crypto';

export type SwarmPeerModel = {
  modelId: string;
  name: string;
  infoHash?: string;
  repoId?: string;
  fileName?: string;
  status: 'ready' | 'serving' | 'downloading' | 'error' | 'paused';
  seeders?: number;
  peers?: number;
  uploadedBytes?: number;
  downloadedBytes?: number;
  serveHost?: string;
  servePort?: number;
  capabilities?: string[]; // e.g., ['chat', 'next_token']
};

export type SwarmRegisterPayload = {
  peerId: string;
  publicUrl: string; // e.g. https://node-123.example.com
  version?: string;
  models: SwarmPeerModel[];
};

export type SwarmPeer = {
  peerId: string;
  publicUrl: string;
  version?: string;
  lastSeen: number;
  models: SwarmPeerModel[];
};

export type AggregatedModel = {
  code: string; // 7-char code derived from infoHash or modelId
  name: string;
  infoHash?: string;
  nodes: number; // peers serving/ready
  totalSeeders: number; // sum of seeders reported by peers
  peers: number; // sum of peers reported by peers
  examples: { peerId: string; publicUrl: string; status: SwarmPeerModel['status']; seeders?: number; modelId: string; capabilities?: string[] }[];
};

const peers = new Map<string, SwarmPeer>();
type ServeClaim = { peerId: string; at: number };
const serveClaims = new Map<string, ServeClaim>(); // key: model code

function codeFor(model: SwarmPeerModel): string {
  // Prefer infoHash (if torrents enabled on any node)
  if (model.infoHash) return String(model.infoHash).slice(0, 7).toLowerCase();
  // Else derive from canonical (repoId::fileName) when available to unify across peers
  if (model.repoId && model.fileName) {
    const hex = createHash('sha1').update(`${model.repoId}::${model.fileName}`).digest('hex');
    return hex.slice(0, 7).toLowerCase();
  }
  // Fallback to modelId
  const hex = createHash('sha1').update(model.modelId).digest('hex');
  return hex.slice(0, 7).toLowerCase();
}

function cleanup(ttlMs = 60000) {
  const now = Date.now();
  for (const [id, p] of peers.entries()) {
    if (now - p.lastSeen > ttlMs) peers.delete(id);
  }
}

function cleanupClaims(ttlMs = 60000) {
  const now = Date.now();
  for (const [code, c] of serveClaims.entries()) {
    if (now - c.at > ttlMs) serveClaims.delete(code);
  }
}

export function claimServe(code: string, peerId: string, ttlMs = 60000): { granted: boolean; owner?: string } {
  cleanupClaims(ttlMs);
  const cur = serveClaims.get(code);
  if (cur && Date.now() - cur.at < ttlMs && cur.peerId !== peerId) {
    return { granted: false, owner: cur.peerId };
  }
  serveClaims.set(code, { peerId, at: Date.now() });
  return { granted: true };
}

export function releaseServe(code: string, peerId: string) {
  const cur = serveClaims.get(code);
  if (cur && cur.peerId === peerId) {
    serveClaims.delete(code);
  }
}

export function registerPeer(payload: SwarmRegisterPayload) {
  const norm: SwarmPeer = {
    peerId: payload.peerId,
    publicUrl: payload.publicUrl.replace(/\/$/, ''),
    version: payload.version,
    lastSeen: Date.now(),
    models: payload.models || [],
  };
  peers.set(norm.peerId, norm);
  cleanup();
}

export function listPeers(): SwarmPeer[] {
  cleanup();
  return Array.from(peers.values());
}

export function listAggregatedModels(): AggregatedModel[] {
  cleanup();
  const agg = new Map<string, AggregatedModel>();
  for (const peer of peers.values()) {
    for (const m of peer.models) {
      const code = codeFor(m);
      const key = code; // group across nodes by code
      const existing = agg.get(key);
      const entry: AggregatedModel = existing || {
        code,
        name: m.name || m.modelId,
        infoHash: m.infoHash,
        nodes: 0,
        totalSeeders: 0,
        peers: 0,
        examples: [],
      };
      entry.nodes += 1;
      entry.totalSeeders += m.seeders || 0;
      entry.peers += m.peers || 0;
      entry.examples.push({
        peerId: peer.peerId,
        publicUrl: peer.publicUrl,
        status: m.status,
        seeders: m.seeders,
        modelId: m.modelId,
        capabilities: m.capabilities || [],
      });
      agg.set(key, entry);
    }
  }
  // Sort by nodes desc, then totalSeeders desc
  return Array.from(agg.values()).sort((a, b) => (b.nodes - a.nodes) || (b.totalSeeders - a.totalSeeders));
}

export function pickBestPeer(modelCode?: string): { peer: SwarmPeer; model: SwarmPeerModel } | null {
  cleanup();
  // If code provided, pick among peers serving that code; else pick overall top model
  let candidates: { peer: SwarmPeer; model: SwarmPeerModel }[] = [];
  for (const p of peers.values()) {
    for (const m of p.models) {
      if (!modelCode || codeFor(m) === modelCode.toLowerCase()) {
        candidates.push({ peer: p, model: m });
      }
    }
  }
  if (candidates.length === 0) return null;
  // Prefer serving, then higher seeders; tie-breaker: random
  candidates.sort((a, b) => {
    const sA = a.model.status === 'serving' ? 1 : 0;
    const sB = b.model.status === 'serving' ? 1 : 0;
    if (sA !== sB) return sB - sA;
    const seedA = a.model.seeders || 0;
    const seedB = b.model.seeders || 0;
    if (seedA !== seedB) return seedB - seedA;
    return Math.random() < 0.5 ? -1 : 1;
  });
  return candidates[0];
}
