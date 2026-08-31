/**
 * webdav.js — WebDAV 同步(零依赖,Node http/https + Basic Auth)
 * 用于把 data.json 上传到 WebDAV 网盘 / 从云端下载恢复
 */
'use strict';

const http = require('http');
const https = require('https');

function request(method, url, { user, pass, body, headers } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      reject(new Error('URL 无效'));
      return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      reject(new Error('仅支持 http/https 协议'));
      return;
    }
    const lib = u.protocol === 'https:' ? https : http;
    const auth = user != null || pass != null
      ? 'Basic ' + Buffer.from(`${user || ''}:${pass || ''}`).toString('base64')
      : undefined;
    const req = lib.request(u, {
      method,
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode, data: buf });
        } else {
          const err = new Error(`HTTP ${res.statusCode}${buf.length ? ' ' + buf.toString('utf8').slice(0, 80) : ''}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });
    req.on('error', (e) => reject(new Error('网络错误:' + e.message)));
    if (body) req.write(body);
    req.end();
  });
}

/** 上传 JSON 内容到 WebDAV(目标 url 以 /data.json 结尾或自动补全) */
async function webdavPut(baseUrl, user, pass, content) {
  const target = baseUrl.endsWith('/data.json') ? baseUrl : baseUrl.replace(/\/$/, '') + '/data.json';
  await request('PUT', target, {
    user, pass,
    body: content,
    headers: { 'Content-Type': 'application/json' },
  });
  return { ok: true, target };
}

/** 从 WebDAV 下载 data.json 文本 */
async function webdavGet(baseUrl, user, pass) {
  const target = baseUrl.endsWith('/data.json') ? baseUrl : baseUrl.replace(/\/$/, '') + '/data.json';
  const r = await request('GET', target, { user, pass });
  return { ok: true, data: r.data.toString('utf8'), target };
}

/** 连通性测试:GET 目标(存在与否都算连通,403/401 也算服务器可达) */
async function webdavTest(baseUrl, user, pass) {
  const target = baseUrl.endsWith('/data.json') ? baseUrl : baseUrl.replace(/\/$/, '') + '/data.json';
  try {
    await request('GET', target, { user, pass });
    return { ok: true, reachable: true, target };
  } catch (e) {
    // 服务器有响应(401/404 等)算连通;网络/URL 错误才算失败
    if (e.statusCode) return { ok: true, reachable: false, error: e.message, target };
    return { ok: false, error: e.message, target };
  }
}

module.exports = { webdavPut, webdavGet, webdavTest, request };
