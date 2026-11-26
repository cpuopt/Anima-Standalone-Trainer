# 打磨日志 · Anima Client Portal

## Round 1 · 三方向初稿打磨 (`design-demos/dir-1.html` / `dir-2.html` / `dir-3.html`)
1. 解决「全部」视图单张分组折行导致首屏留白的问题，改为连续网格并在卡片底注标注所属分组。
2. 原型权限模拟器改为默认折叠胶囊，消除对画廊角落的遮挡。
3. 优化 `dir-1` 缩略图密度至 `255px`，强化 `dir-2` 展签中文表达，在 `dir-3` 右侧交付舱补全「打包下载全部可见预览图」主动作。

## Round 2 · 正式版实装打磨 (`training-ui/client-portal/public/`)
1. **移动端窄屏卡片截断修复**：检查 375px / 500px 实测截图时发现 `.shot-foot` 内 `.shot-name`（`white-space: nowrap`）未设 `min-width: 0; flex: 1`，在双列 Grid 中会撑宽列轨道；同时 `@media (max-width: 960px)` 下 `.app` 的 `1fr` 轨道未约束为 `minmax(0, 1fr)`。
2. **修复措施**：为 `.shot-foot` 与 `.shot-name` 补充 `min-width: 0` 与 `flex: 1`，移动端 Grid 统一收敛为 `minmax(0, 1fr)` 与双列紧凑卡片，复测阶段一、阶段二桌面端（`1440×900`）与移动端（`500×812`）均无横向溢出与截断问题。
