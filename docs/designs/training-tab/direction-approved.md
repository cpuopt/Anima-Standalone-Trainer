# Direction Approved

## Directions presented (2026-11-20)
- **Direction A (`dir-1.html`)**: Tufte-style Run Timeline + four-column hairline sheet
  - Screenshots: `shots/dir-1-1440.png`, `shots/dir-1-light.png`, `shots/dir-1-full.png`, `shots/dir-1-1920.png`
- **Direction B (`dir-2.html`)**: Linear / macOS System Settings list-detail with section rail
  - Screenshots: `shots/dir-2-1440.png`, `shots/dir-2-light.png`, `shots/dir-2-full.png`, `shots/dir-2-1920.png`
- **Direction C (`dir-3.html`)**: Teenage Engineering industrial instrument faceplate
  - Screenshots: `shots/dir-3-1440.png`, `shots/dir-3-light.png`, `shots/dir-3-full.png`, `shots/dir-3-1920.png`
- **Thumbnail overview**: `thumbs.html` / `shots/thumbs.png`

## User selection (verbatim)
> 以dir1的整体框架为基础，修改dir1
> 需要作以下修改：
> - warmup 使用时，warmup仅生效一次，不会使每个restart都带warmup。这里是图画错了
> - LR Scheduler 的下拉选择和“曲线”按钮 预览曲线，与项目现有实现保持一致，不要分开成2块。
> - Learning Rate 的控制区域，照搬dir3的滑条和+-按钮

## Agreed direction
Base framework: **Direction A (`dir-1.html`)**, modified with:
1. Single initial warmup only in the Run Timeline chart (separate subpaths + vertical restart jumps for `cosine_with_restarts`, never drawing a ramp/warmup on restarts).
2. Unified `SchedulerSelect` + `SchedulerCurve` two-column dropdown popover matching the existing Vue implementation.
3. Direction C's logarithmic gauge slider + `−`/`+` stepper controls for `Learning Rate`.
