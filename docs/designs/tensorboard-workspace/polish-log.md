# 原型打磨记录

## C方向正式实现

用户已明确选定C，要求不修改TensorBoard内部。本轮只更改TensorBoardPanel.vue及其组件测试，样式全部scoped，未更改全局导航、主题、后端或TensorBoard内容。

实现第一轮：实际Vue页面截图screenshots/implementation/desktop-empty-before.png。检查发现辅助列字段和排障段落偏松、空状态最小高度偏大、浅色主题截图抓在颜色过渡中。收紧辅助列内距/段落行高，将指标容器最小高度由760降为680，浅色截图等待主题过渡完成。明确任务相对路径，并补充旧版Krea日志目录例外。

实现第二轮：已打开desktop-empty.png、light-empty.png检查；面板边界与现有主题一致，主辅列比例清晰，空状态布局平衡。另检查375px截图，保持全部辅助信息可用；1280/1600/1920/375px均无横向溢出。截图为真实Vue界面；任务为测试响应，未运行真实训练。

行为验证：折叠/展开和服务状态刷新均保留同一个iframe及其输入状态；只有主动重新加载会替换iframe。服务停止失败保留当前iframe，启动/停止只调用TensorBoard接口。测试嵌入页未被注入style、script或stylesheet。使用隔离响应，不把测试嵌入页作为实际TensorBoard截图交付。

通过8项组件测试、9项TensorBoard路由/代理/旧界面回归；vue-tsc类型检查、Vite生产构建、git diff --check。验证脚本verify-implementation.cjs；原Vue文件及测试已备份到backups/。

2026-11-15。三版第一轮与最终截图位于screenshots/；polish-before-after.jpg并列展示A初稿和打磨稿。

A：初稿任务区默认dl外边距较大；辅助卡片内距过松；排障段落使左栏过长。已收紧字段间距、面板padding和说明行高，保持功能主从。左下空间用于路径与排障，图表区宽度不再与辅助区等分。

B：初稿曲线区域高度压住下方上下文；任务/路径说明带重复间距；曲线边界对比偏弱。降低演示图高度、压缩底部信息带内距、保留清晰的浅色分割线。底部信息带与全宽曲线组成独立骨架。

C：初稿窄栏中路径/说明显拥挤；辅助卡片之间边界重复；排障说明较长。统一无缝分区、降低内距，保持路径折行。收起辅助栏按钮验证通过。

检查：已实际打开并查看三版桌面原图、A窄屏长图及六格截图。Node Playwright验证三版375px无横向溢出、服务启动/停止演示、空状态、指标筛选、C抽屉，控制台无脚本错误。窄屏不显示全局任务导航以聚焦本页（仅原型演示，正式实现不改全局导航）。

Python版polish thumbs、design_lint因缺少Python Playwright自动跳过。改用桌面随附Node Playwright截图与交互检查；没有安装额外浏览器或包。尚未验证真实服务API；本轮只交设计原型。

边界：原型曲线为明确标记的演示，真正图表保留原生TensorBoard。截图中部分标签小于正文是嵌入页面示意，不作为重做TensorBoard自身的规范。
