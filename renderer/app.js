/**
 * app.js — RemindMe 渲染层逻辑
 * 视图切换 · 分组渲染 · 快速添加 · 完成/删除/置顶/延后 · 右键菜单 · 设置 · 主题 · Toast
 */
'use strict';

const api = window.remindme;

const REPEAT_LABEL = { daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' };
const PRIORITY_LABEL = { 0: '普通', 1: '一般', 2: '重要' };
const DAY = 24 * 60 * 60 * 1000;

const state = {
  memos: [],
  settings: null,
  view: 'all',      // all | today | todo | calendar | done | trash
  search: '',
  ctxMemoId: null,
  pendingImages: [],  // 快速添加待保存的图片文件名
  lbMemoId: null,     // 大图查看所属备忘 id
  lbName: '',         // 大图当前文件名
  calYear: 0,         // 日历视图:显示年月
  calMonth: -1,       // 0-11
  calDate: '',        // 选中日期 'YYYY-MM-DD'
};

// 非 standard 自定义协议:URL 用 remindme-img:<文件名> 形式(避免 // 被解析为 host)
const IMG_URL = (name) => 'remindme-img:' + encodeURIComponent(name);

// ---------- 工具 ----------
const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');

function fmtTime(ms) {
  const d = new Date(ms);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const thatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (thatDay === today) return `今天 ${hm}`;
  if (thatDay === today + DAY) return `明天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function timeState(memo) {
  if (memo.done) return 'done';
  const now = Date.now();
  if (memo.due_at < now) return 'overdue';
  const d = new Date(memo.due_at);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  if (memo.due_at <= todayEnd.getTime()) return 'today';
  return 'future';
}

function isTodayMs(ms) {
  const d = new Date(ms);
  const now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

// ---------- 加载 ----------
async function load() {
  const [memos, settings] = await Promise.all([api.list(), api.getSettings()]);
  state.memos = memos;
  state.settings = settings;
  applyTheme(settings.theme);
  $('#set-theme').value = settings.theme;
  $('#set-autolaunch').checked = !!settings.autoLaunch;
  $('#set-advance').value = String(settings.defaultAdvance);
  $('#set-defaulttime').value = settings.defaultTime;
  $('#set-sound').value = settings.sound || 'clear';
  syncQuickAddDefaultTime();
  render();
}

// ---------- 数据统计 ----------
function updateStats() {
  const memos = state.memos;
  if (!memos || !memos.length) {
    ['stat-total', 'stat-todo', 'stat-today', 'stat-overdue', 'stat-donetoday', 'stat-repeat', 'stat-trash']
      .forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = '0'; });
    return;
  }
  const now = Date.now();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);
  const active = memos.filter((m) => !m.deleted);
  const todo = active.filter((m) => !m.done);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
  set('stat-total', active.length);
  set('stat-todo', todo.length);
  set('stat-today', todo.filter((m) => m.due_at >= dayStart.getTime() && m.due_at <= dayEnd.getTime()).length);
  set('stat-overdue', todo.filter((m) => m.due_at < now).length);
  set('stat-donetoday', active.filter((m) => m.done && m.done_at >= dayStart.getTime() && m.done_at <= dayEnd.getTime()).length);
  set('stat-repeat', active.filter((m) => m.repeat_type && m.repeat_type !== 'none').length);
  set('stat-trash', memos.filter((m) => m.deleted).length);
}

// ---------- 日历视图 ----------
function dateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function memosOfDay(dateKeyStr) {
  return state.memos.filter((m) => !m.deleted && dateKey(m.due_at) === dateKeyStr);
}

function fmtDayTitle(key) {
  const d = new Date(key + 'T00:00:00');
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${week}`;
}

function renderCalendar() {
  const el = $('#list');
  const empty = $('#empty');
  empty.classList.add('hidden');
  $('#list-actions').classList.add('hidden');

  const now = new Date();
  const todayKey = dateKey(now.getTime());
  // 首次进入:定位到当前月/今天
  if (state.calMonth === -1) state.calMonth = now.getMonth();
  if (!state.calYear) state.calYear = now.getFullYear();
  if (!state.calDate) state.calDate = todayKey;
  const y = state.calYear, m = state.calMonth;

  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  // 每天备忘数 + 过期标记(未完成)
  const counts = {};
  const overdueDays = new Set();
  const nowMs = Date.now();
  for (const memo of state.memos) {
    if (memo.deleted || memo.done) continue;
    const k = dateKey(memo.due_at);
    counts[k] = (counts[k] || 0) + 1;
    if (memo.due_at < nowMs) overdueDays.add(k);
  }

  let html = `
    <div class="cal-bar">
      <button class="cal-nav" id="cal-prev" title="上月">◀</button>
      <span class="cal-title">${y} 年 ${m + 1} 月</span>
      <button class="cal-nav" id="cal-next" title="下月">▶</button>
      <button class="cal-today-btn" id="cal-today">今天</button>
    </div>
    <div class="cal-grid">
      ${['日', '一', '二', '三', '四', '五', '六'].map((w) => `<div class="cal-dow">${w}</div>`).join('')}`;
  for (let i = 0; i < startDow; i++) html += '<div class="cal-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${pad(m + 1)}-${pad(d)}`;
    const cls = ['cal-cell'];
    if (key === todayKey) cls.push('today');
    if (key === state.calDate) cls.push('sel');
    if (overdueDays.has(key) && key !== todayKey) cls.push('has-overdue');
    if (counts[key]) cls.push('has');
    html += `<div class="${cls.join(' ')}" data-day="${key}">
      <span class="cal-day-n">${d}</span>
      ${counts[key] ? `<span class="cal-badge">${counts[key]}</span>` : ''}
    </div>`;
  }
  html += '</div>';

  // 选中日期备忘列表
  const dayMemos = memosOfDay(state.calDate);
  html += `<div class="cal-memo-head">📌 ${fmtDayTitle(state.calDate)} · ${dayMemos.length} 条备忘</div>`;
  html += dayMemos.map(memoHtml).join('') || '<div class="cal-empty">当天没有备忘,在上方记一条吧</div>';

  el.innerHTML = html;
  $('#stat-count').textContent = `${state.memos.filter((m) => !m.deleted && !m.done).length} 条待办`;

  bindCalendarEvents(el);
  bindMemoEvents(el); // 复用备忘操作(完成/删除/置顶/右键)
}

