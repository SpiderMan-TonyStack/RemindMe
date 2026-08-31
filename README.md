# RemindMe 备忘录

> 极简桌面备忘录:一句话记下待办,到点提醒你。数据 100% 本地存储,托盘常驻不漏提醒。

## 功能

- **快速添加**:顶部输入框 + 默认时间,回车即存(≤5 秒完成)
- **到期提醒**:主进程每 10 秒扫描,到点弹出 Windows 系统通知,支持延后 5/15/60 分钟
- **托盘常驻**:关闭窗口不退出,最小化到系统托盘,提醒永不遗漏
- **周期重复**:每天 / 每周 / 每月 / 每年,完成后自动生成下一条
- **组织能力**:置顶、三级优先级(重要红/一般橙/普通)、回收站(30 天可恢复)
- **效率**:全局快捷键 `Ctrl+Shift+M` 唤起、`Ctrl+N` 聚焦输入、全文搜索
- **图片附件**:快速添加时 🖼 选图随备忘保存;列表显示缩略图,点击看大图可删除;右键「添加图片」补图
- **粘贴/拖拽即建**:复制图片(Ctrl+C)→ 窗口内粘贴(Ctrl+V),或直接把图片拖进窗口,立即创建带图备忘(自动标题「图片备忘 MM-DD」)
- **批量操作**:已完成视图「清空已完成」、回收站视图「清空回收站」
- **回收站自动清理**:删除超 30 天的回收站条目在启动时自动清除
- **更新公告**:顶栏 📢 按钮查看每次新功能的版本记录(新增功能记得同步 `renderer/changelog.js`)
- **关闭行为**:关闭按钮(X)直接退出应用,不再驻留托盘(提醒仅在应用运行时生效)
- **数据安全**:JSON 本地存储,启动自动备份(保留 7 份),一键导出 JSON / CSV
- **外观**:深色 / 浅色 / 跟随系统

## 项目结构

```
RemindMe/
├── electron/
│   ├── main.js        # 主进程:窗口/托盘/通知/快捷键/IPC/提醒调度
│   ├── preload.js     # 安全桥接(contextBridge)
│   ├── store.js       # JSON 存储 + 提醒调度引擎(纯 Node 可单测)
│   └── icon.js        # 纯 Node 生成 PNG 图标(零依赖)
├── renderer/
│   ├── index.html     # 单页界面
│   ├── style.css      # 深/浅主题(仅依赖)
│   └── app.js         # 渲染层逻辑
├── test/
│   ├── unit.test.js   # 存储/提醒引擎单元测试
│   └── smoke.js       # Electron 冒烟测试
└── package.json
```

## 开发

```bash
# 安装依赖(已配置 npmmirror 镜像)
npm install

# 运行(Windows 需先 unset ELECTRON_RUN_AS_NODE,避免沙箱环境变量干扰)
unset ELECTRON_RUN_AS_NODE
npm start

# 单元测试(存储 + 提醒引擎,无需 GUI)
node test/unit.test.js

# 冒烟测试(真实 Electron 启动,注入数据验证渲染)
unset ELECTRON_RUN_AS_NODE
node_modules/electron/dist/electron.exe test/smoke.js

# 性能验收(注入 1000 条备忘,测冷启动/渲染/搜索耗时)
unset ELECTRON_RUN_AS_NODE
node_modules/electron/dist/electron.exe test/perf.js

# 图片附件协议冒烟(验证 remindme-img:// 加载缩略图)
unset ELECTRON_RUN_AS_NODE
node_modules/electron/dist/electron.exe test/img-smoke.js
```

## 打包

```bash
# NSIS 安装版 + 便携版(输出到 dist/)
npm run dist
```

产物:
- `dist/RemindMe-Setup-x.x.x.exe` — 安装版
- `dist/RemindMe-x.x.x.exe` — 便携版

## 数据位置

数据存放于 Electron userData 目录(`%APPDATA%\RemindMe\data\`):
- `data.json` — 全部备忘与设置
- `backups/` — 启动自动备份(最近 7 份)
- `attachments/` — 备忘图片附件(经 `remindme-img:` 自定义协议加载)

## 技术栈

Electron 33 · 原生 HTML/CSS/JS(零构建) · Node 内置 fs 存储 · 无任何原生模块依赖

## 验收对照(策划案 v1.1)

- ✅ 冷启动 ≤2s(实测 341ms)、添加 ≤5s、≤2 次操作
- ✅ 到点提醒(±1min)、延后 5/15/60、重复自动生成
- ✅ 托盘常驻、关窗不退出、开机自启
- ✅ 回收站恢复、一键导出、启动自动备份
- ✅ 1000 条流畅:全量渲染 15ms、搜索 1ms、视图切换 2ms(perf 脚本实测)
- ✅ 「全部」视图含已完成分组(修复:timeState='done' 条目不再被丢弃)
- ✅ 图片附件:快速添加带图、缩略图、大图查看/删除、右键补图(27 项单测 + img-smoke)
- ✅ 粘贴/拖拽图片即建备忘(自动标题)、批量清空、回收站 30 天自动清理(31 项单测全绿)
- ✅ 更新公告弹窗(📢 按钮)、关闭按钮直接退出(不再驻留托盘)
