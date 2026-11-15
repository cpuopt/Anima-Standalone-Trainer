# 方向确认

用户原话：按照C进行编码实现，**TensorBoard** 内部的无法修改 不修改。

选定C：design-demos/dir-3.html；展示截图screenshots/dir-3.png，三版对比primary-directions.jpg。

实现范围：只改TensorBoardPanel.vue外层布局、辅助信息、折叠/全屏/重载及服务操作。iframe仍使用现有服务URL，不读取/注入/修改TensorBoard内部DOM、样式或交互。保留应用现有主题。原文件备份backups/TensorBoardPanel.before-C.vue。
