# 方向已选定

用户选择原话：

> 以A为基础，在选中某个prompt的tab时，横向改为可以占据全部空间。

基准：A 原比例密铺。原型：`design-demos/dir-1.html`。

原始方向截图：`screenshots/round-2/dir-1-gallery.png`。本次修改截图：`screenshots/prompt-full-width/`。

约定：全部Prompt时保留分组并列；筛选至一个Prompt时，唯一可见分组跨满所有网格列，缩略图按可用宽度重新密铺。手机上继续使用全宽分组。保留现有详情缩放交互。当前迭代范围为原型。

后续已确认A v2，用户授权生产实现原话：

> 很好，照此编码实现，修改“样例”tab下的界面

现已实现于`training-ui/frontend/src/features/samples/SamplesPanel.vue`，详情独立组件为`SampleViewer.vue`。保留真实样例、元数据接口与现有多选/排序/删除功能。单Prompt采用auto-fit网格避免横屏空列。生产构建已生成；浏览器验证使用只读隔离数据，不修改真实任务或图片。
