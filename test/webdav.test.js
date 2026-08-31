/**
 * webdav.test.js — WebDAV 同步模块单测(本地 mock 服务器,验证上传/下载/鉴权)
 * 运行: node test/webdav.test.js
 */
'use strict';

const http = require('http');
const assert = require('assert');
const { webdavPut, webdavGet, webdavTest } = require('../electron/webdav');

let passed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { console.error('  ✗ FAIL:', name); process.exitCode = 1; }
}

(async function main() {
  // mock WebDAV 服务器:按路径存储,支持 PUT/GET,校验 Basic Auth
  const store = new Map();
  const server = http.createServer((req, res) => {
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Basic ' + Buffer.from('user:pass').toString('base64')) {
      res.writeHead(401); res.end('unauthorized');
      return;
    }
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { store.set(req.url, body); res.writeHead(201); res.end(); });
    } else if (req.method === 'GET') {
      if (!store.has(req.url)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200); res.end(store.get(req.url));
    } else { res.writeHead(405); res.end(); }
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/remindme`;

  console.log('— WebDAV 上传/下载 —');
  const payload = JSON.stringify({ memos: [{ id: 1, title: '云端条目' }] });
  const up = await webdavPut(base, 'user', 'pass', payload);
  ok(up.ok && up.target.endsWith('/remindme/data.json'), 'PUT 上传成功且路径补全 data.json');
  const dn = await webdavGet(base, 'user', 'pass');
  ok(dn.ok && JSON.parse(dn.data).memos[0].title === '云端条目', 'GET 下载内容一致');

  console.log('— 鉴权 —');
  let authErr = null;
  try { await webdavGet(base, 'user', 'wrong'); } catch (e) { authErr = e.message; }
  ok(authErr && authErr.includes('401'), '错误密码返回 401');

  console.log('— 连通性测试 —');
  const t1 = await webdavTest(base, 'user', 'pass');
  ok(t1.ok && t1.reachable, '有文件时 test 可达');
  const t2 = await webdavTest(`http://127.0.0.1:${port}/empty`, 'user', 'pass');
  ok(t2.ok && !t2.reachable, '无文件时 test 仍连通(reachable=false)');
  const t3 = await webdavTest('not-a-url', 'u', 'p');
  ok(!t3.ok, '非法 URL 返回失败');

  server.close();
  console.log(`\n共通过 ${passed} 项断言`);
  if (process.exitCode) console.log('存在失败项!');
  else console.log('全部通过 ✔');
})();
