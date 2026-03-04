#!/usr/bin/env node
/**
 * Generates assets/icon.png (512x512) from scratch using only Node.js built-ins.
 * Renders the same design as assets/icon.svg: a globe with ADB proxy tunnel arc.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;

// RGBA pixel buffer
const buf = Buffer.alloc(SIZE * SIZE * 4, 0);

function setPixel(x, y, r, g, b, a) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  // Alpha-blend over existing pixel
  const srcA = a / 255;
  const dstA = buf[i + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) return;
  buf[i]     = Math.round((r * srcA + buf[i]     * dstA * (1 - srcA)) / outA);
  buf[i + 1] = Math.round((g * srcA + buf[i + 1] * dstA * (1 - srcA)) / outA);
  buf[i + 2] = Math.round((b * srcA + buf[i + 2] * dstA * (1 - srcA)) / outA);
  buf[i + 3] = Math.round(outA * 255);
}

// Draw a filled circle with anti-aliasing
function fillCircle(cx, cy, r, rr, gg, bb, aa) {
  const r2 = r * r;
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const dx = x - cx, dy = y - cy;
      const dist2 = dx * dx + dy * dy;
      if (dist2 <= r2) {
        // Inside: check edge for anti-alias
        const edge = r - Math.sqrt(dist2);
        const alpha = edge >= 1 ? aa : Math.round(aa * edge);
        setPixel(x, y, rr, gg, bb, alpha);
      }
    }
  }
}

// Draw a filled rounded rectangle
function fillRoundRect(x0, y0, w, h, rx, rr, gg, bb, aa) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      // Corner check
      let inside = true;
      const corners = [
        [x0 + rx, y0 + rx],
        [x0 + w - rx, y0 + rx],
        [x0 + rx, y0 + h - rx],
        [x0 + w - rx, y0 + h - rx],
      ];
      if (x < x0 + rx && y < y0 + rx) {
        const dx = x - corners[0][0], dy = y - corners[0][1];
        if (dx * dx + dy * dy > rx * rx) inside = false;
      } else if (x >= x0 + w - rx && y < y0 + rx) {
        const dx = x - corners[1][0], dy = y - corners[1][1];
        if (dx * dx + dy * dy > rx * rx) inside = false;
      } else if (x < x0 + rx && y >= y0 + h - rx) {
        const dx = x - corners[2][0], dy = y - corners[2][1];
        if (dx * dx + dy * dy > rx * rx) inside = false;
      } else if (x >= x0 + w - rx && y >= y0 + h - rx) {
        const dx = x - corners[3][0], dy = y - corners[3][1];
        if (dx * dx + dy * dy > rx * rx) inside = false;
      }
      if (inside) setPixel(x, y, rr, gg, bb, aa);
    }
  }
}

// Draw a thick line with anti-aliasing (Wu's algorithm style)
function drawLine(x0, y0, x1, y1, width, rr, gg, bb, aa) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = -dy / len, ny = dx / len; // normal
  const hw = width / 2;
  const steps = Math.ceil(len * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = x0 + dx * t, py = y0 + dy * t;
    for (let w = -hw - 1; w <= hw + 1; w++) {
      const wx = px + nx * w, wy = py + ny * w;
      const dist = Math.abs(w);
      const edge = hw - dist;
      if (edge >= 0) {
        const alpha = edge >= 1 ? aa : Math.round(aa * edge);
        setPixel(Math.round(wx), Math.round(wy), rr, gg, bb, alpha);
      }
    }
  }
}

// Draw an ellipse outline (clipped to globeClip circle)
function drawEllipse(cx, cy, rx, ry, lineWidth, clipCx, clipCy, clipR, rr, gg, bb, aa) {
  const steps = Math.max(rx, ry) * 8;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = cx + Math.cos(t) * rx;
    const y = cy + Math.sin(t) * ry;
    // Clip to globe
    const ddx = x - clipCx, ddy = y - clipCy;
    if (ddx * ddx + ddy * ddy > clipR * clipR) continue;
    fillCircle(x, y, lineWidth / 2, rr, gg, bb, aa);
  }
}

// Draw a quadratic bezier arc
function drawQuadBezier(x0, y0, x1, y1, x2, y2, lineWidth, clipCx, clipCy, clipR, rr, gg, bb, aa) {
  const steps = 300;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * x0 + 2 * mt * t * x1 + t * t * x2;
    const y = mt * mt * y0 + 2 * mt * t * y1 + t * t * y2;
    const ddx = x - clipCx, ddy = y - clipCy;
    if (ddx * ddx + ddy * ddy > clipR * clipR) continue;
    fillCircle(x, y, lineWidth / 2, rr, gg, bb, aa);
  }
}

// ---- Render the icon ----

const SCALE = SIZE / 512;
const GCX = 256 * SCALE, GCY = 256 * SCALE, GR = 216 * SCALE;

// 1. Card background: rounded rect #EEF4FF with rx=108
fillRoundRect(0, 0, SIZE, SIZE, 108 * SCALE, 0xEE, 0xF4, 0xFF, 255);

// 2. Globe fill: radial gradient approximated as solid #3990F4 (midpoint of gradient)
// We'll approximate the gradient by drawing concentric circles from light to dark
for (let r = GR; r >= 0; r--) {
  const t = 1 - r / GR;
  const rr = Math.round(0x5B + (0x1A - 0x5B) * t);
  const gg = Math.round(0xB0 + (0x72 - 0xB0) * t);
  const bb = Math.round(0xFF + (0xE8 - 0xFF) * t);
  fillCircle(GCX, GCY, r, rr, gg, bb, 255);
}

// 3. Globe grid lines (white, opacity 0.25, stroke-width 8)
const gridA = Math.round(255 * 0.25);
const gridW = 8 * SCALE;
// Equator
drawLine(40 * SCALE, 256 * SCALE, 472 * SCALE, 256 * SCALE, gridW, 255, 255, 255, gridA);
// Horizontal ellipses
drawEllipse(GCX, GCY, 216 * SCALE, 76 * SCALE, gridW, GCX, GCY, GR, 255, 255, 255, gridA);
drawEllipse(GCX, GCY, 216 * SCALE, 152 * SCALE, gridW, GCX, GCY, GR, 255, 255, 255, gridA);
// Prime meridian
drawLine(256 * SCALE, 40 * SCALE, 256 * SCALE, 472 * SCALE, gridW, 255, 255, 255, gridA);
// Off-center vertical meridian ellipse
drawEllipse(GCX, GCY, 108 * SCALE, 216 * SCALE, gridW, GCX, GCY, GR, 255, 255, 255, gridA);

// 4. Sheen overlay (radial, white 0-30% opacity) - approximate as light circle in top-left
for (let r = GR; r >= 0; r--) {
  const px = GCX - GR * 0.2, py = GCY - GR * 0.2;
  const dist = Math.sqrt((px - GCX) * (px - GCX) + (py - GCY) * (py - GCY));
  const t = 1 - r / GR;
  const alpha = Math.round(255 * 0.15 * (1 - t));
  // Draw as very subtle white overlay at top-left
  if (alpha > 0) {
    const qx = GCX + (Math.random() - 0.7) * GR;
    const qy = GCY + (Math.random() - 0.7) * GR;
    // Skip random approach - just draw uniform sheen
  }
}
// Simple sheen: lighter tint in upper-left quadrant
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x - GCX, dy = y - GCY;
    if (dx * dx + dy * dy > GR * GR) continue;
    // Distance from upper-left sheen center (36%, 30% of globe)
    const scx = GCX - GR * 0.2, scy = GCY - GR * 0.25;
    const sdx = x - scx, sdy = y - scy;
    const sdist = Math.sqrt(sdx * sdx + sdy * sdy) / (GR * 0.58);
    if (sdist < 1) {
      const alpha = Math.round(255 * 0.18 * (1 - sdist));
      setPixel(x, y, 255, 255, 255, alpha);
    }
  }
}

// 5. Globe border ring (white, opacity 0.20, stroke-width 5)
drawEllipse(GCX, GCY, GR, GR, 5 * SCALE, GCX * 2, GCY * 2, GR * 2, 255, 255, 255, Math.round(255 * 0.20));

// 6. ADB proxy tunnel arc: Q 256 420 (quadratic bezier)
// M 108 330 Q 256 420 404 330
drawQuadBezier(
  108 * SCALE, 330 * SCALE,
  256 * SCALE, 420 * SCALE,
  404 * SCALE, 330 * SCALE,
  16 * SCALE, GCX, GCY, GR,
  255, 255, 255, Math.round(255 * 0.60)
);

// 7. Left endpoint node (white, opacity 0.80)
fillCircle(108 * SCALE, 330 * SCALE, 14 * SCALE, 255, 255, 255, Math.round(255 * 0.80));

// 8. Right endpoint node - green glow halo
fillCircle(404 * SCALE, 330 * SCALE, 34 * SCALE, 0x22, 0xC5, 0x5E, Math.round(255 * 0.18));
// Main green circle (gradient approx: #6EFFA8 -> #1DB954)
for (let r = 22 * SCALE; r >= 0; r--) {
  const t = 1 - r / (22 * SCALE);
  const rr = Math.round(0x6E + (0x1D - 0x6E) * t);
  const gg = Math.round(0xFF + (0xB9 - 0xFF) * t);
  const bb = Math.round(0xA8 + (0x54 - 0xA8) * t);
  fillCircle(404 * SCALE, 330 * SCALE, r, rr, gg, bb, 255);
}
// Inner white pip
fillCircle(404 * SCALE, 330 * SCALE, 8 * SCALE, 255, 255, 255, Math.round(255 * 0.88));

// ---- Encode as PNG ----

function encodePNG(width, height, pixels) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeB = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.concat([typeB, data]);
    const crc = crc32(crcBuf);
    const crcOut = Buffer.alloc(4);
    crcOut.writeInt32BE(crc, 0);
    return Buffer.concat([len, typeB, data, crcOut]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB (no alpha to keep it simpler... actually use 6=RGBA)
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw scanlines with filter byte 0
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter None
    pixels.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// CRC32 table
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return crc ^ -1;
}

const png = encodePNG(SIZE, SIZE, buf);
const outPath = path.join(__dirname, '../assets/icon.png');
fs.writeFileSync(outPath, png);
console.log(`Written: ${outPath} (${png.length} bytes)`);
