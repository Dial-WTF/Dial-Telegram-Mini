/**
 * API Route: Serve AI Model
 * POST /api/ai/serve - Start serving a model
 * DELETE /api/ai/serve - Stop serving a model
 */

import { NextRequest, NextResponse } from 'next/server';
import { startModelServer, stopModelServer } from '@/lib/ai-inference';
import { getServeStatus, getModelById } from '@/lib/ai-model-storage';
import { getPeerId, getRegistryUrl } from '@/lib/swarm-client';
import { createHash } from 'crypto';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { modelId, port, host, contextSize, threads, gpuLayers } = body;

    if (!modelId) {
      return NextResponse.json(
        { ok: false, error: 'Model ID required' },
        { status: 400 }
      );
    }

    // Federation: claim the model code before starting to avoid duplicate servers
    try {
      const model = getModelById(modelId);
      if (model) {
        const base = (process.env.PUBLIC_BASE_URL || req.nextUrl.origin).replace(/\/$/, '');
        const peerId = getPeerId(base);
        const registry = getRegistryUrl(base);
        const code = model.infoHash
          ? String(model.infoHash).slice(0,7).toLowerCase()
          : createHash('sha1').update(model.repoId && model.fileName ? `${model.repoId}::${model.fileName}` : model.id).digest('hex').slice(0,7).toLowerCase();
        const res = await fetch(`${registry}/api/swarm/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, peerId, ttlMs: 60000 }),
          signal: AbortSignal.timeout(4000),
        }).then(r => r.json()).catch(() => ({ ok: false }));
        if (!res?.ok) throw new Error('claim failed');
        if (res.granted === false && res.owner && res.owner !== peerId) {
          return NextResponse.json({ ok: false, error: `Federation active: another peer is serving code ${code}. Use /ask to route or stop the other server first.` }, { status: 409 });
        }
      }
    } catch {}

    await startModelServer({
      modelId,
      port: port || 8080,
      host: host || '127.0.0.1',
      contextSize: contextSize || 2048,
      threads: threads || 4,
      gpuLayers: gpuLayers || 0,
    });

    const status = getServeStatus(modelId);

    return NextResponse.json({
      ok: true,
      result: status,
    });
  } catch (err: any) {
    console.error('[API] Serve error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to start server' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const modelId = searchParams.get('modelId');

    if (!modelId) {
      return NextResponse.json(
        { ok: false, error: 'Model ID required' },
        { status: 400 }
      );
    }

    await stopModelServer(modelId);

    return NextResponse.json({
      ok: true,
      result: { modelId, stopped: true },
    });
  } catch (err: any) {
    console.error('[API] Stop serve error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to stop server' },
      { status: 500 }
    );
  }
}
