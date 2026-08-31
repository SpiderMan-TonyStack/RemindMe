/**
 * store.js — 数据存储层(JSON 文件,零原生依赖)+ 提醒调度引擎
 * 数据结构:
 *   memos: { id, title, due_at, repeat_type, advance_minutes, priority,
 *            pinned, done, done_at, deleted, deleted_at, snoozed_until,
 *            images, adv_sent, due_sent, created_at }
 *   settings: { theme, autoLaunch, defaultAdvance, defaultTime }
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPEAT_DAILY = 'daily';
const REPEAT_WEEKLY = 'weekly';
const REPEAT_MONTHLY = 'monthly';
const REPEAT_YEARLY = 'yearly';
const REPEAT_NONE = 'none';

const DEFAULT_SETTINGS = {
  theme: 'dark',          // dark | light | system
  autoLaunch: true,       // 开机自启
  defaultAdvance: 0,      // 默认提前提醒(分钟),0 表示不提前
  defaultTime: '18:00',   // 快速添加默认时间
  sound: 'clear',         // 提醒音:none(无声) | clear(清脆) | gentle(柔和)
};

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { memos: [], settings: { ...DEFAULT_SETTINGS }, nextId: 1 };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (raw && Array.isArray(raw.memos)) {
          this.data = raw;
          this.data.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
          // 旧数据兜底:早期版本 memo 无 images 字段
          for (const m of this.data.memos) {
            if (!Array.isArray(m.images)) m.images = [];
          }
          if (!this.data.nextId) {
            this.data.nextId = raw.memos.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
          }
        }
      }
    } catch (e) {
      console.error('[store] 读取数据失败,使用空数据:', e.message);
      this.data = { memos: [], settings: { ...DEFAULT_SETTINGS }, nextId: 1 };
    }
  }

  save() {
    try {
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
    } catch (e) {
      console.error('[store] 保存失败:', e.message);
    }
  }

  /** 备份当前数据到 backups/ 目录(每次启动一次,保留最近 7 份) */
  backup() {
    try {
      const dir = path.join(path.dirname(this.filePath), 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const file = path.join(dir, `backup-${stamp}.json`);
      fs.writeFileSync(file, JSON.stringify(this.data, null, 2), 'utf8');
      const files = fs.readdirSync(dir)
        .filter((f) => f.startsWith('backup-'))
        .sort()
        .reverse();
      for (const f of files.slice(7)) fs.unlinkSync(path.join(dir, f));
      return file;
    } catch (e) {
      console.error('[store] 备份失败:', e.message);
      return null;
    }
  }

  // ---------- Memos ----------
  listMemos() {
    return this.data.memos;
  }

  getMemo(id) {
    return this.data.memos.find((m) => m.id === id);
  }

  addMemo({ title, due_at, repeat_type = REPEAT_NONE, advance_minutes = 0, priority = 0, pinned = false, images }) {
    const now = Date.now();
    const memo = {
      id: this.data.nextId++,
      title: String(title || '').trim(),
      due_at: Number(due_at) || now + 3600_000,
      repeat_type,
      advance_minutes: Number(advance_minutes) || 0,
      priority: Math.min(2, Math.max(0, Number(priority) || 0)),
      pinned: !!pinned,
      done: false,
      done_at: null,
      deleted: false,
      deleted_at: null,
      snoozed_until: null,
      images: Array.isArray(images) ? images : [],
      adv_sent: false,
      due_sent: false,
      created_at: now,
    };
    this.data.memos.push(memo);
    this.save();
    return memo;
  }

  toggleDone(id) {
    const m = this.getMemo(id);
    if (!m || m.deleted) return null;
    if (m.done) {
      // 取消完成:恢复
      m.done = false;
      m.done_at = null;
      m.due_sent = false;
      m.adv_sent = false;
      m.snoozed_until = null;
    } else {
      m.done = true;
      m.done_at = Date.now();
      // 周期重复:完成后自动生成下一条
      if (m.repeat_type && m.repeat_type !== REPEAT_NONE) {
        const next = nextDueAt(m.due_at, m.repeat_type);
        m.due_at = next;
        m.done = false;
        m.done_at = null;
        m.due_sent = false;
        m.adv_sent = false;
        m.snoozed_until = null;
        this.save();
        return { ...m, repeated: true };
      }
    }
    this.save();
    return { ...m };
  }

  togglePin(id) {
    const m = this.getMemo(id);
    if (!m) return null;
    m.pinned = !m.pinned;
    this.save();
    return { ...m };
  }

  setPriority(id, priority) {
    const m = this.getMemo(id);
    if (!m) return null;
    m.priority = Math.min(2, Math.max(0, Number(priority) || 0));
    this.save();
    return { ...m };
  }

  /** 延后提醒:到点后把本次提醒推到 now+minutes,下次扫描再触发 */
  snooze(id, minutes) {
    const m = this.getMemo(id);
    if (!m) return null;
    m.snoozed_until = Date.now() + Number(minutes) * 60_000;
    m.due_sent = false;
    m.adv_sent = false;
    this.save();
    return { ...m };
  }

  softDelete(id) {
    const m = this.getMemo(id);
    if (!m) return null;
    m.deleted = true;
    m.deleted_at = Date.now();
    this.save();
    return { ...m };
  }

  restore(id) {
    const m = this.getMemo(id);
    if (!m) return null;
    m.deleted = false;
    m.deleted_at = null;
    this.save();
    return { ...m };
  }

  hardDelete(id) {
    const idx = this.data.memos.findIndex((m) => m.id === id);
    if (idx >= 0) {
      this.data.memos.splice(idx, 1);
      this.save();
      return true;
    }
    return false;
  }

  clearDone() {
    const before = this.data.memos.length;
    this.data.memos = this.data.memos.filter((m) => !(m.done && !m.deleted));
    this.save();
    return before - this.data.memos.length;
  }

  clearTrash() {
    const before = this.data.memos.length;
    this.data.memos = this.data.memos.filter((m) => !m.deleted);
    this.save();
    return before - this.data.memos.length;
  }

  /** 回收站超期自动清理:删除 deleted_at 超过 maxAgeMs(默认 30 天)的条目 */
  cleanupTrash(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    const before = this.data.memos.length;
    this.data.memos = this.data.memos.filter(
      (m) => !(m.deleted && m.deleted_at && m.deleted_at < cutoff)
    );
    if (before !== this.data.memos.length) this.save();
    return before - this.data.memos.length;
  }

  // ---------- 图片附件 ----------
  /** 为备忘追加图片文件名(去重),返回更新后的 memo */
  addImages(id, filenames) {
    const m = this.getMemo(id);
    if (!m) return null;
    const names = (Array.isArray(filenames) ? filenames : []).filter((n) => typeof n === 'string' && n);
    if (!names.length) return { ...m };
    m.images = [...new Set([...(m.images || []), ...names])];
    this.save();
    return { ...m };
  }

  /** 从备忘移除指定图片文件名 */
  removeImage(id, filename) {
    const m = this.getMemo(id);
    if (!m) return null;
    m.images = (m.images || []).filter((n) => n !== filename);
    this.save();
    return { ...m };
  }

  // ---------- Settings ----------
  getSettings() {
    return { ...this.data.settings };
  }

  setSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.getSettings();
  }

  // ---------- 提醒调度 ----------
  /**
   * 扫描所有待提醒项,返回本次需要触发的提醒列表
   * 调用方负责发通知并回调标记(回调已在此内完成)
   */
  scanReminders(notify) {
    const now = Date.now();
    const fired = [];
    for (const m of this.data.memos) {
      if (m.deleted || m.done) continue;
      const due = m.due_at;

      // 1) 提前提醒:advance 分钟前
      if (m.advance_minutes > 0 && !m.adv_sent) {
        const fireAt = due - m.advance_minutes * 60_000;
        if (fireAt <= now && now < due) {
          m.adv_sent = true;
          fired.push({
            id: m.id,
            title: m.title,
            body: `即将到期 · ${formatDue(m.due_at)} · ${m.advance_minutes} 分钟后`,
            kind: 'advance',
          });
        }
      }

      // 2) 到点提醒
      if (due <= now && !m.due_sent) {
        // 若在延后期内则跳过,等延后时间到
        if (m.snoozed_until && m.snoozed_until > now) continue;
        m.due_sent = true;
        m.snoozed_until = null;
        fired.push({
          id: m.id,
          title: m.title,
          body: `到点了 · ${formatDue(m.due_at)}`,
          kind: 'due',
        });
      }
    }
    if (fired.length) this.save();
    return fired;
  }
}

/** 计算下一次周期时间 */
function nextDueAt(ms, repeatType) {
  const d = new Date(ms);
  switch (repeatType) {
    case REPEAT_DAILY:
      d.setDate(d.getDate() + 1);
      break;
    case REPEAT_WEEKLY:
      d.setDate(d.getDate() + 7);
      break;
    case REPEAT_MONTHLY: {
      // 目标月可能没有该日(如 1/31 → 2 月),setMonth 会自动溢出,需回退到月末
      const day = d.getDate();
      d.setMonth(d.getMonth() + 1);
      if (d.getDate() !== day) d.setDate(0);
      break;
    }
    case REPEAT_YEARLY:
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      break;
  }
  return d.getTime();
}

function formatDue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

module.exports = { Store, REPEAT_DAILY, REPEAT_WEEKLY, REPEAT_MONTHLY, REPEAT_YEARLY, REPEAT_NONE, nextDueAt, formatDue };
