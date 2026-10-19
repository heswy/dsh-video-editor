# P3-006-C：修复嵌入会话的图片/文件打开

日期：2026-10-18。执行：p0-mode-shell，沿用本树/PR#3，交付基线2cd718a、功能基线b382686。依据 LIVE 复核（协调分支 `docs/reviews/P3-006A-live-review-01.md`）。开工fetch读取当前协调记忆，不merge或重建tree。目标为实际修复候选，不单交调查。

> 归档说明：本文件原件位于协调分支 `codex/project-foundation`；本分支保留同一指南作为任务归档，并在文末追加 2026-10-18 的执行记录。

## 交付目标与范围

用户点击视频AI会话中的PNG文件卡或本地图片链接，能够看到正确图片并关闭返回，保持左工程预览、右AI、Session和未发送草稿。当前“sidebarRight: no session surface is mounted”错误必须消失；不要导航到普通对话作为默认打开路径，也不常驻第三列。

允许client.js、index.js、host/**、必要manifest/locale/check/smoke/Host测试、README和本任务/对应research/去标识证据。根版本0.3.0-alpha.2；engine仍固定54f4671/0.1.1，不提前采用未审4c087ef，不改p1-engine包或spike。不改全局文档，不merge。旧已安装staging完全保留，产物放新功能提交目录。

## 实现要求

- 优先使用本机Host支持的会话资源/渲染扩展接通局部预览；必要时插件自有按需轻量预览层，图片不变成第二份工程。不能只挂rightbar.session却仍让全局controller在视频面板中报错。
- 局部动作必须绑定当前owned SessionReference/已登记project，切换会话/离开面板后撤销旧预览及异步结果，不偷换普通主会话。文件卡和Markdown本地图片链接两种入口都覆盖；若资源无权限/不存在，显示简短准确错误，不弹内部堆栈或宿主surface错误。
- 不猴补ctx.sidebarRight全局服务、不修改ASAR，不在全局替换原生chat/文件节点，不绕过唯一编辑根/伪装mainView，不用全局DOM监听或坐标点击接管宿主。新增读取/字节路由要检查本会话文件归属/receipt或受控产物记录，不能为修预览开放任意绝对路径读取；URL只用受控路由，不把file://或磁盘绝对路径直接当浏览器图片URL。
- 如需能力降级，必须在本任务内实现真实可用的图片打开路径，并明确未支持文件类型；不能留下看起来可点击却必报错的PNG交付卡，也不能把打开外部应用当唯一验收。不能声称所有原生文件类型均已支持。
- 原生AI保留当前模型/权限/草稿。上下文准确说明当前安装引擎能力和工程事实：不把后期调色副产物当工程已改，不主动引导直接写工程文件绕过受控写入口；缺少换色能力简短说明即可。提示词是行为引导，不得宣称它构成OS沙箱。

## 验证与交付

先复现当前surface错误，补正式回归：视频面板点受控PNG文件卡、本地图片链接、预览关闭、历史快速切换/迟到结果、无权/丢失文件、卸载与普通对话原文件打开共存。所有scope测试用任务fixture；不复制个人文件或对话。测试+新包/staging/完整摘要一次交回，更新PR#3。代码候选复审前不替换安装/重启/再次调用模型。

可复用现有两个专用测试会话里已经生成的合法图片，不自动新建会话或发请求来凑素材。当前用户的黄色调预览也不擅自删除/修改。真实安装验证等具体候选复审通过后安排；不把本地回归当真机点击通过。

业务和安全边界：不使用全局键盘/坐标、个人剪贴板或抢前台，即便前台暂时是DSH也不能使用。定向能力不足，给用户短人工步骤，不再重复事故。不得对已供用户使用的demo运行prepare-fixture，不能把恢复测试内容扩大成重置后续用户编辑。

---

## 执行记录（2026-10-18，p0-mode-shell / PR #3）

**结论：交付可工作的嵌入会话图片预览候选 `0.3.0-alpha.2`，独立提交 `3310280`；未安装、未重启、未调用模型、未改用户数据。**

### 根因与修复方式

- 宿主全局 `sidebarRight` 只在普通 Conversation 主面板（`activePanelId === null`）挂载会话 surface；全局视频主面板下 `ctx.sidebarRight.openResource` 由原生 chat 文件卡/链接调用时会抛 `sidebarRight: no session surface is mounted`。
- 未猴补全局服务、未改 ASAR、未替换原生 chat/文件节点、未占第三列：在插件自有嵌入 AI 区域（`.dv-ai`）用局部捕获识别原生文件卡/mention 的 `button[title]` 路径与 Markdown 文件链接 `a[href]`，拦截后在插件自有 dialog 中显示图片；其余点击保持宿主原生行为。捕获只限本面板 subtree，非全局 DOM 监听。
- Host 新增受信 `preview` 方法（仅 UI Fetch，Tool 不能调用）：必须带已登记 `sessionId` 与工程 id，用持久映射校验工程归属；`file://`/绝对/相对路径经 `realpath` 后只允许落在受信 `sessionCwd` 或 worker `artifactRoot`；拒绝目录逃逸与任意绝对路径；按实际字节嗅探 PNG/JPEG/GIF/WebP 且核对扩展名；`maxPreviewBytes`（默认 8 MiB）限长；返回有界 data URL，不返回 Host 绝对路径。不支持类型返回 `E_PREVIEW_UNSUPPORTED` 并在 UI 显示明确文案。
- 会话切换期间迟到的 preview 结果按 token + 当前 session 丢弃；关闭/卸载不导航、不清左工程/右会话/未发送草稿。

### 验证

| 项 | 结果 | 证据 |
|---|---|---|
| 静态检查 | **41/41** | `npm run check` 首段；含新增 P3-006-C 静态门禁 |
| Client smoke | **55/55** | 新增：文件卡局部拦截、preview data URL 显示/关闭、非文件点击不拦截、未支持类型明确错误、Markdown `file://` 链接、切换 Session 后迟到结果丢弃、左工程不替换 |
| Host 契约 | **34/34** | 新增：受信 Session/工程归属、artifactRoot/sessionCwd 根限制、目录逃逸/任意绝对路径拒绝、magic byte/扩展名不符拒绝、超限、Tool 不可调用、preview 不启动 worker |
| 版本门禁 | **10/10** | `node scripts/test-stage-version.mjs` |
| 固定候选 | `dsh-video-0.3.0-alpha.2.tgz`：**61,611 B / 20 files / SHA-256 `e375adfd…3aa0f`** | `artifacts/p2-b/3310280/`；20/20 与提交 3310280 逐字节一致 |
| 新 staging | `artifacts/p2-b/staging-54f4671-3310280`；INTEGRITY `2825b8a5…de98`、config `156cdc7a…22e3`、patch `ce05311d…1a20` | root 3310280 / engine 54f4671 / bundle 0.3.0-alpha.2 / client/worker 0.1.1 |
| 真实 Host→engine 链 | **ok=true**：doctor、open、inspect、edit title/timing、frame PNG 279,463 B/`875b48c6…`、render MP4 135,855 B/`fae2687e…`、cancel/dispose、close | `artifacts/p2-b/evidence/engine-run-2026-10-18T04-34-40-779Z.json`，SHA-256 `85b33c2b…32bf`；跑后用 staging `prepare-fixture` 恢复 demo==fixture `8080d8b0…`，INTEGRITY 未变 |

### 范围限制与未测

- 未安装/启停/重启（按 handoff；安装验收等候选复审）；无真实 DSH 点击证据，不能把 smoke/契约测试当安装通过。
- 仅图片内嵌预览；PDF/Office/视频等显示“暂不支持内嵌预览”，未声称所有原生文件类型可用。
- 预览读取根限定 `sessionCwd` 与 worker `artifactRoot`；其它合法工作区路径（如工程目录内图片）不属于本版允许范围，需后续显式授权/接口。
- 不改右栏/普通会话原生行为；普通对话中原文件打开不受影响（未安装验证）。
- 未 merge；未改 engine/spike/全局文档；旧已安装 staging 未动，回滚入口不变。

详细根因、接口与证据见 [P3-006-C 交付证据](../research/P3-006C-embedded-file-preview.md)。
