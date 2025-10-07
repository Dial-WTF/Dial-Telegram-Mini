/**
 * API Route: Chat with AI Model
 * POST /api/ai/chat
 */

import { NextRequest, NextResponse } from 'next/server';
import { chat } from '@/lib/ai-inference';
import type { ChatRequest } from '@/types/ai-model';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { modelId, messages, maxTokens, temperature, stream } = body;

    if (!modelId || !messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { ok: false, error: 'Model ID and messages required' },
        { status: 400 }
      );
    }

    const request: ChatRequest = {
      modelId,
      messages,
      maxTokens: maxTokens || 512,
      temperature: temperature || 0.7,
      stream: stream || false,
    };

    const response = await chat(request);

    return NextResponse.json({
      ok: true,
      result: response,
    });
  } catch (err: any) {
    console.error('[API] Chat error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Chat failed' },
      { status: 500 }
    );
  }
}
