import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function logRequest(tag: string, req: NextRequest, body?: any) {
  if (process.env.DEBUG_BOT !== '1') return;
  try {
    const url = req.nextUrl.pathname + (req.nextUrl.search || '');
    const headers = Object.fromEntries(req.headers);
    const safeBody = body ? (typeof body === 'string' ? body.slice(0, 2000) : JSON.stringify(body).slice(0, 2000)) : undefined;
    // eslint-disable-next-line no-console
    console.log(`[WEBHOOK][CatchAll][${tag}] url=${url}`, { headers, body: safeBody });
  } catch {}
}

export async function POST(req: NextRequest) {
  const body = await req.text().catch(() => '');
  logRequest('POST', req, body);
  return NextResponse.json({ ok: true, note: 'catchall', method: 'POST' });
}

export async function GET(req: NextRequest) {
  logRequest('GET', req);
  return NextResponse.json({ ok: true, note: 'catchall', method: 'GET' });
}

export async function PUT(req: NextRequest) {
  const body = await req.text().catch(() => '');
  logRequest('PUT', req, body);
  return NextResponse.json({ ok: true, note: 'catchall', method: 'PUT' });
}

export async function PATCH(req: NextRequest) {
  const body = await req.text().catch(() => '');
  logRequest('PATCH', req, body);
  return NextResponse.json({ ok: true, note: 'catchall', method: 'PATCH' });
}

export async function DELETE(req: NextRequest) {
  const body = await req.text().catch(() => '');
  logRequest('DELETE', req, body);
  return NextResponse.json({ ok: true, note: 'catchall', method: 'DELETE' });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}



