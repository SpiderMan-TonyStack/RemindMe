/**
 * preload.js — 安全桥接,向渲染进程暴露受控 API
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { SOUNDS } = require('./sounds');

// 内置提醒音(data URL)注入渲染层
contextBridge.exposeInMainWorld('remindmeSounds', SOUNDS);

contextBridge.exposeInMainWorld('remindme', {
  // 备忘
  list: () => ipcRenderer.invoke('memos:list'),
  add: (payload) => ipcRenderer.invoke('memos:add', payload),
  toggleDone: (id) => ipcRenderer.invoke('memos:toggle-done', id),
  togglePin: (id) => ipcRenderer.invoke('memos:toggle-pin', id),
  setPriority: (id, p) => ipcRenderer.invoke('memos:set-priority', id, p),
  update: (id, patch) => ipcRenderer.invoke('memos:update', id, patch),
  snooze: (id, minutes) => ipcRenderer.invoke('memos:snooze', id, minutes),
  softDelete: (id) => ipcRenderer.invoke('memos:soft-delete', id),
  restore: (id) => ipcRenderer.invoke('memos:restore', id),
  hardDelete: (id) => ipcRenderer.invoke('memos:hard-delete', id),
  clearDone: () => ipcRenderer.invoke('memos:clear-done'),
  clearTrash: () => ipcRenderer.invoke('memos:clear-trash'),
  getReminderHistory: (limit) => ipcRenderer.invoke('memos:history', limit),

  // 图片附件
  pickImages: () => ipcRenderer.invoke('memos:pick-images'),
  addImages: (id, names) => ipcRenderer.invoke('memos:add-images', id, names),
  removeImage: (id, name) => ipcRenderer.invoke('memos:remove-image', id, name),
  saveImageBuffer: (buffer, mime) => ipcRenderer.invoke('memo:save-image-buffer', { buffer, mime }),

  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // 导出/导入
  exportData: (format) => ipcRenderer.invoke('data:export', format),
  importData: (mode) => ipcRenderer.invoke('data:import', mode),
  setTrayTip: (tip) => ipcRenderer.send('tray:set-tip', tip),

  // 事件
  onFocusQuickAdd: (cb) => ipcRenderer.on('focus-quick-add', () => cb()),
  onFocusMemo: (cb) => ipcRenderer.on('focus-memo', (_e, id) => cb(id)),
  onDataChanged: (cb) => ipcRenderer.on('data-changed', () => cb()),
  onPlayReminderSound: (cb) => ipcRenderer.on('play-reminder-sound', (_e, name) => cb(name)),
});
