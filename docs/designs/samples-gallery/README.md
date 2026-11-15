# 样例页三方向交互原型

打开 `design-demos/index.html` 查看三版图库与详情的桌面/手机截图，然后点击“打开可交互原型”。所有样例图已内嵌，可离线打开各版HTML。

- A：原比例密铺；Prompt分组并列，详情为画布+右侧参数。
- B：紧凑联系表；连续等格缩略图，详情默认全画布，可开参数，底部缩略导航。
- C：轮次对照矩阵；轮次为行、Prompt为列，详情带左侧缩略导航。

使用：点击图片进入详情；图像区域滚轮缩放、拖动平移、双击复位；0键适应；加减键缩放；左右键切图；Esc关闭；参数区独立滚动。触屏支持拖动/双指缩放。

原型仅使用本地样例预览，演示记录与参数明确标注。图像下载导出内嵌JPEG预览，不调用真实删除或生成接口。生产Vue页面尚未改动。

重建：用带Pillow的Python运行`build_prototypes.py`，Node运行`verify-prototypes.cjs`，设置DESIGN_ROUND=round-2后输出最终截图，再运行`build_boards.py`。Node验证使用工作区附带Playwright和系统Edge。

目录中的spec、directions、brand-spec、product-facts与polish-log记录设计依据、参考和验证结果。用户选择后才建立direction-approved.md并继续选定方向的细化。
