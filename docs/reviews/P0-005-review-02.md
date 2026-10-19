# P0-005 R1 复审与 0.1.3 包

日期：2026-10-17。修复 `51c82a9`、记录 `f5eed41`，review base `d96e1ec`。

结论：**本地代码/固定包通过，R1 已关闭；可进入授权后的真机验证。** 本轮未安装/启停/改 profile，也未操作个人剪贴板或任何应用窗口。

实读 refs/effect 的打开移焦、Escape/关闭回焦、原生 Enter/Space click 与方向键路径。无全局监听，保留原生导航、空状态和偏好。Tab/Shift+Tab 当前消费第一次按键关闭并回焦触发按钮，下一次才继续导航；这是当前已明确的行为，不表述为一次 Tab 自然离开。此处无持久焦点陷阱，真机验证应确认体验；今后可再向原生菜单行为优化，不阻塞此次受控验证。

独立复跑 `npm run check`：静态 27/27 + VM smoke 30/30，合计 57/57。组件焦点模拟不代表真实 Host 焦点验收。

独立 tarball 检查：

- 版本：0.1.3。
- 路径：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p0-mode-shell/51c82a9/dsh-video-0.1.3.tgz`。
- SHA-256：`82def6de6129333179e015b9e841d967517ccc0def92cc48f677f0082a77f897`。
- 15,074 bytes / 9 files，逐文件与当前 DSH 工作树源码字节一致；旧固定包保留。

授权边界来自 P0-005 指南：新包先复审，不自动替换已安装插件。当前安装状态按 DSH 交付记录仍为 0.1.0；本轮主会话未进入 profile 重新核验。P0-006 提供受控安装/验证步骤，必须由用户明确授权替换后执行。
