# P0-006 真机验证证据（去标识裁剪）

来源：2026-10-17 在真实 DSH Desktop `0.2.1-rc.1` 窗口（PID 61333，窗口 (0,33) 1470×923）上截取，已安装运行的是 `0.1.3`。侧栏裁剪仅保留导航区（至「工作区」头），不包含工作区/会话标题等用户内容；主面板裁剪仅包含该插件面板。

| 文件 | 说明 |
|---|---|
| `01-sidebar-entry.png` | 入口 **Vedio Editor** 位于「上下文洞察」之后、「工作区」之前；细线条视频图标；未选中 |
| `02-sidebar-entry-selected.png` | 同一入口被宿主原生选中（高亮） |
| `03-video-panel-empty.png` | 视频面板：仅「返回对话」「显示选项」与「尚无工程」，无阶段说明/状态栏/假创建导出 |
| `04-after-disable-sidebar.png` | 视频面板中停用插件后：侧栏不再显示 Vedio Editor，页面自动回会话 |
| `05-after-reenable-sidebar.png` | 重新启用后入口恢复 |
| `06-conversation-header-no-capsule.png` | 普通会话顶部：旧「普通｜视频」胶囊已消失 |

原始全窗截图在 `/tmp/p006-*.png`（含会话内容，不入库）。
