/**
 * img-smoke.js — 图片附件协议冒烟测试
 * 运行: node_modules/electron/dist/electron.exe test/img-smoke.js
 * 预置 1 条带图备忘 + 真实 PNG,验证 remindme-img:// 协议加载缩略图成功
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'remindme-imgsmoke-'));
process.env.REMINDME_DATA_DIR = DATA_DIR;
fs.mkdirSync(path.join(DATA_DIR, 'attachments'), { recursive: true });

// 用 icon.js 生成一个合法 PNG 作为测试图
const { makeAppIcon } = require('../electron/icon');
fs.writeFileSync(path.join(DATA_DIR, 'attachments', 'test-photo.png'), makeAppIcon(256));
// 追加一张含特殊字符(+、空格、%)文件名的图,验证 IMG_URL 重编码漂移
fs.writeFileSync(path.join(DATA_DIR, 'attachments', 'a+b 100% c.png'), makeAppIcon(128));

// 预置 2 条带图备忘:一条有标题,一条无标题(验证"纯图片备忘"可创建渲染)
fs.writeFileSync(path.join(DATA_DIR, 'data.json'), JSON.stringify({
  memos: [
    {
      id: 1, title: '带图片的备忘', due_at: Date.now() + 3600_000,
      repeat_type: 'none', advance_minutes: 0, priority: 0, pinned: false,
      done: false, done_at: null, deleted: false, deleted_at: null,
      snoozed_until: null, images: ['test-photo.png'], adv_sent: false, due_sent: false, created_at: Date.now(),
    },
    {
      id: 2, title: '', due_at: Date.now() + 7200_000,
      repeat_type: 'none', advance_minutes: 0, priority: 0, pinned: false,
      done: false, done_at: null, deleted: false, deleted_at: null,
      snoozed_until: null, images: ['a+b 100% c.png'], adv_sent: false, due_sent: false, created_at: Date.now(),
    },
  ],
  settings: { theme: 'dark', autoLaunch: false },
  nextId: 3,
}, null, 2), 'utf8');

// 必须先 require 主进程再注册 whenReady(Electron 时序)
require('../electron/main.js');
const { app } = require('electron');

app.whenReady().then(() => {
  setTimeout(async () => {
    try {
      const win = require('electron').BrowserWindow.getAllWindows()[0];
      // 真实 PNG 内容(base64),用于模拟拖拽
      const pngB64 = makeAppIcon(256).toString('base64');
      const info = await win.webContents.executeJavaScript(`(async () => {
        await new Promise((r) => setTimeout(r, 500)); // 等图片加载
        const thumb = document.querySelector('.thumb');
        let loaded = false;
        if (thumb) {
          loaded = thumb.complete && thumb.naturalWidth > 0;
        }
        // —— 模拟拖拽一张真实 PNG,验证"拖拽即创建备忘" ——
        const bytes = Uint8Array.from(atob('${pngB64}'), (c) => c.charCodeAt(0));
        const file = new File([bytes], 'dropped.png', { type: 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(file);
        document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 900)); // 等异步创建完成

        // —— 打开编辑弹窗,焦点在内容框,粘贴图片 → 加入当前备忘(而非新建) ——
        const memo = document.querySelector('.memo');
        const mr = memo.getBoundingClientRect();
        memo.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: mr.left + 30, clientY: mr.top + 10 }));
        const editItem = document.querySelector('.ctx-item[data-cmd="edit"]');
        if (editItem) editItem.click();
        await new Promise((r) => setTimeout(r, 300));
        const imgsBefore = document.querySelectorAll('#edit-images .edit-img').length;
        document.querySelector('#edit-content').focus();
        const dt2 = new DataTransfer();
        dt2.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt2, bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 900)); // 等图片保存 + 刷新缩略图
        const imgsAfter = document.querySelectorAll('#edit-images .edit-img').length;
        const memoCountAfterPaste = document.querySelectorAll('.memo').length;
        // —— 双击编辑弹窗图片,验证 lightbox 打开 + 图片真实加载 ——
        const editImg = document.querySelector('#edit-images .edit-img img');
        const thumbSrc0 = editImg ? editImg.getAttribute('src') : null;
        const datasetImg0 = editImg ? editImg.dataset.img : null;
        editImg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 700));
        const lbHidden = document.querySelector('#lightbox').classList.contains('hidden');
        const lbSrc = document.querySelector('#lb-img').getAttribute('src');
        const lbNatW = document.querySelector('#lb-img').naturalWidth;
        document.querySelector('#lb-close').click();
        document.querySelector('#edit-cancel').click();

        // —— 打开含特殊字符文件名的备忘编辑,双击图片验证 lightbox 加载 ——
        const specialMemo = document.querySelectorAll('.memo')[1];
        const sr = specialMemo.getBoundingClientRect();
        specialMemo.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: sr.left + 30, clientY: sr.top + 10 }));
        document.querySelector('.ctx-item[data-cmd="edit"]').click();
        await new Promise((r) => setTimeout(r, 300));
        const specialImg = document.querySelector('#edit-images .edit-img img');
        const specialThumbSrc = specialImg ? specialImg.getAttribute('src') : null;
        specialImg.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 700));
        const specialLbHidden = document.querySelector('#lightbox').classList.contains('hidden');
        const specialLbNatW = document.querySelector('#lb-img').naturalWidth;
        const specialLbSrc = document.querySelector('#lb-img').getAttribute('src');
        document.querySelector('#lb-close').click();
        document.querySelector('#edit-cancel').click();

        const titles = [...document.querySelectorAll('.memo-title')].map((t) => t.textContent);
        return JSON.stringify({
          thumbs: document.querySelectorAll('.thumb').length,
          loaded,
          naturalW: thumb ? thumb.naturalWidth : 0,
          more: !!document.querySelector('.thumb-more'),
          memoMain: !!document.querySelector('.memo-main'),
          memoCount: document.querySelectorAll('.memo').length,
          emptyTitles: titles.filter((t) => !t.trim()).length,
          autoTitle: titles.find((t) => t.startsWith('图片备忘')) || '',
          editImgsBefore: imgsBefore,
          editImgsAfter: imgsAfter,
          memoCountAfterPaste,
          lbHidden,
          lbSrc,
          lbNatW,
          thumbSrc: thumbSrc0,
          datasetImg: datasetImg0,
          specialLbHidden,
          specialLbNatW,
          specialLbSrc,
          specialThumbSrc,
        });
      })()`);
      const r = JSON.parse(info);
      console.log('[img-smoke] 拖拽前备忘数:', r.memoCount - 1, '| 拖拽后:', r.memoCount, '| 缩略图:', r.thumbs, '| 图片真实加载:', r.loaded, '(宽', r.naturalW, ')');
      console.log('[img-smoke] 自动标题:', JSON.stringify(r.autoTitle), '| memo-main:', r.memoMain, '| 空标题条数:', r.emptyTitles);
      console.log('[img-smoke] 编辑内容框粘贴图片: 缩略图', r.editImgsBefore, '→', r.editImgsAfter, '| 备忘数保持', r.memoCountAfterPaste);
      console.log('[img-smoke] 双击图片 lightbox: hidden=' + r.lbHidden + ' | src=' + r.lbSrc + ' | naturalW=' + r.lbNatW + ' | thumbSrc=' + r.thumbSrc + ' | datasetImg=' + r.datasetImg);
      console.log('[img-smoke] 特殊字符文件名 lightbox: hidden=' + r.specialLbHidden + ' | src=' + r.specialLbSrc + ' | naturalW=' + r.specialLbNatW + ' | thumbSrc=' + r.specialThumbSrc);
      const pass = r.memoCount === 3 && r.thumbs >= 3 && r.loaded && r.naturalW > 0 && r.memoMain && r.autoTitle.startsWith('图片备忘')
        && r.editImgsAfter > r.editImgsBefore && r.editImgsBefore >= 1 && r.memoCountAfterPaste === 3
        && !r.specialLbHidden && r.specialLbNatW > 0 && r.specialLbSrc === r.specialThumbSrc;
      console.log(pass ? '[img-smoke] OK:remindme-img:// 协议工作正常' : '[img-smoke] FAIL');
      app.exit(pass ? 0 : 1);
    } catch (e) {
      console.error('[img-smoke] FAIL:', e.message);
      app.exit(1);
    }
  }, 3000);
});
