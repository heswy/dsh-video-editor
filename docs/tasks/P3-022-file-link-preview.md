# P3-022 修复：read_image 文件链接点击仍触发 sidebarRight

日期：2026-10-21（Asia/Shanghai）。状态：**修复与仓库门禁完成，已在 real Chrome /tmp hybrid staging 上以真实 ToolRow DOM 验证；未合并、未安装、未发模型；待 Lead 构建 alpha.10 后由真机点击确认。**

- 分支：`codex/p3-022-file-link-preview`（base `origin/main` `0396838`），隔离 worktree `dsh-video-editor-worktrees/p3-022-file-link-preview`
- 只改 `client.js` 点击解析 + `scripts/smoke-client.mjs` 测试 + 本任务/handoff 文档；不改版本/pin/其它契约；不安装/重启/合并/发模型
- 真机回归来源：alpha.9 安装后点击 `read_image` 工具行的文件链接仍弹出原生“无法打开文件 / sidebarRight: no session surface is mounted”

## 根因（DSH 当前 chat bundle 证据）

- ToolRow 的 collapsed summary 是一个真实 DOM `<button type="button" class="<css-hash>_fileLink" onClick={openFile}>`，内部 `TextShimmer` 子 span 承载文案；**没有** `title`/`data-*` 路径属性，也不是 `a[href]`。
- summary 由 `toolRowModel` 生成：`[localized title, base].filter(Boolean).join(" · ")`，`read_image` 的 base 是 `relativizeToCwd(file_path)`，因此实际显示如 `读取图片 · .dsh-video-frames/latest.png`；也可能是绝对路径或 `~` 归一路径。
- `openFile` 在 `onClick` 里直接调用宿主 `onOpenFile(filePath)` → `openFile` → `ctx.sidebarRight.openResource`；插件内嵌对话位于全局 main panel 下，会话 surface 未挂载，因此抛错。
- P3-017 B2 的 `capturePreviewClick` 只覆盖 `a[href]`/`button[title]`/`[data-file-path]`/`img[src]`，该 button 全部不匹配，点击未被拦截。

## 修复（`client.js`）

- 新增 `PREVIEW_FILE_LINK_SELECTOR = '[class*="fileLink"]'`（匹配 CSS module 后缀，不写死 `Q2dzhW`）、`PREVIEW_SUMMARY_SEPARATOR = ' · '`。
- `previewSummaryPath(text)`：合并空白后取最后一个 ` · ` 之后的内容作为候选路径，要求 `localPathLike`（相对/绝对/`file://`/扩展名）且长度受限；普通含点号文案不会被误判为路径。
- `fileLinkPathFromTarget(target)`：`target.closest('[class*="fileLink"]')`；先读 `data-file-path`/`data-path`/`title`/`href`，再回退到 summary 文本解析。`localPathFromTarget` 在既有 button/anchor/data 分支之后接入该分支。
- `capturePreviewClick` 顺序调整为 **img 分支优先**：read_image 行的图片目标直接显示自身 `data:`/`blob:`/remote/同源地址；其它命中走 `openPreview(path)`。命中后 `preventDefault` + `stopPropagation`，宿主原生 `openFile` 不会执行；不调用、不猴补 `ctx.sidebarRight`（`check.mjs` 继续断言 client 源码不含该 token）。
- 普通按钮/普通聊天点击：不匹配任何分支时不拦截；文件卡/`a[href]`/已在面板内的本地图片行为保持。

## 测试与证据

- `node scripts/smoke-client.mjs`：**81/81**（基线 80 + 新增 P3-022 用例；原 B2 测试保留未删弱）。新用例覆盖真实 ToolRow 形状（button class 含 `fileLink`、无 title/data、text `读取图片 · .dsh-video-frames/latest.png`、点击子 span target）、绝对路径 summary、普通文案按钮不拦截、fileLink anchor `href`、img 在 fileLink 容器内优先；断言 `preventDefault`/`stopPropagation`、Host `preview` 恰好一次且 path 正确、Session/project 作用域正确。
- `node scripts/check.mjs`：**54/54**；`node scripts/check-host.mjs`：**68/68**。
- **real Chrome 组件验证**：/tmp hybrid staging（alpha.9 `573352e` staging 的只读 deps/config + 本分支 `client.js`，client sha256 `c06d246762a99f29…c997c3fd`；仅 /tmp 重建 INTEGRITY），并使用 /tmp 复制的 harness 脚本（patch `react-dom-lite` 支持 React 式 capture 事件：仅此 /tmp 副本，未改仓库 harness；在 `test-conversation-preview` 末尾构造真实 ToolRow DOM 后派发真实 click）。结果 **167/167 ok=true**（基線 164 + 3 个 P3-022 检查；B1–B5 acceptance 全 true、staging 只读审计 same=true）：
  - 真实 `<button class="Q2dzhW_fileLink"><span>读取图片 · .dsh-video-frames/latest.png</span></button>`，点击子 span → 插件 overlay 打开，**native click listener 0 次**（capture 拦截成功），Host `preview` path = `.dsh-video-frames/latest.png`，Session/project 作用域正确；
  - 绝对路径 summary `/tmp/p3-022-toolrow.png` → overlay 打开、native 0 次、Host path 原样转发；
  - 既有 164 项预览/UI 检查全过，无回归。
- 证据目录：`/tmp/p3-022-real/`（hybrid staging、preview 证据 JSON `preview-2026-10-21T00-22-58-127Z/conversation-preview-2026-10-21T00-23-55-337Z.json`、运行日志；运行产物未入仓）。

## 未验证 / 风险

- **安装后的真机点击仍需确认**：本修复未安装/未重启 DSH；alpha.10 安装后需要在已安装 DSH 的内嵌原生对话里实际点击 `read_image` 的文件链接，确认打开插件 overlay 且不再出现 sidebarRight 报错。
- 只解析 summary 文本：若宿主未来改分隔符/DOM 结构、或把路径缩写成 `~/...`，绝对路径无法还原（相对路径仍可用）；届时按 token 更新。`filePathLine` 行号不进入图片预览（图片场景无影响）。
- 不支持内嵌预览的文件类型仍显示准确本地提示（`E_PREVIEW_UNSUPPORTED`），不会回退到原生打开。
- Host `preview` 仍只允许受信 Session/project/artifact 根内的图片；越权路径会显示本地错误（不会导航/不触发 sidebarRight）。
- 本任务未改动 Host/worker；`preview` 的既有归属/字节/类型校验不变。

## 下一步

1. Lead 构建 alpha.10（含本修复）并安装；delivery-owner 重启验收：点击 read_image 文件链接、图片 gallery、普通聊天点击互不误伤。
2. 若真机 DOM 与 `/tmp/chat-current.js` 证据有差异，按真实类名/分隔符扩展 selector 并同步 smoke 用例。
