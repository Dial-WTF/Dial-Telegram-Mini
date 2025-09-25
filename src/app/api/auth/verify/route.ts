// app/api/auth/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { validate } from '@telegram-apps/init-data-node';
export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  const { initData } = await req.json();
  try {
    validate(initData, process.env.BOT_TOKEN!);
    return NextResponse.json({ ok:true });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:400 });
  }
}
