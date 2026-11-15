# 已核对事实

本项目为本地源码产品，当前样例页以 Vue 实现，真实行为以仓库代码为准。现有分组在宽屏下有24px间距，缩略图固定180px高且包含完整文件名；详情为整页滚动的纵向布局，没有独立缩放画布。

参考已于2026-11-15查询并截图：

- [Eagle 官方网站](https://eagle.cool/)：页面下部有实际素材库界面。已亲眼查看 `refs/eagle.jpg`。借用紧密缩略图、轻量工具栏、内容与检查器分离，不采用官网营销版式。
- [darktable 官方手册](https://docs.darktable.org/usermanual/development/en/lighttable/overview/)：核实联系表与图片导航、缩放/平移交互。已查看 `refs/darktable.jpg`（手册页面，不把它说成已看过应用截图）；仅作为交互参考，视觉来源为既有项目。

Python版Playwright不可用；参考截图、原型截图及交互核验改用随运行时提供的Node Playwright + 已安装Edge，不下载浏览器。
