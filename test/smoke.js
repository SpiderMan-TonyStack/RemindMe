/**
 * smoke.js — Electron 冒烟测试入口
 * 运行: node_modules/electron/dist/electron.exe test/smoke.js
 * 自动加载主进程,5 秒后注入测试数据并验证渲染结果后退出(0=成功 1=失败)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.REMINDME_SMOKE = '1';
process.env.REMINDME_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'remindme-smoke-'));

require('../electron/main.js');
