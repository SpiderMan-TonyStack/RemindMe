/**
 * sounds.js — 纯 Node 生成内置提醒音效(WAV,零依赖)
 * 生成后以 data URL 形式注入渲染层,由 Audio 播放
 */
'use strict';

function makeWav(samples) {
  const rate = 44100;
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);       // PCM chunk size
  buf.writeUInt16LE(1, 20);        // PCM format(线性量化)
  buf.writeUInt16LE(1, 22);        // 单声道
  buf.writeUInt32LE(rate, 24);     // 采样率
  buf.writeUInt32LE(rate * 2, 28); // 字节率
  buf.writeUInt16LE(2, 32);        // 块对齐
  buf.writeUInt16LE(16, 34);       // 位深
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

function toDataUrl(buf) {
  return 'data:audio/wav;base64,' + buf.toString('base64');
}

/** 清脆:880Hz 两连音(120ms + 80ms 间隔 + 120ms) */
function makeClear() {
  const rate = 44100;
  const n = Math.floor(rate * 0.32);
  const s = new Float64Array(n);
  const put = (from, len, freq, vol) => {
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const env = Math.exp(-t * 22); // 快衰减
      s[from + i] += Math.sin(2 * Math.PI * freq * t) * env * vol;
    }
  };
  put(0, Math.floor(rate * 0.12), 880, 0.5);
  put(Math.floor(rate * 0.20), Math.floor(rate * 0.12), 880, 0.5);
  return toDataUrl(makeWav(s));
}

/** 柔和:523Hz 单音 300ms 缓衰减 */
function makeGentle() {
  const rate = 44100;
  const n = Math.floor(rate * 0.3);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.exp(-t * 9);
    s[i] = Math.sin(2 * Math.PI * 523 * t) * env * 0.45;
  }
  return toDataUrl(makeWav(s));
}

/** 叮:988Hz 单短音(备选,默认清脆的补充) */
function makeDing() {
  const rate = 44100;
  const n = Math.floor(rate * 0.22);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.exp(-t * 16);
    s[i] = Math.sin(2 * Math.PI * 988 * t) * env * 0.45;
  }
  return toDataUrl(makeWav(s));
}

const SOUNDS = { clear: makeClear(), gentle: makeGentle(), ding: makeDing() };

module.exports = { SOUNDS, makeClear, makeGentle, makeDing };
