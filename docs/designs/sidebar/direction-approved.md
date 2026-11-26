# Direction Approved — Sidebar Redesign

## Directions presented (2026-11-24)
- **Direction A (`dir-1.html`)**: 细线台账 Hairline Ledger (`230px`, Tufte × Müller-Brockmann hairline index, inline arch filter tabs, collapsible `+ 新建` drawer & queue strip)
  - Screenshots: `shots/dir-1-1440.png`, `shots/dir-1-light.png`
- **Direction B (`dir-2.html`)**: 架构分组树 Grouped Workspace Tree (`236px`, Linear / VS Code collapsible architecture tree + docked queue card)
  - Screenshots: `shots/dir-2-1440.png`, `shots/dir-2-light.png`
- **Direction C (`dir-3.html`)**: 双轨速切栏 Dual-Rail Sidebar (`38px` tool/filter rail + `202px` full-height job list)
  - Screenshots: `shots/dir-3-1440.png`, `shots/dir-3-light.png`
- **Thumbnail overview**: `thumbs.html` / `shots/thumbs.png`

## User selection (verbatim)
> 选中方向A，编写代码实现修改。同时客户交互系统的左侧栏也改为这种风格

## Implementation scope
1. **Training Studio**: Apply Direction A (`230px` Tufte Hairline Ledger) to `training-ui/frontend/src/app/App.vue` and `training-ui/frontend/src/style.css`, leaving all right-side `.toolbar`, `.tabs`, and tab panel contents unchanged.
2. **Client Portal (客户交互系统)**: Apply Direction A (`230px` Tufte Hairline Ledger) to `training-ui/client-portal/public/index.html` and `training-ui/client-portal/public/style.css`, leaving the right-side `.workspace`, `.lightbox`, `.modal-mask`, and `app.js` behavior unchanged.
