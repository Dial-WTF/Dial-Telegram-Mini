import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import sharp from "sharp";
import path from "path";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const data = searchParams.get("data");
    if (!data) {
      return NextResponse.json({ error: "Missing ?data=" }, { status: 400 });
    }
    const noCache = searchParams.get("nocache") === "1";

    const size = clampInt(searchParams.get("size"), 256, 4096, 1024);
    const logoPath = searchParams.get("logo") || "";
    const logoScale = clampFloat(searchParams.get("logoScale"), 0.12, 0.38, 0.26);
    const footerH = clampInt(searchParams.get("footerH"), 0, 4096, Math.round(size * 0.28));
    const subFooterH = clampInt(searchParams.get("subFooterH"), 0, 4096, Math.round(size * 0.22));
    const footerGap = clampInt(searchParams.get("footerGap"), 0, 512, 28);
    const wordmarkPath = searchParams.get("wordmark") || "/Dial.letters.transparent.bg.crop.png";
    const wordmarkScale = clampFloat(searchParams.get("wordmarkScale"), 0.3, 1.0, 0.62);
    const footerBgHex = validHex(searchParams.get("footerBg")) || "#0F172A"; // slate-900ish
    const subFooterBgHex = validHex(searchParams.get("subFooterBg")) || "#0B1227"; // slightly darker to visually separate

    const bg = validHex(searchParams.get("bg")) || "#F8F6FF";
    const grad1 = validHex(searchParams.get("grad1")) || "#845EF7";
    const grad2 = validHex(searchParams.get("grad2")) || "#F472B6";

    // 1) QR as transparent mask (ECC-H)
    const qrSvg = await QRCode.toString(data, {
      type: "svg",
      errorCorrectionLevel: "H",
      margin: 4,
      color: { dark: "#000000", light: "#0000" },
    });
    const qrMaskPng = await sharp(Buffer.from(qrSvg)).resize(size, size, { fit: "contain" }).png().toBuffer();

    // 2) Vertical gradient for modules (gives modules a bit of depth)
    const gradientSvg = `
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${grad1}"/>
            <stop offset="100%" stop-color="${grad2}"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
      </svg>`;
    const gradientPng = await sharp(Buffer.from(gradientSvg)).png().toBuffer();

    // 3) Punch gradient through QR mask
    const coloredModules = await sharp(gradientPng)
      .composite([{ input: qrMaskPng, blend: "dest-in" }])
      .blur(0.5) // subtle soften for a rounder look while remaining scannable
      .png()
      .toBuffer();

    // 4) Transparent backdrop for depth + subtle rounded outline only (no solid fill)
    const radius = Math.round(size * 0.08);
    const outlineSvg = `
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="4" width="${size-8}" height="${size-8}" rx="${radius-6}" ry="${radius-6}"
          fill="none" stroke="#E6E0FF" stroke-opacity="0.65" stroke-width="8"/>
      </svg>`;
    const outlinePng = await sharp(Buffer.from(outlineSvg)).png().toBuffer();
    let out = await sharp({ create: { width: size, height: size, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } })
      .png()
      .composite([
        { input: coloredModules, left: 0, top: 0 },
        { input: outlinePng, left: 0, top: 0 }
      ])
      .png()
      .toBuffer();

    // 5) Optional centered logo with soft white pad
    if (logoPath) {
      const logoW = Math.round(size * logoScale);
      const pad = Math.max(4, Math.round(logoW * 0.05));
      const padSvg = `
        <svg width="${logoW + pad * 2}" height="${logoW + pad * 2}" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="${logoW + pad * 2}" height="${logoW + pad * 2}"
            rx="${Math.round(logoW * 0.22)}" ry="${Math.round(logoW * 0.22)}"
            fill="white" fill-opacity="0.92"/>
        </svg>`;

      // Resolve logo source: 
      // - if starts with http(s), fetch and buffer
      // - if starts with '/', load from public/<path>
      // - else, resolve relative to process.cwd()
      let logoInput: string | Buffer | undefined;
      try {
        if (/^https?:\/\//i.test(logoPath)) {
          const res = await fetch(logoPath);
          if (res.ok) {
            logoInput = Buffer.from(await res.arrayBuffer());
          }
        } else if (logoPath.startsWith("/")) {
          logoInput = path.join(process.cwd(), "public", logoPath.slice(1));
        } else {
          logoInput = path.resolve(process.cwd(), logoPath);
        }
      } catch {}

      if (logoInput) {
        const [padPng, logoPng, meta] = await Promise.all([
          sharp(Buffer.from(padSvg)).png().toBuffer(),
          sharp(logoInput).resize(logoW, logoW, { fit: "contain" }).png().toBuffer(),
          sharp(out).metadata(),
        ]);
        const w = meta.width || size;
        const cx = Math.round((w - (logoW + pad * 2)) / 2);
        const cy = cx;
        out = await sharp(out)
          .composite([
            { input: padPng, left: cx, top: cy },
            { input: logoPng, left: cx + pad, top: cy + pad },
          ])
          .png()
          .toBuffer();
      }
    }

    // 6) Footer strips
    // 6a) Main footer: wordmark only
    if (footerH > 0) {
      const footerBg = await sharp({
        create: { width: size, height: footerH, channels: 4, background: hexToRgb(footerBgHex) },
      })
        .png()
        .toBuffer();

      // Load wordmark from /public by default
      let wmInput: string | Buffer | undefined;
      try {
        if (/^https?:\/\//i.test(wordmarkPath)) {
          const res = await fetch(wordmarkPath);
          if (res.ok) wmInput = Buffer.from(await res.arrayBuffer());
        } else if (wordmarkPath.startsWith('/')) {
          wmInput = path.join(process.cwd(), 'public', wordmarkPath.slice(1));
        } else {
          wmInput = path.resolve(process.cwd(), wordmarkPath);
        }
      } catch {}

      let footer = footerBg;
      if (wmInput) {
        const wmW = Math.round(size * wordmarkScale);
        const wmPng = await sharp(wmInput).resize(wmW).png().toBuffer();
        const meta = await sharp(footer).metadata();
        const fw = meta.width || size;
        const fh = meta.height || footerH;
        const wmMeta = await sharp(wmPng).metadata();
        const wmH = wmMeta.height || Math.round(wmW * 0.2);
        const wmx = Math.round((fw - wmW) / 2);
        // Center wordmark vertically within taller main footer
        const wmy = Math.max(8, Math.round(fh * 0.5 - wmH / 2));
        footer = await sharp(footer).composite([{ input: wmPng, left: wmx, top: wmy }]).png().toBuffer();
      }

      out = await sharp({
        create: { width: size, height: size + footerH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } },
      })
        .png()
        .composite([
          { input: out, left: 0, top: 0 },
          { input: footer, left: 0, top: size },
        ])
        .png()
        .toBuffer();
    }

    // 6b) Secondary smaller footer: label then Request logo on their own lines
    if (subFooterH > 0) {
      let subFooter = await sharp({
        create: { width: size, height: subFooterH, channels: 4, background: hexToRgb(subFooterBgHex) },
      }).png().toBuffer();

      const labelSvg = `
        <svg width="${size}" height="${subFooterH}" xmlns="http://www.w3.org/2000/svg">
          <style>
            .lbl { font: italic 700 ${Math.round(size * 0.035)}px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; fill: #22c55e; }
          </style>
          <text x="50%" y="${Math.round(subFooterH * 0.45)}" text-anchor="middle" dominant-baseline="middle" class="lbl">Invoice Request Powered By:</text>
        </svg>`;
      const labelPng = await sharp(Buffer.from(labelSvg)).png().toBuffer();
      subFooter = await sharp(subFooter).composite([{ input: labelPng, left: 0, top: 0 }]).png().toBuffer();

      try {
        const reqLogoPath = path.join(process.cwd(), 'public', 'reqnetlogo.png');
        const reqLogo = await sharp(reqLogoPath).resize(Math.round(size * 0.22)).png().toBuffer();
        const meta = await sharp(subFooter).metadata();
        const fw = meta.width || size; const fh = meta.height || subFooterH;
        const lmeta = await sharp(reqLogo).metadata();
        const lw = lmeta.width || Math.round(size * 0.22);
        const lh = lmeta.height || Math.round(size * 0.08);
        const x = Math.round((fw - lw) / 2);
        const y = Math.max(8, Math.round(subFooterH * 0.84) - Math.round(lh / 2));
        subFooter = await sharp(subFooter).composite([{ input: reqLogo, left: x, top: y }]).png().toBuffer();
      } catch {}

      const outMeta = await sharp(out).metadata();
      const baseH = outMeta.height || size + footerH;

      const divider = await sharp({ create: { width: size, height: 2, channels: 4, background: { r:255,g:255,b:255,alpha:0.12 } } }).png().toBuffer();
      const spacer = footerGap > 0 ? await sharp({ create: { width: size, height: footerGap, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } }).png().toBuffer() : null;

      out = await sharp({
        create: { width: size, height: baseH + (spacer ? footerGap : 0) + 2 + subFooterH, channels: 4, background: { r:0,g:0,b:0,alpha:0 } },
      })
        .png()
        .composite([
          { input: out, left: 0, top: 0 },
          ...(spacer ? [{ input: spacer, left: 0, top: baseH }] : []),
          { input: divider, left: 0, top: baseH + (spacer ? footerGap : 0) },
          { input: subFooter, left: 0, top: baseH + (spacer ? footerGap : 0) + 2 },
        ])
        .png()
        .toBuffer();
    }

    return new NextResponse(out, {
      headers: noCache
        ? {
            "Content-Type": "image/png",
            "Cache-Control": "no-store, max-age=0",
          }
        : {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "QR generation failed" }, { status: 500 });
  }
}

function clampInt(v: string | null, min: number, max: number, d: number) {
  const n = v ? parseInt(v, 10) : d;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
}
function clampFloat(v: string | null, min: number, max: number, d: number) {
  const n = v ? parseFloat(v) : d;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d;
}
function validHex(v: string | null) {
  return v && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : null;
}
function hexToRgb(hex: string) {
  const c = hex.replace("#", "");
  const full = c.length === 3 ? c.split("").map((x) => x + x).join("") : c;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}