function bindCalendarEvents(container) {
  const prev = container.querySelector('#cal-prev');
  const next = container.querySelector('#cal-next');
  const todayBtn = container.querySelector('#cal-today');
  if (prev) prev.addEventListener('click', () => { state.calMonth--; if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; } render(); });
  if (next) next.addEventListener('click', () => { state.calMonth++; if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; } render(); });
  if (todayBtn) todayBtn.addEventListener('click', () => {
    const n = new Date();
    state.calYear = n.getFullYear();
    state.calMonth = n.getMonth();
    state.calDate = dateKey(n.getTime());
    render();
  });
  container.querySelectorAll('.cal-cell[data-day]').forEach((cell) => {
    cell.addEventListener('click', () => {
      state.calDate = cell.dataset.day;
      render();
    });
  });
}

// ---------- 渲染 ----------
function visibleMemos() {
  let list = state.memos.slice();
  const q = state.search.trim().toLowerCase();
  if (q) list = list.filter((m) => m.title.toLowerCase().includes(q));

  switch (state.view) {
    case 'trash':
      list = list.filter((m) => m.deleted);
      return list.sort((a, b) => (b.deleted_at || 0) - (a.deleted_at || 0));
    case 'done':
      list = list.filter((m) => !m.deleted && m.done);
      return list.sort((a, b) => (b.done_at || 0) - (a.done_at || 0));
    case 'today':
      list = list.filter((m) => !m.deleted && !m.done && (timeState(m) === 'overdue' || timeState(m) === 'today'));
      break;
    case 'todo':
      list = list.filter((m) => !m.deleted && !m.done);
      break;
    default:
      list = list.filter((m) => !m.deleted);
  }

  return list.sort(compareMemo);
}

function compareMemo(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.due_at - b.due_at;
}

function groupMemos(list) {
  if (state.view === 'trash' || state.view === 'done') {
    return [{ label: state.view === 'trash' ? '🗑 回收站' : '✅ 已完成', items: list }];
  }
  const groups = [];
  const pinned = list.filter((m) => m.pinned);
  const rest = list.filter((m) => !m.pinned);
  if (pinned.length) groups.push({ label: '📌 置顶', items: pinned });
  const overdue = rest.filter((m) => timeState(m) === 'overdue');
  if (overdue.length) groups.push({ label: '⏰ 已过期', items: overdue });
  const today = rest.filter((m) => timeState(m) === 'today');
  if (today.length) groups.push({ label: '🗓 今天', items: today });
  const future = rest.filter((m) => timeState(m) === 'future');
  if (future.length) groups.push({ label: '📅 待办', items: future });
  // 已完成:timeState 返回 'done',需单独分组,避免在「全部」视图中被丢弃
  const doneItems = rest.filter((m) => timeState(m) === 'done');
  if (doneItems.length) groups.push({ label: '✅ 已完成', items: doneItems });
  return groups;
}

