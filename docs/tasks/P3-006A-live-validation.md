# P3-006-A LIVE：具体候选安装与原生创作闭环

日期：2026-10-18。执行：p0-mode-shell，沿用本树/PR#3。依据修复复审通过（协调分支 `docs/reviews/P3-006A-review-02.md`）。**用户已在本主会话明确回复“我授权。完全授权。”（2026-10-18），本指南范围已获授权，可直接执行，无需重复确认。** 通用边界读DEVELOPMENT，不另建tree或重复调查。

> 归档说明：本文件原件位于协调分支 `codex/project-foundation`；本分支保留同一指南作为任务归档，并在文末追加 2026-10-18 的执行记录。

## 固定对象与授权范围

- 功能 `b38268647bd926c205efcb1067a4eaaeecf93cee`，交付 `831d275`；根0.3.0-alpha.1，引擎54f4671/0.1.1。
- 包：同级artifacts/p2-b/b382686/dsh-video-0.3.0-alpha.1.tgz；SHA-256 `61e5743082652bfbd0da01d0a5bbacb6e831b84b72edfa781850cabb969f4a7a`。
- 安装用不可变开发staging：同级artifacts/p2-b/staging-54f4671-b382686/bundle；INTEGRITY SHA-256 `167f4c419dfc9b2da2d33141845fdd433fca3bff5824160ca4c35a0a3f367ab8`。通过Plugin Manager受支持的link路径替换安装，不直接改profile或依赖。不要把无引擎依赖/config的原始根包当成完整部署安装。
- 已授权范围：仅安装/启用及一次停用再启用该插件；创建最多两个专用测试创作会话；在其中发送最多两次明确测试模型请求；修改并恢复此staging自带demo标题。模型沿用用户已配置的可用项，不读密钥，不自动提高权限或批准工具审批。
- 不重启应用、不升级宿主、不动个人会话内容，不改其它插件，不merge。需重启或超出上述范围时停在具体阻塞点。新会话会出现在宿主历史，完成后报告，不擅自删除/归档。

## 按顺序执行，先证实最小接入

1. 安装前记录实际Host版本、当前插件版本/依赖路径/启用状态及原候选回滚入口；不要假定历史记录中的0.2.1仍是当前值。重核新候选摘要、config/patch、可信cwd及sessionStatePath。保留所有旧候选，不覆盖。
2. 安装后核对真正加载版本、文件与注册状态。只读session.diagnose和根data-session属性确认kit/controller/storage可用；若Provider/Factory不匹配、双编辑根或错误绑定，先记录具体错误，停止模型测试，不用假页面补证据。
3. 在受控demo点“开始创作”，核对实际返回id与持久映射。确认右侧原生Composer、模型seat、附件/权限入口可见，左侧仍为真实PNG。创建第二个空测试会话，历史可切换；回到第一个草稿保留，无重复会话/编辑根抢占。不得借个人活跃会话凑测试。
4. 在第一个测试会话发送只读请求：“用video_engine检查demo工程，告诉我当前标题；不要修改。”确认工具身份/工程范围及原生输出。第二个请求只修改该demo的标题为明确测试文字；需要审批时由用户人工处理，不自动批准/改权限。核对真实revision和inspect结果；新PNG必须通过已有刷新路径取得，不能把旧PNG当已同步。测试后用现有受控编辑路径恢复原始标题，不追加第三次模型请求。此旧引擎不验收任意代码生成或多Scene创建。
5. 切换模型只操作该测试Session的原生控件，确认模型选择状态；不要求为了验证再多发请求。原生附件可用任务自有小文件做草稿保留，不假称已导入工程素材库。审批未自然出现则记未测，不制造危险操作来触发。
6. 视频→普通→视频，确认旧编辑根卸载、返回可继续编辑、映射/history/草稿不丢失。视频面板中停用/重新启用，确认安全回退与注册恢复、无旧context残留；不以重启代替清理。核对映射文件未损坏。

## 安全操作、失败与交付

