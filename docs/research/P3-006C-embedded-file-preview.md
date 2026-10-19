# P3-006-C 交付证据：嵌入创作会话中的图片/文件预览

日期：2026-10-18（Asia/Shanghai）。执行：p0-mode-shell（`dsh/p0-mode-shell` / PR #3）。基线 `2cd718a` / 已安装功能 `b382686`；本任务代码提交 **`3310280`**，根版本 **`0.3.0-alpha.2`**，引擎仍固定已审 `54f4671` / 两包 `0.1.1`。本文件是开发交付证据，不是安装验收；本轮未安装、未启停、未重启、未调用模型。

## 1. 结论

- 已交付**可工作的插件内图片预览**：插件自有嵌入 AI 区域中的原生文件卡/mention 与 Markdown 本地文件链接被局部捕获后，在右 AI 区域的 dialog 中打开图片，关闭返回原会话；不导航普通对话、不常驻第三列、不替换左工程。
- Host 新增受信 `preview` 路由：只接受已登记 Session/工程，只读 `sessionCwd` 与 worker `artifactRoot` 两个根，按真实字节嗅探图片，限制 8 MiB，拒绝任意绝对路径/目录逃逸/重命名 HTML/未支持类型/越界 Session。
- 未修改 ASAR，未猴补 `ctx.sidebarRight`，未替换原生 chat/文件节点；捕获仅限本插件 AI 面板子树，不是全局 DOM 监听。
- 固定候选与新 staging 已生成、真实 Host→engine 链 test-host-engine 通过；旧已安装 staging 与用户数据未动。

## 2. 根因

本机 0.2.1-rc.2 的原生 chat `openFile` 调用全局 `ctx.sidebarRight.openResource`（源核对见 P3-006-A LIVE 复核）。全局 rightbar 的会话 surface 仅在普通 Conversation 主面板（`layout.panelInfo.activePanelId === null`）时通过 `show(selected.sessionId)` 挂载；`dsh-video` 主面板激活时 `show(undefined)`，因此全局视频面板内的原生文件卡点击抛 `sidebarRight: no session surface is mounted`。

该错误不是 PNG 损坏，也不能靠重试解决。本任务不替换宿主、不抢占普通会话、不挂 `rightbar.session` 硬顶：

- **局部捕获**：在插件自有 `.dv-ai` 容器上注册 `onClickCapture`，仅当点击目标是原生文件卡/mention 的 `button[title]` 图片路径或 Markdown 文件链接 `a[href]` 时 `preventDefault/stopPropagation`，改开插件自有 dialog。其他点击完全交给宿主。
- **受信 Host 预览**：客户端只把路径与当前已登记 `sessionId`、固定工程 id 发给 Host；Host 查持久映射确认工程归属，再做 canonical root 校验与图片字节校验。路径不能来自 Tool，UI 不能指定根。
- 会话切换/卸载时 token 与当前 session 比对，迟到的 preview 不显示在下一个会话。

## 3. 接口与安全边界

### Host `preview`（UI Fetch only）

请求：`POST /api/dsh-video/request`，`{method:"preview", params:{projectId, sessionId, path}}`。

- `projectId` 必须在 Host allowlist；`sessionId` 必须匹配格式且已在该工程持久映射中；否则 `E_SESSION_NOT_BOUND` / `E_PROJECT_SCOPE`。
- `path` 可为 `file://`、绝对路径或以 `sessionCwd` 为基的相对路径；Host `realpath` 后必须位于可信 `sessionCwd` 或 worker `artifactRoot` 内，否则 `E_PREVIEW_DENIED`。
- 只允许 `.png/.jpg/.jpeg/.webp/.gif`，并以**实际文件字节**嗅探 PNG/JPEG/GIF/WebP 签名且与扩展名一致；重命名为 `.png` 的 HTML 返回 `E_PREVIEW_UNSUPPORTED`。
- 大小上限 `maxPreviewBytes`（默认 8 MiB，可配）；目录/非普通文件/不存在/越界分别返回 typed error；不返回绝对 Host 路径，只返回 `fileName/mediaType/size/sha256/dataUrl`。
- Tool 调用 `preview` 被 `E_METHOD` 拒绝；Host 的 `video_engine` Tool 动作列表不包含 preview。
- 不启动 worker；真正的字节读取与校验在 Host 完成后才返回。预览根之外的工程文件/个人文件不会被读取。