function render() {
  if (state.view === 'calendar') { renderCalendar(); return; }
  const list = visibleMemos();
  const groups = groupMemos(list);
  const el = $('#list');
  const empty = $('#empty');

  if (!list.length) {
    el.innerHTML = '';
    empty.classList.remove('hidden');
    $('#list-actions').classList.add('hidden');
    updateStats();
    empty.querySelector('.empty-title').textContent =
      state.view === 'trash' ? '回收站是空的' :
      state.view === 'done' ? '还没有完成的备忘' : '还没有备忘';
    empty.querySelector('.empty-sub').textContent =
      state.view === 'trash' ? '删除的备忘会在这里保留 30 天' : '在上方输入框记下第一件怕忘的事吧';
    $('#stat-count').textContent = `${state.memos.filter((m) => !m.deleted && !m.done).length} 条待办`;
    return;
  }
  empty.classList.add('hidden');
  updateStats();

  // 操作条:仅「已完成 / 回收站」视图显示对应按钮
  const actions = $('#list-actions');
  actions.classList.toggle('hidden', state.view !== 'done' && state.view !== 'trash');
  $('#btn-clear-done').style.display = state.view === 'done' ? '' : 'none';
  $('#btn-clear-trash').style.display = state.view === 'trash' ? '' : 'none';

  el.innerHTML = groups.map((g) => `
    <div class="group-label">${g.label} <span style="letter-spacing:0;opacity:.7">· ${g.items.length}</span></div>
    ${g.items.map(memoHtml).join('')}
  `).join('');

  $('#stat-count').textContent = `${state.memos.filter((m) => !m.deleted && !m.done).length} 条待办`;
  bindMemoEvents(el);
}