仅用绑定DSH页面/应用的DOM或定向AX操作；不使用全局坐标/键盘、个人剪贴板或抢前台。Host主面板若仍不提供安全通道，给用户短小人工步骤和预期，让用户操作；不可声称自动验证通过。截图只保留专用测试区域并去标识。

严重回归时经已授权的Plugin Manager恢复安装前精确候选并报告；无正常回滚通道时先停测，不直接改profile。API适配问题记录到原任务可复现位置，功能修改另作新提交/候选再审，不悄悄热改已审staging。

允许修改：本任务记录、新docs/research/P3-006A-live-*.md及去标识证据；不改功能/engine/全局记忆。普通commit/push更新PR#3。交付每项PASS/FAIL/未测，含Host身份、安装版本/摘要、测试Session数量、模型请求次数、原生工具执行与revision证据、恢复状态、回滚入口。实际完成哪些就报告哪些；本任务不等于v0.3全体验验收。


## 授权记录

2026-10-18，用户在总调度列明本任务安装/启停、最多两个专用会话与两次模型请求的范围后明确回复：“我授权。完全授权。”此为该具体候选及本任务的执行授权，不再要求重复安装确认；保持既定安全定向操作、原生审批和个人会话保护。开发会话由用户转发交接启动，总调度不自动跨会话发消息。

---

## 执行记录（2026-10-18，p0-mode-shell / PR #3）

**结论：按本指南完成安装、启停、两个专用会话/两次模型请求与标题修改恢复的 live 验证；无功能修改、无 merge。发现一个安装/验证阻塞点和一个安全操作事故，均如实记录。**

### 环境与对象

- Host：DSH Desktop **0.2.1-rc.2**（app asar runtime 同版本），profile `desktop`。安装前 Host 进程 09:55 启动；用户于 11:56:12 授权重启一次以加载新客户端；新 GUI `http://127.0.0.1:64783`。
- 安装：Plugin Manager 受支持 link 替换，`dsh-video **0.3.0-alpha.1**` → `artifacts/p2-b/staging-54f4671-b382686/bundle`；旧 0.2.1 staging 回滚入口保留。
- 候选：tgz **56,648 B / 19 files / SHA-256 `61e57430…969f4a7a`**；staging INTEGRITY **`167f4c41…3f367ab8`**、config `a6b1ca4b…c5fd442`、patch `d8c99661…ab0677c3`；link 客户端 `client.js` SHA-256 `0e1be3b0…`。
- 引擎固定 `54f4671`（client/worker 0.1.1）；根包 `0.3.0-alpha.1`。旧候选/staging/安装目录均未覆盖。

### 阻塞点与例外（必须知悉）

1. **link 安装后 client bundle 不热更新**：Host/worker 新版本已真实生效（`video_engine doctor` 返回新 staging；未绑定 Agent 调 `open` 真机返回 `E_SESSION_NOT_BOUND`），但页面仍渲染 0.2.1 客户端。页面重载、强制刷新（禁用缓存）、一次停用→启用、touch `client.js` 后仍为旧 UI。判断为 Host `client-modules` 对已加载 link 包保持启动时 client bundle 记录；需完整重启应用重新组装。已在阻塞点停下报告；用户明确授权并手动重启（11:56），之后 0.3.0-alpha.1 新 UI 生效。**未以重启代替清理；此后未再重启。**
2. **误投递事故**：11:50 一次全局点击/键盘序列落在当时 frontmost 的企业微信，误发测试文本 `1+1` 到一个外部工作会话（不记录名称/内容）；立即停止全局输入，未操作该应用撤回/覆盖用户内容；用户已处理。后续 UI 操作只用定向 AX + Edit 菜单粘贴（粘贴前后保存/恢复剪贴板纯文本，富文本保真不保证）。事故不影响本任务测试数据，但按 DEVELOPMENT 边界如实记录。

### 结果

