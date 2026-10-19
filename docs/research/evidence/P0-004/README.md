# P0-004 补验证据（去标识裁剪）

来源：2026-10-17 在真实 DSH Desktop `0.2.0-rc.2` 的**专用空白静态测试会话**中操作并截图；测试时已安装的是 `0.1.0`（`0.1.1` 修复包尚未替换安装）。截图已裁掉侧栏会话列表与其它用户内容。

| 文件 | 说明 |
|---|---|
| `01-mention-menu.png` | 在新行输入 `@` 后真实出现的 mention 菜单（「文件与文件夹」列表），编辑器中为多行中文测试草稿与文件附件 chip |
| `02-draft-reference-file-retained.png` | 普通 → 视频 → 普通往返后：多行文字、`README.md` 引用 chip、`p0-004-file-test.md` 文件附件 chip 均仍在（中途保持未发送；行尾残留的 `@` 是菜单触发字符，不是 chip） |
| `03-file-attachment-preview.png` | 点击文件附件 chip 后右侧预览真实文件内容，证明附件不只是同名文本 |
| `04-keyboard-focus-capsule.png` | 键盘 Tab 聚焦胶囊「普通」时的可见焦点环（视频模式页） |
| `05-simplified-toggle-on.png` | 插件内「简化界面效果」开关 ON |
| `06-simplified-frames.png` | 简化效果 ON 时普通/视频往返录屏的过渡帧拼图：切换后的首帧底片已在目标段，无中间滑动位（对比 P0-003 未简化时录屏有中间位） |

本地原始件：`/tmp/supp2-*.png`、`/tmp/supp3-*.png`、`/tmp/supp4-*.png`、`/tmp/supp5-*.png`、`/tmp/simpf/`、`/tmp/simplified-roundtrip.mov`。