function memoHtml(m) {
  const ts = timeState(m);
  const overdue = ts === 'overdue';
  const done = m.done;
  const repeatFlag = m.repeat_type && m.repeat_type !== 'none'
    ? `<span class="flag repeat">🔁 ${REPEAT_LABEL[m.repeat_type]}</span>` : '';
  const pinFlag = m.pinned && !m.deleted
    ? '<span class="flag pinned">📌 置顶</span>' : '';
  const advFlag = m.advance_minutes > 0 && !m.deleted && !m.done
    ? `<span class="flag adv">提前 ${m.advance_minutes} 分</span>` : '';

  const timeCls = done ? '' : overdue ? 'overdue' : ts === 'today' ? 'today' : '';
  const timeText = m.deleted
    ? `删除于 ${fmtTime(m.deleted_at)}`
    : `${done ? '完成于 ' : ''}${fmtTime(m.due_at)}`;

  const ops = m.deleted
    ? `
      <button class="op restore" data-act="restore" title="恢复">↩️</button>
      <button class="op del" data-act="hard-delete" title="永久删除">🗑</button>`
    : `
      <button class="op pin ${m.pinned ? 'on' : ''}" data-act="pin" title="置顶">📌</button>
      <button class="op del" data-act="del" title="删除">🗑</button>`;

  const thumbs = m.images && m.images.length ? `
    <div class="memo-thumbs">
      ${m.images.slice(0, 3).map((n) => `
        <img class="thumb" src="${IMG_URL(n)}" data-img="${escAttr(n)}" alt="" loading="lazy">`).join('')}
      ${m.images.length > 3 ? `<span class="thumb-more" title="${escAttr(m.images.length)} 张图片">+${m.images.length - 3}</span>` : ''}
    </div>` : '';

  return `
  <div class="memo ${done ? 'done-item' : ''} ${overdue ? 'overdue' : ''} prio-${m.priority}" data-id="${m.id}">
    <span class="prio-dot p${m.priority}"></span>
    ${m.deleted ? '' : `<span class="check ${done ? 'checked' : ''}" data-act="check" title="${done ? '取消完成' : '完成'}">${done ? '✓' : ''}</span>`}
    <div class="memo-main">
      <span class="memo-title ${done ? 'done' : ''}" title="${escAttr(m.title)}">${esc(m.title)}</span>
      ${thumbs}
    </div>
    <span class="memo-flags">${pinFlag}${repeatFlag}${advFlag}</span>
    <span class="memo-time ${timeCls}">${timeText}</span>
    <span class="memo-ops">${ops}</span>
  </div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const escAttr = esc;

function bindMemoEvents(container) {
  container.querySelectorAll('[data-act]').forEach((node) => {
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      const memoEl = node.closest('.memo');
      const id = Number(memoEl.dataset.id);
      const act = node.dataset.act;
      handleAct(act, id, node);
    });
  });
  container.querySelectorAll('.memo').forEach((el) => {
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const id = Number(el.dataset.id);
      state.ctxMemoId = id;
      showCtxMenu(e.clientX, e.clientY, id);
    });
    el.addEventListener('dblclick', (e) => {
      // 避免双击按钮触发
      if (e.target.closest('[data-act]')) return;
      openEdit(Number(el.dataset.id));
    });
  });
  container.querySelectorAll('.thumb').forEach((img) => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(Number(img.closest('.memo').dataset.id), img.dataset.img);
    });
  });
}

async function handleAct(act, id, node) {
  switch (act) {
    case 'check': await api.toggleDone(id); toast('备忘状态已更新'); break;
    case 'pin': await api.togglePin(id); break;
    case 'del': await api.softDelete(id); toast('已移入回收站'); break;
    case 'restore': await api.restore(id); toast('已恢复'); break;
    case 'hard-delete': await api.hardDelete(id); toast('已永久删除'); break;
  }
  await load();
}

// ---------- 编辑备忘 ----------
const state_edit = { id: null };

function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openEdit(id) {
  const m = state.memos.find((mm) => mm.id === id);
  if (!m || m.deleted) return;
  state_edit.id = id;
  $('#edit-title').value = m.title;
  $('#edit-time').value = toLocalInput(new Date(m.due_at));
  $('#edit-repeat').value = m.repeat_type || 'none';
  $('#edit-priority').value = String(m.priority || 0);
  $('#edit-advance').value = String(m.advance_minutes || 0);
  $('#edit-pinned').checked = !!m.pinned;
  $('#edit-modal').classList.remove('hidden');
  setTimeout(() => $('#edit-title').focus(), 50);
}

function closeEdit() {
  $('#edit-modal').classList.add('hidden');
  state_edit.id = null;
}

async function saveEdit() {
  if (!state_edit.id) return;
  const title = $('#edit-title').value.trim();
  if (!title) { toast('标题不能为空'); $('#edit-title').focus(); return; }
  const timeVal = $('#edit-time').value;
  if (!timeVal) { toast('请选择时间'); $('#edit-time').focus(); return; }
  const patch = {
    title,
    due_at: new Date(timeVal).getTime(),
    repeat_type: $('#edit-repeat').value,
    priority: Number($('#edit-priority').value),
    advance_minutes: Number($('#edit-advance').value),
    pinned: $('#edit-pinned').checked,
  };
  await api.update(state_edit.id, patch);
  closeEdit();
  toast('备忘已更新');
  await load();
}

// ---------- 快速添加 ----------
function autoImageTitle() {
  const d = new Date();
  return `图片备忘 ${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 默认到期时间:时间框有值用之,否则按设置默认时间 today */
function defaultDueAt() {
  const timeVal = $('#qa-time').value;
  if (timeVal) return new Date(timeVal).getTime();
  const [h, m] = (state.settings.defaultTime || '18:00').split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function syncQuickAddDefaultTime() {
  const t = state.settings ? state.settings.defaultTime : '18:00';
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  $('#qa-time').value = toLocalInput(d);
}

function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function quickAdd() {
  const title = $('#qa-title').value.trim();
  // 允许「只选图片不输文字」直接创建:标题自动生成
  if (!title && !state.pendingImages.length) { $('#qa-title').focus(); return; }
  const finalTitle = title || autoImageTitle();
  const due_at = defaultDueAt();

  const memo = await api.add({
    title: finalTitle,
    due_at,
    repeat_type: $('#qa-repeat').value,
    priority: Number($('#qa-priority').value),
    pinned: $('#qa-pin').classList.contains('on'),
    advance_minutes: Number(state.settings.defaultAdvance || 0),
    images: state.pendingImages.slice(),
  });

  $('#qa-title').value = '';
  $('#qa-pin').classList.remove('on');
  state.pendingImages = [];
  renderQaPreviews();
  const repeated = memo.repeat_type && memo.repeat_type !== 'none';
  toast(`已记下「${memo.title}」${repeated ? ' · 周期重复' : ''}`);
  await load();
  $('#qa-title').focus();
}

// ---------- 图片:快速添加 ----------
async function pickImages() {
  const r = await api.pickImages();
  if (!r || !r.ok || !r.images.length) return;
  state.pendingImages = [...state.pendingImages, ...r.images];
  renderQaPreviews();
  toast(`已选 ${r.images.length} 张图片,随备忘一起保存`);
}

function renderQaPreviews() {
  const box = $('#qa-previews');
  $('#qa-title').placeholder = state.pendingImages.length
    ? `已选 ${state.pendingImages.length} 张图片,可直接点「＋ 记下」`
    : '记下怕忘的事… (回车即存)';
  if (!state.pendingImages.length) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = state.pendingImages.map((n) => `
    <div class="qa-pv">
      <img src="${IMG_URL(n)}" alt="">
      <button class="qa-pv-del" data-name="${escAttr(n)}" title="移除">✕</button>
    </div>`).join('');
  box.querySelectorAll('.qa-pv-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.pendingImages = state.pendingImages.filter((n) => n !== btn.dataset.name);
      renderQaPreviews();
    });
  });
}

