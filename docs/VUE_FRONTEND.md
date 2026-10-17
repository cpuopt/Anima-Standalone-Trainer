# Vue 前端

前端：Vue **3.5.44**、TypeScript、Vite、Pinia、shadcn-vue、Tailwind CSS 4。后端继续使用 Express 4 / CommonJS，训练与采样仍调用原 Python 后端。

## 启动与入口

继续使用 `training-ui/start_training_ui_anima.bat` 或 `training-ui/start_linux.sh`。也可在 `training-ui/` 执行：

```sh
npm ci
npm start
```

需要 Node 20.19+ 或 22.12+，推荐 Node 24。首次运行需要网络安装前端锁文件中的依赖。之后启动检查源码指纹，只有源码或配置变化时才重新构建，不会每次重新安装。前端构建工具列于 devDependencies；构建环境需要安装这些依赖。

- `/`：重定向到新版 `/ui/`。
- `/ui/`：Vue 界面，包含所有九个功能页面。
- `/legacy/`：保留的原生 HTML / JavaScript 界面。
- API、WebSocket、`/uploads`、`/tensorboard` 路径保持原协议与同源访问。

生产运行只有原 Express 服务，不需要 Vite 进程或额外端口。构建目录 `training-ui/frontend/dist/` 不提交版本控制，由启动流程生成。

## 开发、构建与测试

在 `training-ui/`：

```sh
npm run build       # 安装必要依赖，类型检查、强制生产构建并更新指纹
npm test            # 原有 Node 业务测试和新版入口路由测试
npm run test:ui     # Vue / Pinia / 配置与组件行为测试
npm run dev        # Express，默认 3000
npm run dev:ui     # 另一个终端，Vite 默认 5173，访问 /ui/
```

在 `training-ui/frontend/` 还可运行 `npm run typecheck`、`npm run build`、`npm test`。直接在 frontend 构建后，下一次 npm start 可能再构建一次以写入发布指纹；通常使用上层 `npm run build`。

Vite 的后端默认 `http://127.0.0.1:3000`，可用 `TRAINER_BACKEND_URL` 指定。开发代理同时转发 API、上传、TensorBoard 和根路径 WS；Vite 热更新连接使用 `/ui/`，避免与业务 WS 冲突。

前端 `.npmrc` 使用 `legacy-peer-deps`，避免自动拉取未使用的 Vitest 浏览器运行器。实际使用的 Vue、Pinia、Reka UI、VueUse、构建和 jsdom 依赖均显式声明；版本由独立锁文件固定，类型检查和测试核对集成兼容性。

shadcn-vue Button / Input 源码已提交在 `frontend/src/components/ui/`，源自官方 new-york-v4 registry，使用本地 `cn` 工具，并保留 [上游 MIT 许可](https://github.com/unovue/shadcn-vue/blob/dev/LICENSE)。正常安装、启动和构建不会联网下载组件源码。可选刷新脚本 `frontend/scripts/vendor-components.mjs` 仅供维护者显式更新组件时使用。

## 配置与运行行为

- 编辑基于完整服务端原始对象；只改用户触碰的字段，保留未知高级参数、0、false 和空值。
- config、dataset、prompts 分别保存和记录快照；部分失败不会错误清除其余未保存状态。
- 任务切换取消旧请求，并用请求版本隔离晚到响应。WS 由 store 统一维护，重连重新订阅当前任务；硬件消息独立于任务日志。
- 现有 Krea / LayerRank / AdapterMatrix / LBAI 纯逻辑通过适配层复用，没有复制第二套矩阵计算规则。
- Anima 支持 LoRA、LoHa、LoKR、DoRA、DoKr 与完整微调配置；Krea 保持 LoRA / LoKR、单 GPU、bf16 等原有约束。
- 训练中采样配置与独立 RAW / Turbo 参数分开。Krea 运行时禁止配置/数据集编辑；当前运行的提示词采用原后端启动快照。
- 保留旧 localStorage 中最后任务、提示词临时参数、负词、样图顺序、主题及监控折叠状态的兼容读取。原提示词各行的负词在编辑其他字段时保留；主动修改全局负词才批量覆盖。
- Dataset 允许分别编辑多个分辨率 Dataset、每个子集的 Alpha Mask；Progressive Resolution 以原格式字符串编辑，不复刻旧的百分比滑块。
- 控制台保留最多 500,000 字符，处理回车覆盖进度行。切换页面销毁页面轮询与键盘监听，避免后台泄漏。

## 回退

已运行的服务直接访问 `/legacy/` 即可。若要跳过 Vue 构建并以旧界面启动：

PowerShell（在 `training-ui/`）：

```powershell
$env:TRAINER_UI = 'legacy'
npm start
```

Linux：

```sh
TRAINER_UI=legacy npm start
```

取消该环境变量后恢复默认 Vue 入口。直接 `node server.js` 会跳过 npm 的预构建步骤，仅适合已构建部署或调试；缺少产物时根路径回退旧界面，`/ui/` 返回构建提示。

## 实施与验证记录

2026-10-16，从 `0955de8` 开始实施。三个协作代理分别负责参数页、数据集/画廊、采样/监控/设置，主代理负责共享状态、API、序列化、路由、构建、集成与回归。

| 阶段 | 交付 |
| --- | --- |
| M0 | 框架、任务切换、完整配置草稿/快照、按资源保存、Anima/Krea 配置往返 |
| M1 | Training、Dataset、Network、Multi-GPU、Layer Rank 与矩阵预览、跨页互斥 |
| M2 | 训练启动/停止接线、训练中采样设置、RAW/Turbo、提示词、画廊、日志、硬件、TensorBoard、全局及任务维护 |
| M3 | 指纹构建、单端口发布、默认入口切换、旧入口回退、Windows/Linux 启动脚本 |

已完成类型检查、生产构建、93 项 Node 回归及 57 项 Vue 行为测试。Windows `npm start` 的预构建检查与服务启动已验证；重复预构建检查无源码变化时不会重建。浏览器使用独立 `codex-vue-check-*` 任务验证创建、参数修改、保存、重载、切换及矩阵计算：Anima LoRA rank32 显示 131,072；Krea LoKR factor3/rank32 显示 131,081（0.3472%）；Full factor16 显示 16×16 / 384×384、147,712（0.3913%），factor0 被阻止保存。九页巡检无控制台警告/错误，单纯浏览未污染任务草稿。默认入口、新版、旧版和缺失资源响应已验证。测试任务已清理。

验证限制：未配置真实模型权重，本轮未启动真实训练、未生成真实样图。训练/采样的前端接线和后端已有测试通过，不代表真实 GPU 运行验证完成；TensorBoard 真实进程与多 GPU 训练仍需对应环境。Linux 启动脚本已更新，但尚未在 Linux 实机运行。新页面迁移会改变布局，浏览器验收不等于所有可能交互均已穷尽。

额度测量：19:00 起点 5 小时窗口已用 0%，周额度已用 37%；首次完整页面集成与浏览器配置往返后为 59% / 47%；最终清理后读数为 80% / 50%，即本轮账户观测增加约 80 个五小时额度百分点、13 个周额度百分点。包含三个子代理、安装、返工、测试和两轮评审，不能解释成 M0 的独立消耗，也无法排除账户其他会话使用。未使用额度重置。
