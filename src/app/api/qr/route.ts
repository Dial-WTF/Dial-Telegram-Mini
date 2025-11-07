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
    // global horizontal padding to keep 1:1 outer canvas with black bars left/right
    const sidePad = clampInt(searchParams.get("pad"), 0, Math.round(size * 0.2), Math.round(size * 0.05));
    const canvasW = size + sidePad * 2;
    const logoPath = searchParams.get("logo") || "";
    const logoScale = clampFloat(searchParams.get("logoScale"), 0.12, 0.38, 0.26);
    // Header (wordmark) height and bottom section defaults tuned to better fit square aspect
    const footerH = clampInt(searchParams.get("footerH"), 0, 4096, Math.round(size * 0.18));
    const subFooterH = clampInt(searchParams.get("subFooterH"), 0, 4096, Math.round(size * 0.14));
    const footerGap = clampInt(searchParams.get("footerGap"), 0, 512, 20);
    const bottomPad = clampInt(searchParams.get("bottomPad"), 0, 1024, Math.round(size * 0.04));
    // Position of the green label within the subfooter (closer to top to sit tighter to QR)
    const labelY = clampFloat(searchParams.get("labelY"), 0.1, 0.9, 0.22);
    const wordmarkPath = searchParams.get("wordmark") || "/Dial.letters.transparent.bg.crop.png";
    const wordmarkScale = clampFloat(searchParams.get("wordmarkScale"), 0.3, 1.0, 0.62);
    // Make outer areas black by default
    const footerBgHex = validHex(searchParams.get("footerBg")) || "#000000";
    const subFooterBgHex = validHex(searchParams.get("subFooterBg")) || "#000000";

    const bg = validHex(searchParams.get("bg")) || "#F8F6FF";
    const grad1 = validHex(searchParams.get("grad1")) || "#845EF7";
    const grad2 = validHex(searchParams.get("grad2")) || "#F472B6";

    // 1) QR as transparent mask (ECC-H) with rounded/braille-style modules
    const style = (searchParams.get("style") || 'round').toLowerCase();
    async function makeRoundMaskPng(): Promise<Buffer> {
      try {
        const qrAny: any = (QRCode as any).create(data, { errorCorrectionLevel: 'H' });
        const modules = qrAny.modules;
        const count: number = modules?.size || modules?.length || qrAny?.getModuleCount?.() || 29;
        const unit = 100; // base unit to build a high-res mask then scale to size
        const pad = 100; // margin to avoid clipping after rounding
        const W = count * unit + pad * 2;
        const rr = Math.round(unit * 0.28); // corner radius for modules (rounded rect/dash)
        const gap = Math.round(unit * 0.10);
        const blocks: string[] = [];
        const isFinder = (x: number, y: number) =>
          (x < 7 && y < 7) || (x >= count - 7 && y < 7) || (x < 7 && y >= count - 7);
        const get = (x: number, y: number) => (modules?.get?.(x, y) ?? modules?.data?.[y * count + x] ?? qrAny?.isDark?.(x, y) ?? false) as boolean;
        const seen: boolean[] = new Array(count * count).fill(false);
        const mark = (x: number, y: number) => { seen[y * count + x] = true; };
        const wasSeen = (x: number, y: number) => seen[y * count + x];
        for (let y = 0; y < count; y++) {
          for (let x = 0; x < count; x++) {
            if (isFinder(x, y) || wasSeen(x, y)) continue;
            const on = get(x, y);
            if (!on) continue;
            // find horizontal run length
            let hx = x;
            while (hx + 1 < count && !isFinder(hx + 1, y) && get(hx + 1, y) && !wasSeen(hx + 1, y)) hx++;
            const hLen = hx - x + 1;
            // find vertical run length
            let vy = y;
            while (vy + 1 < count && !isFinder(x, vy + 1) && get(x, vy + 1) && !wasSeen(x, vy + 1)) vy++;
            const vLen = vy - y + 1;
            if (hLen >= vLen && hLen > 1) {
              // horizontal dash
              for (let dx = x; dx <= hx; dx++) mark(dx, y);
              const rx = pad + x * unit + gap / 2;
              const ry = pad + y * unit + gap / 2;
              const w = hLen * unit - gap;
              const h = unit - gap;
              blocks.push(`<rect x="${rx}" y="${ry}" width="${w}" height="${h}" rx="${rr}" ry="${rr}" />`);
            } else if (vLen > 1) {
              // vertical dash
              for (let dy = y; dy <= vy; dy++) mark(x, dy);
              const rx = pad + x * unit + gap / 2;
              const ry = pad + y * unit + gap / 2;
              const w = unit - gap;
              const h = vLen * unit - gap;
              blocks.push(`<rect x="${rx}" y="${ry}" width="${w}" height="${h}" rx="${rr}" ry="${rr}" />`);
            } else {
              // single dot
              mark(x, y);
              const rx = pad + x * unit + gap / 2;
              const ry = pad + y * unit + gap / 2;
              const w = unit - gap;
              const h = unit - gap;
              blocks.push(`<rect x="${rx}" y="${ry}" width="${w}" height="${h}" rx="${rr}" ry="${rr}" />`);
            }
          }
        }
        // Draw explicit finder patterns (rounded outer, white gap, inner solid)
        const fp = (sx: number, sy: number) => {
          const ox = pad + sx * unit; const oy = pad + sy * unit;
          const outer = `<rect x="${ox}" y="${oy}" width="${7*unit}" height="${7*unit}" rx="${unit}" ry="${unit}" />`;
          const gapRect = `<rect x="${ox + unit}" y="${oy + unit}" width="${5*unit}" height="${5*unit}" rx="${unit*0.6}" ry="${unit*0.6}" fill="#fff"/>`;
          const inner = `<rect x="${ox + 2*unit}" y="${oy + 2*unit}" width="${3*unit}" height="${3*unit}" rx="${unit*0.4}" ry="${unit*0.4}" />`;
          return `${outer}${gapRect}${inner}`;
        };
        const finders = `${fp(0,0)}${fp(count-7,0)}${fp(0,count-7)}`;
        const svg = `<svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#0000"/>
  <g fill="#000">${finders}${blocks.join('')}</g>
</svg>`;
        const buf = await sharp(Buffer.from(svg)).resize(size, size, { fit: 'contain' }).png().toBuffer();
        return buf;
      } catch {
        // Fallback to default square modules mask
        const qrSvg = await QRCode.toString(data, { type: 'svg', errorCorrectionLevel: 'H', margin: 4, color: { dark: '#000', light: '#0000' } });
        return await sharp(Buffer.from(qrSvg)).resize(size, size, { fit: 'contain' }).png().toBuffer();
      }
    }
    const qrMaskPng = style === 'round' ? await makeRoundMaskPng() : await sharp(Buffer.from(await QRCode.toString(data, { type: 'svg', errorCorrectionLevel: 'H', margin: 4, color: { dark: '#000', light: '#0000' } }))).resize(size, size, { fit: 'contain' }).png().toBuffer();

    // 2) Vertical gradient for modules (gives modules a bit of depth) — skip when style=round for maximum scannability
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

    // 3) Build module layer
    const coloredModules = style === 'round'
      ? qrMaskPng // already solid black with rounded modules and proper finders
      : await sharp(gradientPng).composite([{ input: qrMaskPng, blend: 'dest-in' }]).png().toBuffer();

    // 4) White rounded panel backdrop with soft outline (QR area should be white)
    const radius = Math.round(size * 0.08);
    const panelSvg = `
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="4" width="${size-8}" height="${size-8}" rx="${radius-6}" ry="${radius-6}"
          fill="#ffffff"/>
      </svg>`;
    const outlineSvg = `
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="4" width="${size-8}" height="${size-8}" rx="${radius-6}" ry="${radius-6}"
          fill="none" stroke="#C8C1EF" stroke-opacity="0.85" stroke-width="10"/>
      </svg>`;
    const panelPng = await sharp(Buffer.from(panelSvg)).png().toBuffer();
    const outlinePng = await sharp(Buffer.from(outlineSvg)).png().toBuffer();
    let out = await sharp({ create: { width: size, height: size, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } })
      .png()
      .composite([
        { input: panelPng, left: 0, top: 0 },
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
            fill="black" fill-opacity="0.75"/>
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

      // Place wordmark header at the TOP, QR block in the MIDDLE on black canvas
      const canvasH = size + footerH;
      out = await sharp({
        create: { width: canvasW, height: canvasH, channels: 4, background: { r:0,g:0,b:0,alpha:1 } },
      })
        .png()
        .composite([
          { input: footer, left: sidePad, top: 0 },
          { input: out, left: sidePad, top: footerH },
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
          <text x="50%" y="${Math.round(subFooterH * labelY)}" text-anchor="middle" dominant-baseline="middle" class="lbl">Invoice Request Powered By:</text>
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
        // Center the logo lower but avoid clipping; use ~70% vertical position
        const y = Math.max(8, Math.round(subFooterH * 0.70) - Math.round(lh / 2));
        subFooter = await sharp(subFooter).composite([{ input: reqLogo, left: x, top: y }]).png().toBuffer();
      } catch {}

      const outMeta = await sharp(out).metadata();
      const baseH = outMeta.height || (size + footerH);

      const divider = await sharp({ create: { width: canvasW, height: 2, channels: 4, background: { r:255,g:255,b:255,alpha:0.12 } } }).png().toBuffer();
      const spacer = footerGap > 0 ? await sharp({ create: { width: canvasW, height: footerGap, channels: 4, background: { r:0,g:0,b:0,alpha:0 } } }).png().toBuffer() : null;

      out = await sharp({
        create: { width: canvasW, height: baseH + (spacer ? footerGap : 0) + 2 + subFooterH + bottomPad, channels: 4, background: { r:0,g:0,b:0,alpha:1 } },
      })
        .png()
        .composite([
          { input: out, left: 0, top: 0 },
          ...(spacer ? [{ input: spacer, left: 0, top: baseH }] : []),
          { input: divider, left: 0, top: baseH + (spacer ? footerGap : 0) },
          { input: subFooter, left: sidePad, top: baseH + (spacer ? footerGap : 0) + 2 + Math.max(0, Math.round(bottomPad * 0.2)) },
        ])
        .png()
        .toBuffer();
    }
    // If the final height is larger than width, pad left/right to make a perfect square
    try {
      const meta = await sharp(out).metadata();
      const w = meta.width || canvasW; const h = meta.height || canvasW;
      if (w < h) {
        const padLR = Math.round((h - w) / 2);
        const bg = { r: 0, g: 0, b: 0, alpha: 1 } as const;
        out = await sharp(out).extend({ left: padLR, right: h - (w + padLR), top: 0, bottom: 0, background: bg }).png().toBuffer();
      }
    } catch {}
    // Ensure no transparent pixels remain: flatten to solid black background
    out = await sharp(out).flatten({ background: { r: 0, g: 0, b: 0 } }).png().toBuffer();
    // Return as a Buffer which is compatible with NextResponse init
    const bytes = Buffer.from(out);
    return new NextResponse(bytes, {
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