// ---------- 图片:大图查看 ----------
function openLightbox(memoId, name) {  state.lbMemoId = memoId;
  state.lbName = name;
  const img = $('#lb-img');
  img.src = IMG_URL(name);
  img.onerror = () => { toast('图片加载失败(文件可能已丢失)'); };
  $('#lightbox').classList.remove('hidden');
}

function closeLightbox() {
  $('#lightbox').classList.add('hidden');
  $('#lb-img').src = '';
}

async function deleteLightboxImage() {
  if (!state.lbMemoId || !state.lbName) return;
  await api.removeImage(state.lbMemoId, state.lbName);
  closeLightbox();
  toast('图片已删除');
  await load();
}

// ---------- 图片:复制粘贴 / 拖拽 直接创建备忘 ----------
/** 用图片文件(buffer)立即创建一条带图备忘(自动标题) */
async function createFromImageFile(file, source) {
  try {
    const buf = await file.arrayBuffer();
    if (!buf || !buf.byteLength) { toast('图片数据为空'); return; }
    const r = await api.saveImageBuffer(buf, file.type || 'image/png');
    if (!r || !r.ok) { toast('图片保存失败'); return; }
    const memo = await api.add({
      title: autoImageTitle(),
      due_at: defaultDueAt(),
      repeat_type: 'none',
      priority: 0,
      pinned: false,
      advance_minutes: Number(state.settings.defaultAdvance || 0),
      images: [r.name],
    });
    const via = source === 'paste' ? '粘贴' : '拖拽';
    toast(`已通过${via}创建备忘「${memo.title}」`);
    await load();
  } catch (e) {
    console.error('[renderer] 创建图片备忘失败:', e);
    toast('创建失败:' + (e.message || '未知错误'));
  }
}

function handleImagePaste(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return false;
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        createFromImageFile(file, 'paste');
        return true;
      }
    }
  }
  return false;
}

function handleImageDrop(e) {
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return false;
  let handled = false;
  for (const f of files) {
    if (f.type.startsWith('image/')) {
      createFromImageFile(f, 'drop');
      handled = true;
    }
  }
  return handled;
}

function showDropOverlay(show) {
  $('#drop-overlay').classList.toggle('hidden', !show);
}

