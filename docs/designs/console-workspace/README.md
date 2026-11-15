# 控制台三方向原型

打开design-demos/index.html查看对比与桌面/手机预览。每版HTML离线独立运行，不会连接真实训练进程。

- A：资源横带、全宽日志、底部可折叠模型明细。
- B：窄监控栏，下方显示模型位置和关键节点；日志弹性占宽。
- C：全宽日志，底部资源状态带与按需诊断抽屉。

原型中的所有数值、步骤和日志明确标注为演示。用户已选择B并授权编码，真实控制台现已实现窄监控栏、模型设备表、关键节点、日志搜索/筛选/复制/导出及移动端资源抽屉。生产代码使用真实任务的硬件快照和日志，不使用原型演示数据。

build-prototypes.py生成三版；verify-prototypes.cjs通过Node Playwright和已安装Edge截图与验证；build-boards.py使用Pillow生成并排对比和离线预览页。当前验收记录见polish-log.md。

实际Vue页面验证：verify-implementation.cjs，截图及结果在screenshots/implementation。测试使用隔离的只读API/WebSocket数据，不修改真实任务。生产构建使用training-ui目录的npm run build。
