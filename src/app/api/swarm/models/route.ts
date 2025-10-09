import { NextRequest, NextResponse } from 'next/server';
import { listAggregatedModels } from '@/lib/swarm-registry';
import { getAllModels, getServeStatus } from '@/lib/ai-model-storage';
import { rescanLocalModelsFromDisk } from '@/lib/ai-model-manager';
import { createHash } from 'crypto';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const aggregated = listAggregatedModels();

    // If nothing is registered yet, try to populate locals by rescanning disk
    if (!aggregated || aggregated.length === 0) {
      try { await rescanLocalModelsFromDisk(); } catch {}
    }

    // Merge in local models as aggregated entries if not present
    const base = (process.env.PUBLIC_BASE_URL || req.nextUrl.origin).replace(/\/$/, '');
    const existingCodes = new Set<string>(aggregated.map((a: any) => String(a.code).toLowerCase()));
    const locals = getAllModels().filter(m => m.status === 'ready' || m.status === 'serving');
    for (const m of locals) {
      const code = (m.infoHash
        ? String(m.infoHash).slice(0,7).toLowerCase()
        : createHash('sha1').update(m.repoId && m.fileName ? `${m.repoId}::${m.fileName}` : m.id).digest('hex').slice(0,7).toLowerCase());
      if (existingCodes.has(code)) continue;
      const serve = getServeStatus(m.id);
      aggregated.push({
        code,
        name: m.name || m.id,
        infoHash: m.infoHash,
        nodes: 1,
        totalSeeders: m.seeders || 0,
        peers: m.peers || 0,
        examples: [{ peerId: 'self', publicUrl: base, status: (serve?.isServing ? 'serving' : m.status), seeders: m.seeders || 0, modelId: m.id, capabilities: (serve?.isServing ? ['chat','next_token'] : []) }],
      });
    }

    return NextResponse.json(aggregated);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 });
  }
}
