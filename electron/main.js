/**
 * main.js — RemindMe 主进程
 * 窗口管理 · 托盘常驻 · 系统通知 · 全局快捷键 · IPC 服务 · 提醒调度
 */
'use strict';

const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, globalShortcut, nativeImage, dialog, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store, REPEAT_NONE } = require('./store');
const { makeAppIcon, makeTrayIcon } = require('./icon');
const { webdavPut, webdavGet, webdavTest } = require('./webdav');

// 图片附件自定义协议:渲染层用 remindme-img://<filename> 加载本地附件
protocol.registerSchemesAsPrivileged([
  { scheme: 'remindme-img', privileges: { standard: false, secure: false, supportFetchAPI: false, stream: true } },
]);

const APP_ID = 'com.winking.remindme';
let win = null;
let tray = null;
let store = null;
let isQuitting = false;
let scanTimer = null;
let trayIconPath = '';

// ---------- 单实例 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

// ---------- 数据目录 ----------
function dataDir() {
  // 测试时可指定临时数据目录,避免污染正式数据
  if (process.env.REMINDME_DATA_DIR) return process.env.REMINDME_DATA_DIR;
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 图片附件目录 */
function attachmentsDir() {
  const dir = path.join(dataDir(), 'attachments');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureIcons() {
  const dir = dataDir();
  trayIconPath = path.join(dir, 'tray.png');
  try {
    fs.writeFileSync(trayIconPath, makeTrayIcon(32));
  } catch (e) {
    console.error('[icon] 生成失败:', e.message);
  }
  return trayIconPath;
}

// ---------- 窗口 ----------
function createWindow() {
  win = new BrowserWindow({
    width: 920,
    height: 660,
    minWidth: 760,
    minHeight: 520,
    title: 'RemindMe 备忘录',
    icon: nativeImage.createFromBuffer(makeAppIcon(256)),
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 需 require 本地模块(sounds.js),关闭沙箱但仍保持 contextIsolation 隔离
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.once('ready-to-show', () => win.show());

  // 关闭按钮(X)= 直接退出应用,不再驻留托盘(用户需求)
  win.on('closed', () => { win = null; });
}

function showWindow() {
  if (!win) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------- 托盘 ----------
function createTray() {
  tray = new Tray(nativeImage.createFromPath(trayIconPath));
  tray.setToolTip('RemindMe 备忘录');
  const menu = Menu.buildFromTemplate([
    { label: '打开备忘录', click: () => showWindow() },
    { label: '快速记录…', click: () => quickAdd() },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: store.getSettings().autoLaunch,
      click: (item) => {
        store.setSettings({ autoLaunch: item.checked });
        applyAutoLaunch(item.checked);
      },
    },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showWindow());
}

// ---------- 快捷添加 ----------
function quickAdd() {
  showWindow();
  if (win) win.webContents.send('focus-quick-add');
}

// ---------- 开机自启 ----------
function applyAutoLaunch(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled });
}

// ---------- 提醒调度 ----------
function startReminderScan() {
  scanTimer = setInterval(() => {
    if (!store) return;
    const fired = store.scanReminders();
    if (fired.length) {
      for (const f of fired) {
        showNotification(f);
        win && win.webContents.send('data-changed');
      }
    }
  }, 10_000);
}

function showNotification({ id, title, body, kind }) {
  if (!Notification.isSupported()) return;
  // 通知时播放自定义提醒音(渲染进程播放内置音效)
  if (win && win.webContents) {
    const sound = (store.getSettings() || {}).sound || 'none';
    win.webContents.send('play-reminder-sound', sound);
  }
  const n = new Notification({
    title: `⏰ ${title}`,
    body,
    icon: nativeImage.createFromPath(trayIconPath),
    silent: false,
    // Windows toast 支持动作按钮(不支持时自动忽略)
    actions: kind === 'due'
      ? [
          { type: 'button', text: '延后 5 分钟' },
          { type: 'button', text: '完成' },
        ]
      : [{ type: 'button', text: '知道了' }],
  });
  n.on('click', () => { showWindow(); win && win.webContents.send('focus-memo', id); });
  n.on('action', (_e, index) => {
    if (kind === 'due' && index === 0) {
      store.snooze(id, 5);
    } else if (kind === 'due' && index === 1) {
      store.toggleDone(id);
    }
    win && win.webContents.send('data-changed');
  });
  n.show();
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('memos:list', () => store.listMemos());
  ipcMain.handle('memos:add', (_e, p) => store.addMemo(p));
  ipcMain.handle('memos:toggle-done', (_e, id) => store.toggleDone(Number(id)));
  ipcMain.handle('memos:toggle-pin', (_e, id) => store.togglePin(Number(id)));
  ipcMain.handle('memos:set-priority', (_e, id, p) => store.setPriority(Number(id), Number(p)));
  ipcMain.handle('memos:update', (_e, id, patch) => store.updateMemo(Number(id), patch));
  ipcMain.handle('memos:snooze', (_e, id, minutes) => store.snooze(Number(id), Number(minutes)));
  ipcMain.handle('memos:soft-delete', (_e, id) => store.softDelete(Number(id)));
  ipcMain.handle('memos:restore', (_e, id) => store.restore(Number(id)));
  ipcMain.handle('memos:hard-delete', (_e, id) => store.hardDelete(Number(id)));
  ipcMain.handle('memos:clear-done', () => store.clearDone());
  ipcMain.handle('memos:clear-trash', () => store.clearTrash());
  ipcMain.handle('memos:history', (_e, limit) => store.getHistory(Number(limit) || 50));

  // 图片附件
  ipcMain.handle('memos:pick-images', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '选择图片',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (canceled || !filePaths || !filePaths.length) return { ok: true, images: [] };
    const dir = attachmentsDir();
    const saved = [];
    for (const src of filePaths) {
      try {
        // 复制到附件目录,时间戳前缀防重名
        const base = path.basename(src);
        const safe = base.replace(/[^\w.\-一-龥]/g, '_');
        const name = `${Date.now()}-${safe}`;
        fs.copyFileSync(src, path.join(dir, name));
        saved.push(name);
      } catch (e) {
        console.error('[main] 复制图片失败:', e.message);
      }
    }
    return { ok: true, images: saved };
  });
  ipcMain.handle('memos:add-images', (_e, id, names) => store.addImages(Number(id), names));
  // 粘贴/拖拽图片:直接保存 buffer 到附件目录(用于"复制图片即创建备忘")
  ipcMain.handle('memo:save-image-buffer', (_e, payload) => {
    try {
      const buf = payload && payload.buffer;
      if (!buf || !buf.byteLength) return { ok: false, error: 'empty buffer' };
      const extMap = {
        'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
        'image/webp': 'webp', 'image/bmp': 'bmp',
      };
      const ext = extMap[(payload.mime || '').toLowerCase()] || 'png';
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      fs.writeFileSync(path.join(attachmentsDir(), name), Buffer.from(buf));
      return { ok: true, name };
    } catch (e) {
      console.error('[main] 保存粘贴图片失败:', e.message);
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('memos:remove-image', (_e, id, filename) => {
    const m = store.removeImage(Number(id), filename);
    if (m) {
      try {
        const file = path.join(attachmentsDir(), path.basename(String(filename)));
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch (e) {
        console.error('[main] 删除附件失败:', e.message);
      }
    }
    return m;
  });

  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:set', (_e, patch) => {
    const s = store.setSettings(patch);
    if ('autoLaunch' in patch) applyAutoLaunch(patch.autoLaunch);
    return s;
  });

  // 托盘气泡
  ipcMain.on('tray:set-tip', (_e, tip) => {
    if (tray && typeof tip === 'string') tray.setToolTip(tip);
  });

  ipcMain.handle('data:export', async (_e, format) => {
    const memos = store.listMemos().filter((m) => !m.deleted);
    const defaultName = `RemindMe-备份-${new Date().toISOString().slice(0, 10)}.${format === 'csv' ? 'csv' : 'json'}`;
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '导出备忘',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: format === 'csv'
        ? [{ name: 'CSV 文件', extensions: ['csv'] }]
        : [{ name: 'JSON 文件', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      if (format === 'csv') {
        const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
        const rows = [['标题', '到期时间', '重复', '优先级', '完成', '创建时间']];
        for (const m of memos) {
          rows.push([
            esc(m.title),
            esc(new Date(m.due_at).toLocaleString('zh-CN')),
            esc(m.repeat_type),
            esc(m.priority),
            esc(m.done ? '是' : '否'),
            esc(new Date(m.created_at).toLocaleString('zh-CN')),
          ]);
        }
        fs.writeFileSync(filePath, '\ufeff' + rows.map((r) => r.join(',')).join('\r\n'), 'utf8');
      } else {
        fs.writeFileSync(filePath, JSON.stringify(memos, null, 2), 'utf8');
      }
      return { ok: true, filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 导入备份(JSON):merge 合并去重 / replace 替换
  ipcMain.handle('data:import', async (_e, mode) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: mode === 'replace' ? '替换导入(将覆盖当前全部备忘)' : '合并导入(重复跳过,新增追加)',
      properties: ['openFile'],
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    });
    if (canceled || !filePaths || !filePaths.length) return { ok: false, canceled: true };
    try {
      const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
      const r = store.importData(raw, mode === 'replace' ? 'replace' : 'merge');
      if (r.error) return { ok: false, error: r.error };
      return { ok: true, ...r };
    } catch (e) {
      return { ok: false, error: '文件解析失败:' + e.message };
    }
  });

  // ---------- WebDAV 云端同步 ----------
  function wdCfg(cfg) {
    const s = store.getSettings();
    const saved = s.webdav || {};
    return { url: (cfg && cfg.url) || saved.url || '', user: (cfg && cfg.user) || saved.user || '', pass: (cfg && cfg.pass) || saved.pass || '' };
  }
  ipcMain.handle('webdav:test', async (_e, cfg) => {
    const c = wdCfg(cfg);
    if (!c.url) return { ok: false, error: '请先填写服务器地址' };
    return webdavTest(c.url, c.user, c.pass);
  });
  ipcMain.handle('webdav:upload', async (_e, cfg) => {
    const c = wdCfg(cfg);
    if (!c.url) return { ok: false, error: '请先填写服务器地址' };
    try {
      const s = store.getSettings();
      const payload = JSON.stringify({
        memos: store.listMemos(),
        settings: s,
        nextId: store.data.nextId,
        history: store.getHistory(100),
      }, null, 2);
      const r = await webdavPut(c.url, c.user, c.pass, payload);
      store.setSettings({ webdav: { url: c.url, user: c.user, pass: c.pass } });
      return { ok: true, target: r.target };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('webdav:download', async (_e, cfg) => {
    const c = wdCfg(cfg);
    if (!c.url) return { ok: false, error: '请先填写服务器地址' };
    try {
      const r = await webdavGet(c.url, c.user, c.pass);
      const parsed = JSON.parse(r.data);
      store.backup(); // 下载前自动备份本地
      const imp = store.importData(parsed, 'replace');
      if (imp.error) return { ok: false, error: imp.error };
      store.setSettings({ webdav: { url: c.url, user: c.user, pass: c.pass } });
      return { ok: true, added: imp.added };
    } catch (e) {
      return { ok: false, error: '下载失败:' + e.message };
    }
  });
}

// ---------- 生命周期 ----------
app.setAppUserModelId(APP_ID);

app.whenReady().then(() => {
  ensureIcons();
  store = new Store(path.join(dataDir(), 'data.json'));
  store.backup(); // 启动自动备份(保留 7 份)
  const purged = store.cleanupTrash(); // 回收站超期(30 天)自动清理
  if (purged > 0) console.log(`[main] 已自动清理 ${purged} 条超期回收站备忘`);

  // remindme-img:// 协议:加载 attachments 目录下的附件图片
  protocol.handle('remindme-img', (req) => {
    try {
      // 兼容两种 URL 形式:remindme-img:<name> 与 remindme-img://<name>
      const u = new URL(req.url);
      let raw = u.pathname.replace(/^\//, '') || req.url.replace(/^remindme-img:\/?\/?/, '');
      const name = decodeURIComponent(raw);
      const safe = path.basename(name); // 防路径穿越
      const file = path.join(attachmentsDir(), safe);
      if (!fs.existsSync(file)) return new Response('', { status: 404 });
      return net.fetch(require('url').pathToFileURL(file).toString());
    } catch (e) {
      console.error('[main] 附件加载失败:', e.message);
      return new Response('', { status: 500 });
    }
  });

  registerIpc();
  createWindow();
  createTray();
  startReminderScan();
  applyAutoLaunch(store.getSettings().autoLaunch);

  globalShortcut.register('Control+Shift+M', () => quickAdd());

  app.on('activate', () => showWindow());
});

app.on('will-quit', () => {
  if (scanTimer) clearInterval(scanTimer);
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // 关闭窗口即退出应用(用户要求:不再驻留托盘)
  app.quit();
});

// ---------- 冒烟测试钩子(REMINDME_SMOKE=1 时自动验证后退出) ----------
if (process.env.REMINDME_SMOKE === '1') {
  app.whenReady().then(() => {
    setTimeout(async () => {
      try {
        // 模拟真实用户交互:填写快速添加框并点击,验证渲染
        const info = await win.webContents.executeJavaScript(`(async () => {
          const pad = (n) => String(n).padStart(2, '0');
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const d = new Date();
          const today = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T23:59';
          const qa = document.querySelector('#qa-title');
          const add = async (title, time, repeat, prio) => {
            qa.value = title;
            document.querySelector('#qa-time').value = time;
            document.querySelector('#qa-repeat').value = repeat;
            document.querySelector('#qa-priority').value = String(prio);
            document.querySelector('#qa-add').click();
            await sleep(400);
          };
          await add('冒烟测试:今天事项', today, 'none', 0);
          await add('冒烟测试:每周周报', today, 'weekly', 0);
          await add('冒烟测试:过期事项', '2000-01-01T00:00', 'none', 2);
          return JSON.stringify({
            memoNodes: document.querySelectorAll('.memo').length,
            groups: [...document.querySelectorAll('.group-label')].map((g) => g.textContent.trim().split(' ')[0]),
            overdue: document.querySelectorAll('.memo.overdue').length,
            pinned: document.querySelectorAll('.flag.pinned').length,
            stat: document.querySelector('#stat-count').textContent,
            trashEmpty: !document.querySelector('#empty').classList.contains('hidden'),
            // 更新公告:点击按钮 → 弹窗可见且含版本条目 → 关闭生效
            changelog: (() => {
              document.querySelector('#btn-changelog').click();
              const open = !document.querySelector('#changelog-modal').classList.contains('hidden');
              const items = document.querySelectorAll('#changelog-body .cl-item').length;
              document.querySelector('#changelog-close').click();
              const closed = document.querySelector('#changelog-modal').classList.contains('hidden');
              return { open, items, closed };
            })(),
            // 数据统计:打开设置 → 统计值正确(3 条备忘:1 已完成?→ 待办 3 条未完成)
            stats: (() => {
              document.querySelector('#btn-settings').click();
              const s = {
                total: document.querySelector('#stat-total').textContent,
                todo: document.querySelector('#stat-todo').textContent,
                repeat: document.querySelector('#stat-repeat').textContent,
                trash: document.querySelector('#stat-trash').textContent,
              };
              document.querySelector('#modal-close').click();
              return s;
            })(),
            // 日历视图:切换 → 网格存在(≥28 格) + 今天高亮 + 点击选中日期
            calendar: (() => {
              document.querySelector('.view-btn[data-view="calendar"]').click();
              const cells = document.querySelectorAll('.cal-cell[data-day]').length;
              const today = document.querySelector('.cal-cell.today');
              const dows = document.querySelectorAll('.cal-dow').length;
              const cellH = today ? today.getBoundingClientRect().height : 0;
              const overflowX = document.documentElement.scrollWidth > window.innerWidth + 2;
              if (today) today.click();
              const sel = document.querySelectorAll('.cal-cell.sel').length;
              const dayList = document.querySelectorAll('.cal-memo-head').length;
              const head = document.querySelector('.cal-memo-head');
              const listVisible = head ? head.getBoundingClientRect().top < window.innerHeight : false;
              document.querySelector('.view-btn[data-view="all"]').click();
              return { cells, hasToday: !!today, dows, cellH: Math.round(cellH), overflowX, sel, dayList, listVisible };
            })(),
            // 搜索高亮:输入「冒烟」 → 标题中匹配部分包 .hl(3 条均含「冒烟」)
            search: (() => {
              document.querySelector('.view-btn[data-view="all"]').click();
              const s = document.querySelector('#search');
              s.value = '冒烟';
              s.dispatchEvent(new Event('input', { bubbles: true }));
              const highlights = document.querySelectorAll('.memo-title .hl').length;
              // Ctrl+F 聚焦搜索
              const focused = (() => {
                const ev = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true });
                document.dispatchEvent(ev);
                return document.activeElement === s;
              })();
              s.value = '';
              s.dispatchEvent(new Event('input', { bubbles: true }));
              return { highlights, ctrlF: focused };
            })(),
            // 主题色:切换强调色 → body[data-accent] 更新(同步执行,不依赖异步 IPC)
            accent: (() => {
              const before = document.body.dataset.accent;
              document.body.dataset.accent = 'violet';
              const applied = document.body.dataset.accent;
              document.body.dataset.accent = before || 'green';
              return applied;
            })(),
          });
        })()`);
        const parsed = JSON.parse(info);
        console.log('[smoke] window title:', win.getTitle());
        console.log('[smoke] memos:', parsed.memoNodes, '| groups:', parsed.groups.join('/'), '| overdue:', parsed.overdue);
        console.log('[smoke] stat:', parsed.stat, '| trashEmpty:', parsed.trashEmpty);
        console.log('[smoke] changelog: open=' + parsed.changelog.open, '| items=' + parsed.changelog.items, '| closed=' + parsed.changelog.closed);
        console.log('[smoke] stats: total=' + parsed.stats.total, '| todo=' + parsed.stats.todo, '| repeat=' + parsed.stats.repeat, '| trash=' + parsed.stats.trash);
        console.log('[smoke] calendar: cells=' + parsed.calendar.cells, '| today=' + parsed.calendar.hasToday, '| dows=' + parsed.calendar.dows, '| cellH=' + parsed.calendar.cellH, '| overflowX=' + parsed.calendar.overflowX, '| dayListVisible=' + parsed.calendar.listVisible);
        console.log('[smoke] search: highlights=' + parsed.search.highlights, '| ctrlF=' + parsed.search.ctrlF);
        console.log('[smoke] accent applied:', parsed.accent);
        const pass = parsed.memoNodes === 3 && parsed.overdue === 1 && parsed.stat.includes('3')
          && parsed.changelog.open && parsed.changelog.items >= 3 && parsed.changelog.closed
          && parsed.stats.total === '3' && parsed.stats.todo === '3' && parsed.stats.repeat === '1'
          && parsed.calendar.cells >= 28 && parsed.calendar.hasToday && parsed.calendar.dows === 7
          && parsed.calendar.cellH > 0 && parsed.calendar.cellH <= 60 && !parsed.calendar.overflowX
          && parsed.calendar.sel >= 1 && parsed.calendar.dayList === 1 && parsed.calendar.listVisible
          && parsed.search.highlights >= 3 && parsed.search.ctrlF
          && parsed.accent === 'violet';
        console.log(pass ? '[smoke] OK' : '[smoke] FAIL: 渲染结果不符合预期');
        app.exit(pass ? 0 : 1);
      } catch (e) {
        console.error('[smoke] FAIL:', e.message);
        app.exit(1);
      }
    }, 5000);
  });
}
