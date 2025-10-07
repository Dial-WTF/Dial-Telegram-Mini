/**
 * API Route: Download AI Model
 * POST /api/ai/download
 */

import { NextRequest, NextResponse } from 'next/server';
import { addModelFromHuggingFace, addModelFromMagnet } from '@/lib/ai-model-manager';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, magnetUri, createTorrent = true } = body;

    if (!url && !magnetUri) {
      return NextResponse.json(
        { ok: false, error: 'URL or magnet URI required' },
        { status: 400 }
      );
    }

    let model;

    if (magnetUri) {
      // Download from magnet URI
      model = await addModelFromMagnet(magnetUri, body.metadata, (modelId, progress, speed, peers) => {
        console.log(`[API] Download progress: ${modelId} ${progress}% ${speed}B/s ${peers} peers`);
      });
    } else {
      // Download from HuggingFace
      model = await addModelFromHuggingFace(
        {
          huggingFaceUrl: url,
          fileName: body.fileName,
          createTorrent,
        },
        (modelId, progress, speed) => {
          console.log(`[API] Download progress: ${modelId} ${progress}%`);
        }
      );
    }

    return NextResponse.json({
      ok: true,
      result: model,
    });
  } catch (err: any) {
    console.error('[API] Download error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Download failed' },
      { status: 500 }
    );
  }
}