### Client

- `.dv-ai` 的 `onClickCapture`：`button[title]`（presented file card 的绝对路径 title、inline mention 的 path title）、`[data-file-path]/[data-path]`、`a[href]`（仅 file:// 或路径类，排除 http/mailto/data/# 等）。
- 命中后 `preventDefault + stopPropagation` 后调用 `hostRequest('preview', …)`；未命中不干预，原生行为保持。
- 显示：右 AI 区域内 `role=dialog` 的局部 panel，`<img>` 使用 data URL；loading/error/close 状态就地显示；Escape/关闭按钮关闭；无第二编辑根、无第三列、无左画布变更。
- 会话切换：`preview.sessionId` 与当前 active Session 不一致时不渲染；迟到结果按 token/当前 session 丢弃；关闭/切换不清项目/会话/草稿。

## 4. 测试与真实链

| 检查 | 结果 | 说明 |
|---|---|---|
| 静态 `scripts/check.mjs` | **41/41** | 新增 P3-006-C 门禁：局部 capture、preview 调用、无 sidebarRight 依赖、Session/工程范围、realpath/字节/限长/错误码 |
| Client smoke `scripts/smoke-client.mjs` | **55/55** | 新增 6 项：文件卡拦截/data URL/关闭、非文件点击不拦截、未支持类型明确文案、Markdown `file://` 链接、切换 Session 迟到丢弃、左工程不替换 |
| Host 契约 `scripts/check-host.mjs` | **34/34** | 新增 3 组：受信 Session/根限制、路径逃逸/任意路径/未支持/字节不符/超限、Tool 不可调用/不启动 worker |
| 版本门禁 | **10/10** | `node scripts/test-stage-version.mjs` |
| 真实 Host→engine | **ok=true** | 证据 `artifacts/p2-b/evidence/engine-run-2026-10-18T04-34-40-779Z.json`：doctor、open、inspect、edit title/timing、frame PNG 279,463 B/`875b48c6…`、render MP4 135,855 B/`fae2687e…`、cancel/dispose、close；跑后 `prepare-fixture` 恢复 demo==fixture `8080d8b0…`，INTEGRITY 未变 |

固定产物：

- 候选 tarball：`artifacts/p2-b/3310280/dsh-video-0.3.0-alpha.2.tgz`，**61,611 B / 20 files / SHA-256 `e375adfdd9f1b808e00932c73867b9ea80f28807740887156c6861151833aa0f`**；解包 20/20 与提交 `3310280` 逐字节一致。
- staging：`artifacts/p2-b/staging-54f4671-3310280`，INTEGRITY SHA **`2825b8a57dbd1b18a45be5dce21423338bf1ee87bd52620979c06bbc0abdde98`**；config `156cdc7a…22e3`，staged patch `ce05311d…1a20`；root `3310280` / engine `54f4671` / bundle `0.3.0-alpha.2` / client/worker `0.1.1`。
- 真实链证据 SHA-256：`85b33c2bd2f6f090ddb6c5ba228ae388d50b1d58c11ad48faa1aad73f40232bf`。

## 5. 未测 / 边界

- **未安装/启停/重启**；无真实 DSH 点击证据，smoke/契约测试不等于安装通过。安装验收按候选复审后授权安排。
- 只支持图片内嵌预览；PDF/Office/视频等返回明确“暂不支持内嵌预览”，不声称所有原生文件类型均可打开。
- 允许根只有 `sessionCwd` 与 worker `artifactRoot`；截图/用户图片不在这些根时会被拒绝，这是有意的安全边界，不通过任意绝对路径扩大范围。
- 不改原生 chat/文件节点、不接管普通对话文件打开；普通对话原生行为未在安装环境复验。
- 未改 engine/p1/spike/全局协调文档；旧 alpha.1 staging（已安装）未覆盖，回滚入口保持。
- C 的 alpha.2 固定包独立保留；P3-008 将另起 alpha.3，不覆盖本包/staging。
