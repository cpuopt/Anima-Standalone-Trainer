# 已核对的事实

本地产品以仓库代码为事实来源。当前可用字段来自WebSocket hw_stats：CPU、RAM、GPU、memoryProcesses；日志是同一任务的文本流。阶段来自训练状态或显存节点，不存在当前页面可直接用的历史曲线接口。

当前控制台的左右宽度和高度规则已从style.css核对。只要硬件内容较短，宽屏左栏就会留空，不能靠加高GPU卡片解决。

外部参考已在2026-11-15查询官方渠道：

- [Grafana Logs in Explore](https://grafana.com/docs/grafana/latest/visualizations/explore/logs-integration/)：可过滤、跟随日志和面板布局。只借用日志工具与内容区域的关系。
- [W&B Console logs](https://docs.wandb.ai/models/app/console-logs)：训练运行的日志查看入口。最终跳转与截图保存在refs/capture记录中，视觉借用以实际截图为准。

原型中的数值、运行日志、记录长度均是明确标注的演示状态。缺少显存节点时显示等待快照，不用预测结果或零值补齐。

环境：Python版Playwright缺失，沿用Node Playwright与已安装Edge进行参考截图和原型验证，不下载浏览器、不安装依赖。

另已从Grafana官方文档明确引用的[Logs visualization原图](https://grafana.com/media/docs/grafana/panels-visualizations/screenshot-logs-v12.3.png)截取实际应用UI，亲眼查看`refs/grafana-logs-ui.png`。图中可见贴近日志的工具、分级颜色和内嵌明细，作为B版工具/内容关系参考。W&B官方文档现跳转至CoreWeave文档，截图如实保留；它在此只作为交互参考，不声称截图为应用本体。
