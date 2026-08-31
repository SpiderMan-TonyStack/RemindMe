/**
 * unit.test.js — 存储与提醒调度引擎单元测试(node 直接运行,无需 GUI)
 * 运行: node test/unit.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { Store, nextDueAt } = require('../electron/store');
const { makeAppIcon, makeTrayIcon } = require('../electron/icon');

let passed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { console.error('  ✗ FAIL:', name); process.exitCode = 1; }
}

(async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'remindme-test-'));
  const file = path.join(tmp, 'data.json');
  const store = new Store(file);
  const now = Date.now();

  console.log('— 基础添加/保存 —');
  const m1 = store.addMemo({ title: '取快递', due_at: now + 3600_000 });
  ok(store.listMemos().length === 1, '添加后 1 条');
  ok(m1.title === '取快递', '标题正确');
  store.save();
  const store2 = new Store(file);
  ok(store2.listMemos().length === 1, '重启后数据持久化');

  console.log('— 完成 + 周期重复 —');
  const rep = store.addMemo({ title: '每周周报', due_at: now, repeat_type: 'weekly' });
  const before = rep.due_at;
  const toggled = store.toggleDone(rep.id);
  ok(toggled.repeated === true, '周期备忘完成时标记 repeated');
  ok(store.getMemo(rep.id).due_at === before + 7 * 86400_000, '完成生成下一周时间');
  ok(store.getMemo(rep.id).done === false, '周期备忘完成后自动恢复未完成');

  console.log('— 到期提醒触发与去重 —');
  const due = store.addMemo({ title: '过期事项', due_at: now - 60_000 });
  let fired = store.scanReminders(() => {});
  ok(fired.some((f) => f.id === due.id && f.kind === 'due'), '到期触发 due 通知');
  fired = store.scanReminders(() => {});
  ok(!fired.some((f) => f.id === due.id), '同一事项不重复触发');

  console.log('— 延后机制 —');
  const snoozed = store.snooze(due.id, 5);
  ok(snoozed.snoozed_until > now, '延后设置了 snoozed_until');
  fired = store.scanReminders(() => {});
  ok(!fired.some((f) => f.id === due.id), '延后期内不触发');
  store.getMemo(due.id).snoozed_until = now - 1000; // 模拟延后时间到
  fired = store.scanReminders(() => {});
  ok(fired.some((f) => f.id === due.id), '延后期结束再次触发');

  console.log('— 提前提醒 —');
  const adv = store.addMemo({ title: '会议', due_at: now + 300_000, advance_minutes: 5 });
  fired = store.scanReminders(() => {});
  ok(fired.some((f) => f.id === adv.id && f.kind === 'advance'), '提前 5 分钟触发 advance');

  console.log('— 回收站 —');
  store.softDelete(due.id);
  ok(store.getMemo(due.id).deleted === true, '软删除标记');
  store.restore(due.id);
  ok(store.getMemo(due.id).deleted === false, '恢复成功');
  store.softDelete(due.id);
  store.hardDelete(due.id);
  ok(!store.getMemo(due.id), '永久删除生效');

  console.log('— 回收站 30 天自动清理 —');
  const oldDel = store.addMemo({ title: '超期删除', due_at: now + 1000 });
  store.softDelete(oldDel.id);
  store.getMemo(oldDel.id).deleted_at = now - 31 * 86400_000; // 模拟 31 天前删除
  const recentDel = store.addMemo({ title: '近期删除', due_at: now + 1000 });
  store.softDelete(recentDel.id); // deleted_at = now
  const purged = store.cleanupTrash();
  ok(purged === 1, '仅清理超过 30 天的回收站条目');
  ok(!store.getMemo(oldDel.id), '超期条目被清除');
  ok(store.getMemo(recentDel.id), '近期条目保留');
  ok(store.cleanupTrash() === 0, '重复清理无副作用');

  console.log('— 编辑备忘 —');
  const em = store.addMemo({ title: '原始标题', due_at: now + 3600_000 });
  store.snooze(em.id, 5); // 让 snoozed_until 有值、due_sent=true
  ok(store.getMemo(em.id).snoozed_until > 0, '前置:延后已设');
  const newDue = now + 7200_000;
  const upd = store.updateMemo(em.id, { title: '新标题', due_at: newDue, repeat_type: 'weekly', priority: 2, pinned: true, advance_minutes: 10 });
  ok(upd.title === '新标题' && upd.due_at === newDue && upd.repeat_type === 'weekly' && upd.priority === 2 && upd.pinned === true && upd.advance_minutes === 10, 'updateMemo 应用所有字段');
  ok(store.getMemo(em.id).due_sent === false && store.getMemo(em.id).adv_sent === false && store.getMemo(em.id).snoozed_until === null, '时间/提前量变化重置提醒状态');
  store.softDelete(em.id);
  ok(store.updateMemo(em.id, { title: 'x' }) === null, '软删除后不可编辑');
  const e2 = store.addMemo({ title: 'A', due_at: now + 3600_000 });
  const beforeSent = store.getMemo(e2.id).due_sent;
  store.updateMemo(e2.id, { title: 'B', priority: 1 });
  ok(store.getMemo(e2.id).title === 'B' && store.getMemo(e2.id).priority === 1, '单字段更新生效');
  ok(store.getMemo(e2.id).due_sent === beforeSent, '未改时间/提前量时不重置 due_sent');

  console.log('— 周期计算 —');
  const t = new Date(2026, 0, 31, 10, 0).getTime();
  ok(nextDueAt(t, 'daily') === new Date(2026, 1, 1, 10, 0).getTime(), 'daily 跨月');
  ok(nextDueAt(t, 'weekly') === t + 7 * 86400_000, 'weekly +7 天');
  ok(nextDueAt(t, 'monthly') === new Date(2026, 1, 28, 10, 0).getTime(), 'monthly 1/31 → 2/28');
  ok(nextDueAt(t, 'yearly') === new Date(2027, 0, 31, 10, 0).getTime(), 'yearly +1 年');

  console.log('— 图标生成 —');
  const appPng = makeAppIcon(256);
  const trayPng = makeTrayIcon(32);
  ok(appPng.readUInt32BE(0) === 0x89504e47 && appPng.slice(1, 4).toString() === 'PNG', '应用图标是合法 PNG');
  ok(appPng.length > 500 && trayPng.length > 200, '图标尺寸正常');
  fs.writeFileSync(path.join(tmp, 'icon.png'), appPng);
  fs.writeFileSync(path.join(tmp, 'tray.png'), trayPng);
  ok(fs.existsSync(path.join(tmp, 'icon.png')), '图标可写盘');

  console.log('— 图片附件 —');
  const imgMemo = store.addMemo({ title: '带图备忘', due_at: now + 3600_000 });
  ok(Array.isArray(imgMemo.images) && imgMemo.images.length === 0, '新建备忘 images 初始为空数组');
  store.addMemo({ title: '带图备忘2', due_at: now + 3600_000, images: ['a.png', 'b.png'] });
  ok(store.listMemos().find((m) => m.title === '带图备忘2').images.length === 2, 'addMemo 支持初始图片');
  store.addImages(imgMemo.id, ['x.png']);
  store.addImages(imgMemo.id, ['x.png', 'y.png']);
  ok(store.getMemo(imgMemo.id).images.length === 2, 'addImages 追加且去重');
  store.removeImage(imgMemo.id, 'x.png');
  ok(store.getMemo(imgMemo.id).images.length === 1 && store.getMemo(imgMemo.id).images[0] === 'y.png', 'removeImage 移除指定图');
  // 旧数据兜底
  store.data.memos[0].images = undefined;
  store.save();
  const store3 = new Store(file);
  ok(Array.isArray(store3.listMemos()[0].images), '旧数据无 images 字段时兜底为空数组');

  console.log('— 导入备份 —');
  const beforeImport = store3.listMemos().length;
  // 合并:重复 id 跳过,新增追加
  const imp = store3.importData({ memos: [
    { id: store3.listMemos()[0].id, title: '重复条目(应跳过)', due_at: now, repeat_type: 'none', priority: 0 },
    { id: 9999, title: '新设备条目', due_at: now + 1000, repeat_type: 'none', priority: 1 },
  ] }, 'merge');
  ok(imp.added === 1 && imp.skipped === 1, '合并导入:新增 1 跳过 1');
  ok(store3.listMemos().length === beforeImport + 1, '合并后总数 +1');
  ok(store3.listMemos().some((m) => m.title === '新设备条目'), '新条目已加入');
  ok(!store3.listMemos().some((m) => m.title === '重复条目(应跳过)'), '重复 id 未覆盖原条目');
  // 替换:覆盖全部
  const repImp = store3.importData({ memos: [
    { id: 1, title: '替换后的唯一条目', due_at: now, repeat_type: 'none', priority: 0 },
  ] }, 'replace');
  ok(repImp.replaced && repImp.added === 1, '替换导入标记 replaced');
  ok(store3.listMemos().length === 1 && store3.listMemos()[0].title === '替换后的唯一条目', '替换后仅剩导入条目');
  // 格式错误
  const bad = store3.importData({ foo: 1 });
  ok(bad.error && bad.added === 0, '非法格式返回 error');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n共通过 ${passed} 项断言`);
  if (process.exitCode) console.log('存在失败项!');
  else console.log('全部通过 ✔');
})();
