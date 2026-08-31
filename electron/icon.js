/**
 * icon.js — 纯 Node 生成 PNG 图标(应用图标 + 托盘图标),零外部依赖
 * 使用 zlib 手工构造 PNG:圆角渐变方形 + 白色对勾,呼应「备忘+提醒」语义
 */
'use strict';

const zlib = require('zlib');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size, pixelFn) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function inRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.max(x + r, Math.min(px, x + w - r));
  const cy = Math.max(y + r, Math.min(py, y + h - r));
  return Math.hypot(px - cx, py - cy) <= r + 0.5;
}

/** 应用图标:青绿渐变圆角方块 + 白色对勾 */
function makeAppIcon(size = 256) {
  const r = size * 0.22;
  const pad = size * 0.06;
  const c1 = [18, 194, 160]; // #12c2a0
  const c2 = [13, 110, 253]; // #0d6efd
  const lineW = size * 0.075;
  const segs = [
    [size * 0.26, size * 0.55, size * 0.44, size * 0.72],
    [size * 0.44, size * 0.72, size * 0.76, size * 0.30],
  ];
  return encodePng(size, (x, y) => {
    if (!inRoundedRect(x, y, pad, pad, size - pad * 2, size - pad * 2, r)) return [0, 0, 0, 0];
    const t = (x + y) / (2 * size);
    const cr = lerp(c1[0], c2[0], t);
    const cg = lerp(c1[1], c2[1], t);
    const cb = lerp(c1[2], c2[2], t);
    for (const [x1, y1, x2, y2] of segs) {
      if (distToSeg(x, y, x1, y1, x2, y2) <= lineW) return [255, 255, 255, 255];
    }
    return [cr, cg, cb, 255];
  });
}

/** 托盘图标:深色圆角方块 + 青绿对勾(小尺寸下更清晰) */
function makeTrayIcon(size = 32) {
  const r = size * 0.25;
  const pad = size * 0.08;
  const lineW = size * 0.16;
  const segs = [
    [size * 0.24, size * 0.55, size * 0.44, size * 0.74],
    [size * 0.44, size * 0.74, size * 0.78, size * 0.28],
  ];
  return encodePng(size, (x, y) => {
    if (!inRoundedRect(x, y, pad, pad, size - pad * 2, size - pad * 2, r)) return [0, 0, 0, 0];
    for (const [x1, y1, x2, y2] of segs) {
      if (distToSeg(x, y, x1, y1, x2, y2) <= lineW) return [56, 217, 169, 255];
    }
    return [15, 23, 42, 255];
  });
}

module.exports = { makeAppIcon, makeTrayIcon, encodePng };
