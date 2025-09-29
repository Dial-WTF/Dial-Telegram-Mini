import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const uri = searchParams.get('uri') || '';
  const safeUri = uri.startsWith('ethereum:') ? uri : '';
  const html = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Open in wallet</title>
      <style>
        body{margin:0;background:#0b1220;color:#e6f0ff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial}
        .wrap{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px}
        .card{max-width:680px;width:100%;background:#0f172a;border:1px solid #243045;border-radius:16px;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,.35)}
        h1{margin:0 0 8px 0;font-size:22px}
        p{margin:6px 0 0 0;opacity:.9}
        a.btn{display:inline-block;margin-top:16px;padding:12px 16px;border-radius:10px;font-weight:700;text-decoration:none;color:#0b1220;background:#22c55e}
        code{background:#0b1220;border:1px solid #1f2a3a;border-radius:8px;padding:2px 6px}
      </style>
      ${safeUri ? `<meta http-equiv="refresh" content="0;url=${safeUri}">` : ''}
    </head>
    <body>
      <div class="wrap"><div class="card">
        <h1>Opening your wallet…</h1>
        <p>If nothing happens, tap the button below.</p>
        ${safeUri ? `<p><a class="btn" href="${safeUri}">Open in wallet</a></p>` : `<p>No payment link provided.</p>`}
        ${safeUri ? `<p style="opacity:.7">URI: <code>${safeUri.replace(/&/g,'&amp;')}</code></p>` : ''}
      </div></div>
      <script>
        (function(){
          var u = ${JSON.stringify(safeUri)};
          if(!u) return;
          try{ window.location.href = u; }catch(e){}
        })();
      </script>
    </body>
  </html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}


