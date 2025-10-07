/**
 * API Route: Serve AI Model
 * POST /api/ai/serve - Start serving a model
 * DELETE /api/ai/serve - Stop serving a model
 */

import { NextRequest, NextResponse } from 'next/server';
import { startModelServer, stopModelServer } from '@/lib/ai-inference';
import { getServeStatus } from '@/lib/ai-model-storage';

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
