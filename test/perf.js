/**
 * perf.js — 性能验收测试(策划案 V1.0 验收标准)
 * 运行: node_modules/electron/dist/electron.exe test/perf.js
 * 注入 1000 条备忘,测量:冷启动耗时 / 全量渲染耗时 / 搜索渲染耗时
 * 退出码: 0=达标 1=未达标
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'remindme-perf-'));
process.env.REMINDME_DATA_DIR = DATA_DIR;
// 注意:不设 REMINDME_SMOKE,避免 main.js 的 smoke 钩子提前退出,由本脚本自行控制

// 预置 1000 条备忘
const memos = [];
const base = Date.now();
const words = ['取快递', '回电话', '开周会', '交周报', '吃药', '买牛奶', '还花呗', '面试', '健身', '读书',
  '写代码', '发邮件', '修 bug', '做 PPT', '订机票', '剪视频', '备份数据', '更新驱动', '洗衣服', '交房租'];
for (let i = 0; i < 1000; i++) {
  const due = base + i * 37 * 60_000; // 每条错开 37 分钟
  memos.push({
    id: i + 1,
    title: `备忘${i + 1}:${words[i % words.length]} ${i % 7 === 0 ? '重要' : ''}`.trim(),
    due_at: due,
    repeat_type: i % 10 === 0 ? 'weekly' : 'none',
    advance_minutes: i % 5 === 0 ? 10 : 0,
    priority: i % 7 === 0 ? 2 : i % 3 === 0 ? 1 : 0,
    pinned: i < 10,
    done: i % 8 === 0,
    done_at: i % 8 === 0 ? base - 1000 : null,
    deleted: false,
    deleted_at: null,
    snoozed_until: null,
    adv_sent: false,
    due_sent: false,
    created_at: base - 1000,
  });
}
fs.writeFileSync(path.join(DATA_DIR, 'data.json'), JSON.stringify({ memos, settings: { theme: 'dark', autoLaunch: false }, nextId: 1001 }, null, 2), 'utf8');

// 重要:必须先加载主进程,再注册 whenReady(Electron 时序要求)
require('../electron/main.js');

const { app } = require('electron');
const t0 = Date.now();
let coldStartMs = 0;

app.whenReady().then(() => {
  // 冷启动耗时 = 进程启动 → app ready(含窗口创建需等主进程回调;这里测量到 ready)
  coldStartMs = Date.now() - t0;

  setTimeout(async () => {
    try {
      const win = require('electron').BrowserWindow.getAllWindows()[0];
      const info = await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        await sleep(300); // 等首屏渲染完成
        const search = document.querySelector('#search');

        // 1) 全量渲染耗时 + 全量节点数(清空搜索)
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        let t0 = performance.now();
        search.dispatchEvent(new Event('input', { bubbles: true }));
        let renderAllMs = performance.now() - t0;
        const memoNodes = document.querySelectorAll('.memo').length;

        // 2) 搜索渲染耗时(命中结果较少的查询)
        t0 = performance.now();
        search.value = '备忘500';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        let searchMs = performance.now() - t0;
        const hits = document.querySelectorAll('.memo').length;

        // 3) 视图切换耗时(today 视图,清空搜索后)
        search.value = '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        t0 = performance.now();
        document.querySelector('.view-btn[data-view="today"]').click();
        let viewMs = performance.now() - t0;
        const viewCount = document.querySelectorAll('.memo').length;

        return JSON.stringify({
          memoNodes,
          renderAllMs: Math.round(renderAllMs),
          searchMs: Math.round(searchMs),
          hits,
          viewMs: Math.round(viewMs),
          viewCount,
          stat: document.querySelector('#stat-count').textContent,
        });
      })()`);
      const r = JSON.parse(info);
      console.log('[perf] 冷启动(到 app ready):', coldStartMs, 'ms');
      console.log('[perf] 全量渲染 1000 条:', r.renderAllMs, 'ms | DOM 节点:', r.memoNodes);
      console.log('[perf] 搜索渲染:', r.searchMs, 'ms | 命中:', r.hits, '条');
      console.log('[perf] 视图切换(today):', r.viewMs, 'ms | 显示:', r.viewCount, '条');
      console.log('[perf] stat:', r.stat);

      const pass = r.renderAllMs <= 800 && r.searchMs <= 100 && r.viewMs <= 200 && r.memoNodes === 1000;
      console.log(pass ? '[perf] 达标:1000 条渲染流畅,搜索/切换满足验收' : '[perf] 未达标,需优化');
      app.exit(pass ? 0 : 1);
    } catch (e) {
      console.error('[perf] FAIL:', e.message);
      app.exit(1);
    }
  }, 4000);
});