| 项 | 结果 | 证据/说明 |
|---|---|---|
| 安装/启用/注册 | **PASS** | Plugin Manager link、enabled；重启后 main `dsh-video` occupant + sidebar order 30 + 私有 `dsh-video.chat`（single/session）slot 均可见 |
| 原生布局/Composer/模型 seat/权限入口 | **PASS** | 左真实 PNG + 右常驻 AI；原生 Composer、模型 seat、权限入口、附件入口、发送/Stop 控件；无宿主 Header/双编辑根 |
| 创建会话与持久映射 | **PASS** | 专用会话 **2/2**；mapping 恰 2 个 id、active=session1；重开工程未重复建会话 |
| 第二个空会话 + 历史切换 | **PASS** | 创作1/创作2 可切换；切回后会话内容保留 |
| 草稿保留 | **PASS** | 未发送草稿切到会话2再切回仍在；随后清空 |
| 第 1 次模型请求（只读） | **PASS** | `video_engine inspect`；revision `135a529f…294c85` 不变；标题 `让创意成为影像`；无写 |
| 第 2 次模型请求（改标题+刷新） | **PASS** | edit `p3-006-a-title-rename-001` revision→`90e521e4…9d03`；frame job `099b5b47…`；PNG 280,753 B/`d12e40f4…`；复核 inspect title=`P3-006-A 真机测试标题`；原生交付卡 |
| 恢复标题 | **PASS** | 左侧标题字段+保存修改（受控编辑路径）；再按文档用 staging `npm run prepare-fixture`（保留 browserPath）归一化：demo==fixture `8080d8b0…`、无测试标题、INTEGRITY 未变；无第三次模型请求 |
| 模型 seat 切换 | **PASS** | 原生菜单 9 个模型；MiniMax-M3 切换后恢复 DeepSeek-V4.1-Flash；推理级别 Off/Low/High/Max，最终 Max；切换不发请求 |
| 视频→普通→视频 | **PASS** | 返回对话再进视频；历史/草稿继续；无重复会话/编辑根 |
| 停用→重新启用 | **PASS** | 停用后 main occupant 移除；启用后注册、child slot、tool 恢复；mapping 未损坏仍 2 个会话；工程需显式重开、不重复建会话 |
| 审批 | **未测** | profile policy `never`/full access，未自然出现审批；未制造危险操作 |
| 附件 | **未测** | 入口可见，未实际导入 |
| `session.diagnose`/根 data-session 直读 | **未直接观测** | 无 DOM 读取通道；以私有 child slot、实际会话/映射行为替代，不声称单独验证 |
| MP4 导出 | **未测**（本轮范围外） | 按钮存在，未执行 |
| 多 Scene/任意代码 | **未测** | 旧引擎明确不在本任务验收范围 |

### 计数与证据

- 专用测试会话 **2/2**；模型请求 **2/2**；无个人会话、无额外请求。会话日志：session1 2 turns/17 steps，session2 0 turns；模型均为用户已配置 `deepseek-account/deepseek-flash`（seat 事件另记，不发请求）。
- 本地证据目录 `artifacts/p2-b/evidence/p3-006a-live/`：`live-state.json` 19,300 B/`e0feb47b…`；`session-evidence.json` 17,678 B/`2fa78806…`；`frame-after-title-edit-099b5b47.png` 280,753 B/`d12e40f4…`；去标识 UI 截图 `ui-title-edit.png` `6e3be643…`、`ui-title-restored.png` `c8d3a988…`、`ui-model-switched.png` `df8a2269…`、`ui-draft-retained.png` `797054d3…`。原始会话转写留在 DSH session store，未复制进仓库。
- mapping SHA `d5d9ba07…`；staging INTEGRITY 复核未变 `167f4c41…`；demo 最终 `8080d8b0…`；registry browserPath 保持 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。

### 回滚与边界

- 回滚入口：Plugin Manager remove `dsh-video` 后 `install_bundle` link 到 `artifacts/p2-b/staging-54f4671-bdcfd72/bundle`（0.2.1）；不直接改 profile。
- 未 merge；未改功能/engine/全局记忆；仅新增/更新本任务记录与证据文档。**本任务不等于 v0.3 全体验收。**
- 详细时间线、数据与哈希见 [P3-006-A live 真机验收证据](../research/P3-006A-live-2026-10-18.md)。
