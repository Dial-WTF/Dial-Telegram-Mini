/**
 * API Route: Download Linux one-click GPU installer (.sh)
 * GET /api/ai/setup/download/linux-gpu
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const baseUrl = process.env.PUBLIC_BASE_URL || req.nextUrl.origin;
  const name = 'install-dial-ai-gpu.sh';
  const content = `#!/bin/bash\nset -e\n\ncd \"$HOME/Downloads\"\n\n/usr/bin/env bash -c \"curl -fsSL ${baseUrl}/api/ai/setup/script | bash -s -- --auto --gpu\"\n\necho \"\n✅ Dial AI GPU setup finished.\"\nread -p \"Press Enter to close...\"\n`;

  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