// ---------- 右键菜单 ----------
function showCtxMenu(x, y, id) {
  const m = state.memos.find((mm) => mm.id === id);
  if (!m) return;
  const menu = $('#ctx-menu');
  let html = '';
  if (!m.deleted) {
    html += `
      <div class="ctx-item" data-cmd="pin">${m.pinned ? '取消置顶' : '置顶'} <span class="k">📌</span></div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" data-cmd="prio0">优先级:普通</div>
      <div class="ctx-item" data-cmd="prio1">优先级:一般</div>
      <div class="ctx-item" data-cmd="prio2">优先级:重要</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" data-cmd="edit">编辑 <span class="k">✏️</span></div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" data-cmd="img">添加图片 <span class="k">🖼</span></div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" data-cmd="snooze5">延后 5 分钟</div>
      <div class="ctx-item" data-cmd="snooze15">延后 15 分钟</div>
      <div class="ctx-item" data-cmd="snooze60">延后 60 分钟</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item danger" data-cmd="del">删除 <span class="k">🗑</span></div>`;
  } else {
    html += `
      <div class="ctx-item" data-cmd="restore">恢复 <span class="k">↩️</span></div>
      <div class="ctx-item danger" data-cmd="harddelete">永久删除 <span class="k">🗑</span></div>`;
  }
  menu.innerHTML = html;
  menu.classList.add('show');
  menu.style.left = Math.min(x, window.innerWidth - 190) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - 260) + 'px';

  menu.querySelectorAll('.ctx-item').forEach((item) => {
    item.addEventListener('click', () => ctxCommand(item.dataset.cmd, id));
  });
}

async function ctxCommand(cmd, id) {
  hideCtxMenu();
  switch (cmd) {
    case 'pin': await api.togglePin(id); break;
    case 'edit': openEdit(id); return;
    case 'prio0': case 'prio1': case 'prio2':
      await api.setPriority(id, Number(cmd.slice(4))); break;
    case 'snooze5': await api.snooze(id, 5); toast('已延后 5 分钟'); break;
    case 'snooze15': await api.snooze(id, 15); toast('已延后 15 分钟'); break;
    case 'snooze60': await api.snooze(id, 60); toast('已延后 60 分钟'); break;
    case 'img': {
      const r = await api.pickImages();
      if (r && r.ok && r.images.length) {
        await api.addImages(id, r.images);
        toast(`已添加 ${r.images.length} 张图片`);
      }
      break;
    }
    case 'del': await api.softDelete(id); toast('已移入回收站'); break;
    case 'restore': await api.restore(id); toast('已恢复'); break;
    case 'harddelete': await api.hardDelete(id); toast('已永久删除'); break;
  }
  await load();
}

function hideCtxMenu() { $('#ctx-menu').classList.remove('show'); }

// ---------- 提醒音播放 ----------
const soundPlayers = {};
function playReminderSound(name) {
  if (!name || name === 'none') return;
  const url = window.remindmeSounds && window.remindmeSounds[name];
  if (!url) return;
  if (!soundPlayers[name]) {
    const a = new Audio(url);
    a.volume = 0.7;
    soundPlayers[name] = a;
  }
  const a = soundPlayers[name];
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p) p.catch(() => {});
  } catch (e) { /* 播放失败忽略 */ }
}

// ---------- 更新公告 ----------
function openChangelog() {
  const list = (window.REMINDME_CHANGELOG || []).map((v) => `
    <div class="cl-item">
      <div class="cl-head">
        <span class="cl-ver">v${v.version}</span>
        <span class="cl-date">${v.date}</span>
      </div>
      <ul class="cl-list">
        ${v.changes.map((c) => `<li>${esc(c)}</li>`).join('')}
      </ul>
    </div>`).join('');
  $('#changelog-body').innerHTML = list || '<div class="muted" style="text-align:center">暂无更新记录</div>';
  $('#changelog-modal').classList.remove('hidden');
}

function closeChangelog() { $('#changelog-modal').classList.add('hidden'); }

// ---------- 设置 ----------
function openSettings() { $('#settings-modal').classList.remove('hidden'); }
function closeSettings() { $('#settings-modal').classList.add('hidden'); }

