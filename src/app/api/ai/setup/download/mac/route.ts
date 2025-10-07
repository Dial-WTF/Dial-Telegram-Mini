/**
 * API Route: Download macOS one-click installer (.command)
 * GET /api/ai/setup/download/mac
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const baseUrl = req.nextUrl.origin;
  const name = 'Install Dial AI.command';
  const content = `#!/bin/bash\nset -e\n\n# Change to Downloads so files are easy to find\ncd \"$HOME/Downloads\"\n\n# Run the hosted setup script in auto mode\n/usr/bin/env bash -c \"curl -fsSL ${baseUrl}/api/ai/setup/script | bash -s -- --auto\"\n\n\necho \"\n✅ Dial AI setup finished.\"\nread -n 1 -s -r -p \"Press any key to close...\"\n`;

  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