async function applyTheme(theme) {
  if (theme === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.body.dataset.theme = theme;
}

// ---------- Toast ----------
function toast(text, sub) {
  const box = $('#toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="t-title">${esc(text)}</div>${sub ? `<div class="t-body">${esc(sub)}</div>` : ''}`;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 2600);
}

// ---------- 事件绑定 ----------
function bindEvents() {
  // 视图切换
  $('#views').addEventListener('click', (e) => {
    const btn = e.target.closest('.view-btn');
    if (!btn) return;
    state.view = btn.dataset.view;
    document.querySelectorAll('.view-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  });

  // 搜索
  $('#search').addEventListener('input', (e) => {
    state.search = e.target.value;
    render();
  });

  // 快速添加
  $('#qa-add').addEventListener('click', quickAdd);
  $('#qa-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') quickAdd();
  });
  $('#qa-pin').addEventListener('click', () => $('#qa-pin').classList.toggle('on'));
  $('#qa-img').addEventListener('click', pickImages);

  // 大图查看
  $('#lb-close').addEventListener('click', closeLightbox);
  $('#lb-delete').addEventListener('click', deleteLightboxImage);
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeLightbox();
  });

  // 编辑备忘
  $('#edit-close').addEventListener('click', closeEdit);
  $('#edit-cancel').addEventListener('click', closeEdit);
  $('#edit-save').addEventListener('click', saveEdit);
  $('#edit-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEdit();
  });
  $('#edit-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
  });

  // 批量操作(清空已完成 / 清空回收站)
  $('#btn-clear-done').addEventListener('click', async () => {
    if (!window.confirm('确定清空所有「已完成」备忘吗?此操作不可撤销。')) return;
    const n = await api.clearDone();
    toast(`已清空 ${n} 条已完成备忘`);
    await load();
  });
  $('#btn-clear-trash').addEventListener('click', async () => {
    if (!window.confirm('确定永久清空回收站吗?此操作不可撤销。')) return;
    const n = await api.clearTrash();
    toast(`已清空回收站 ${n} 条`);
    await load();
  });

  // 顶栏
  $('#btn-theme').addEventListener('click', async () => {
    const cur = document.body.dataset.theme;
    const next = cur === 'dark' ? 'light' : 'dark';
    state.settings = await api.setSettings({ theme: next });
    $('#set-theme').value = next;
    applyTheme(next);
  });
  $('#btn-settings').addEventListener('click', openSettings);

  // 更新公告
  $('#btn-changelog').addEventListener('click', openChangelog);
  $('#changelog-close').addEventListener('click', closeChangelog);
  $('#changelog-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeChangelog();
  });

  // 设置面板
  $('#modal-close').addEventListener('click', closeSettings);
  $('#settings-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });
  $('#set-theme').addEventListener('change', async (e) => {
    state.settings = await api.setSettings({ theme: e.target.value });
    applyTheme(e.target.value);
  });
  $('#set-autolaunch').addEventListener('change', async (e) => {
    state.settings = await api.setSettings({ autoLaunch: e.target.checked });
  });
  $('#set-advance').addEventListener('change', async (e) => {
    state.settings = await api.setSettings({ defaultAdvance: Number(e.target.value) });
  });
  $('#set-defaulttime').addEventListener('change', async (e) => {
    state.settings = await api.setSettings({ defaultTime: e.target.value });
    syncQuickAddDefaultTime();
  });
  // 提醒音:切换时试播
  $('#set-sound').addEventListener('change', async (e) => {
    state.settings = await api.setSettings({ sound: e.target.value });
    playReminderSound(e.target.value);
    toast('提醒音已更新');
  });
  $('#export-json').addEventListener('click', () => api.exportData('json').then((r) => {
    if (r && r.ok) toast('导出成功', r.filePath);
  }));
  $('#export-csv').addEventListener('click', () => api.exportData('csv').then((r) => {
    if (r && r.ok) toast('导出成功', r.filePath);
  }));

  // 全局:隐藏右键菜单
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ctx-menu')) hideCtxMenu();
  });
  window.addEventListener('blur', hideCtxMenu);

  // 粘贴图片 → 直接创建备忘(Ctrl+V)
  document.addEventListener('paste', (e) => {
    if (handleImagePaste(e)) {
      // 已处理图片粘贴
    }
  });

  // 拖拽图片 → 直接创建备忘
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    const hasImg = e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    if (hasImg) showDropOverlay(true);
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) showDropOverlay(false);
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    showDropOverlay(false);
    handleImageDrop(e);
  });

  // 主进程事件
  api.onFocusQuickAdd(() => {
    $('#qa-title').focus();
    $('#qa-title').select();
  });
  api.onDataChanged(() => load());
  api.onPlayReminderSound((name) => playReminderSound(name));
  api.onFocusMemo((id) => {
    const m = state.memos.find((mm) => mm.id === id);
    if (m && m.deleted) {
      state.view = 'trash';
      document.querySelectorAll('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === 'trash'));
    }
    render();
  });

  // 快捷键(渲染层):Ctrl+N 聚焦输入
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      $('#qa-title').focus();
    }
  });
}

// ---------- 启动 ----------
(async function init() {
  bindEvents();
  await load();
})();
