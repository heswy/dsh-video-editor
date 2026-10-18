> 当前状态：2026-10-18 调查验收通过，不再重复本任务。下一实现任务P3-006-A；独立澄清见 [评审](../reviews/P3-005A-review-01.md)。

# P3-005-A：原生 AI 对话、历史、模型与素材接入契约

日期：2026-10-18。执行：**p0-mode-shell**；分支 `dsh/p0-mode-shell` / PR #3；开工 head `b204760`。沿用现有树，先报告实际HEAD/工作状态。P2-007已通过，见 [复审](../reviews/P2-007-review-01.md)。

> 本文件由 p0-mode-shell 从协调分支存档，并在下方追加开发记录。本轮开工 HEAD 即声明的 `b204760`，工作树干净；`git fetch origin` 曾因网络错误失败，使用本地缓存的协调提交 `920957d6401b6aa1253b81af48eb91d4d8ec7e72`（2026-10-18 10:01:39 +0800，含本任务指南）读取，未切换分支、未 reset。

## 目标

为已确认的v0.3界面核实可实施路线：左边直接编辑、右边持续AI对话，历史会话、DSH模型选择、用户素材；不做底部场景卡片，不让属性栏替代AI。本任务是**只读调查与精确接入提案**，不安装，不实现最终界面。通用规则读协调分支DEVELOPMENT，产品/设计读最新版本。

## 范围与固定依赖

允许交付：本任务开发记录、`docs/research/P3-005A-*.md`，必要的只读提取/检查脚本可放 `spikes/dsh-native-conversation/**`。不改client.js、host/**、engine包、manifest/patch/profile、全局记忆，不新建tree/PR，不merge，不启停/重启，不调用模型，不创建/编辑用户会话或发送消息。包内文档/源码和定向的只读服务/Slot inspection可以用；不要枚举个人对话正文、凭据或模型密钥。

引擎固定参考已审 **df4b74f（head e364017），client/worker 0.2.1**，仅只读；这不授权现在切换staging引擎。现有stage脚本固定旧引擎0.1.1是上轮受控候选契约，正式接线时另行更新。

## 必须回答

1. **版本与官方依据**：核对当前运行Host身份与本机应用包版本；两者分开。现有rc.2随包线索见 [初步调查](../research/2026-10-17-conversation-embedding-v03.md)。检查匹配版本官方skill与精确exports；不从旧rc.1结论推导新API。
2. **嵌入原生会话**：给出SessionProvider显式SessionReference、Conversation Factory/local positions的实际可调用形态、标准props/依赖、Chat/Composer挂载与释放路径、manifest external要求。main默认无Session binding，如何在本panel明确绑定？能否保留原生权限/审批/附件/Stop/流式消息，而不渲染宿主主header？不得复制宿主DOM或iframe整页DSH。
3. **工程↔创作会话**：一工程多会话、一会话一个工程的关联由谁持久化？创建/列举/恢复/关闭/retention的受支持API是什么？工程切换和会话历史选择不应修改宿主当前普通会话或回滚工程；历史按工程过滤。草稿、滚动、运行中请求、HMR、插件停用的边界如何维护？同一Session不挂两个编辑根。
4. **模型与推理强度**：原生Composer模型seat能否随绑定Session直接复用？精确列出目录订阅、selectModel和权限前提、下次请求生效规则、缺模型/无配置/不可写状态；不读取或持久化第二套密钥，不枚举用户模型作为研究附件。
5. **AI工具与工程上下文**：原生Agent如何获当前工程/revision/Scene/stableId/素材引用，以及已审VideoBridge共用Tool？项目范围授权如何防止历史会话操作另一工程？审批交互在嵌入位置是否可见？不接受“调用现有Tool自然就有正确工程”这种未验证假设。
6. **素材统一入口**：原生附件的receipt/授权字节如何转成工程自有副本/assetId，而不是把临时URL或任意本机path交worker？画布素材导入与AI附件如何区分“用于作品/仅作参考/发送给模型”？核实DSH现有文件picker/流式upload能力；先可验收PNG/JPEG，SVG/视频/音频只记目标与缺口，不冒充支持。
7. **落地拆分**：给出正式Host/UI接线白名单、依赖顺序与可验证的最小闭环、预期失败码、所需用户授权。若原生嵌入受限，具体指出缺少哪项能力和最小替代，不先重写聊天平台。

## 交付与验收

提案含精确版本、来源路径/符号与必要短摘录、最小调用骨架（标示未经live验证）、工程/Session生命周期表、文件范围与未决问题。事实/推断/建议/未测分开；仅源码不能报真机通过。

普通commit/push更新PR#3，由用户交回总调度。总调度审后与p1-engine的P3-005-B结果一起冻结正式画布/AI接线任务。此调查不会自动放行安装或根代码实现。

## 开发记录（p0-mode-shell）

- **开工**：2026-10-18 10:02（Asia/Shanghai）。`git fetch origin` 失败（LibreSSL SSL_ERROR_SYSCALL），按规则使用本地缓存的协调提交 `920957d6401b6aa1253b81af48eb91d4d8ec7e72`（2026-10-18 10:01:39 +0800，含本任务指南与 handoff）读取；未切换分支、未 reset。实际 HEAD `b204760`，工作树干净，与 `origin/dsh/p0-mode-shell` 一致。
- **Host/应用包身份**：应用包 `0.2.1-rc.2`（`Info.plist` 与 `app.asar/dsh/package.json` 一致）；本会话由运行中的 Desktop Host 提供（主进程 9:55 启动、`DSH_PROFILE=desktop`、`DSH_WEB_URL=http://127.0.0.1:49700` 与当前 GUI URL 一致），live Inspect 查询均来自该运行 Host/Client。官方 skill `cordis-plugin-development`（随包同版本）已读，作为 UI/模块边界依据。
- **交付**：只读调查记录 [P3-005A-native-conversation-contract](../research/P3-005A-native-conversation-contract.md)；只读 ASAR 解析/检索工具 [spikes/dsh-native-conversation/asar-read.mjs](../../spikes/dsh-native-conversation/asar-read.mjs)（不执行包内代码、不写 app 包/profile）。**未改** `client.js`、`host/**`、引擎包、manifest/patch/profile、其它树；未安装/启停/重启、未 merge、未创建或编辑会话、未发消息、未调模型、未读密钥。
- **关键结论（详见研究记录）**：①`conversation.content` Factory 可被 `main` panel 的 slot kit（`renderFactorySlot` + 声明 session child 后获得的 `SessionProvider`/`renderSlot`）嵌入；`variant:"embedded"` 不渲染宿主主 Header/宽把手，Composer/模型 seat/审批 takeover/附件/Stop 由原生链保留。②显式绑定用 `ctx.sessions.retain(id,{source})` 的 `SessionReference` + `SessionProvider session={reference}`；source 用插件自有名，禁止冒用 `mainView`。③工程↔会话无宿主 metadata，映射必须由 Video Host 持久化；可用 `ctx.sessions.create()` 不导航地创建会话，标题用 projection `title`/rename。④模型选择原生复用、下一次请求生效，不需要插件接线。⑤Tool 可用 `exec.agent.id` + Host `sessionId→projectId` 校验工程范围；工程上下文适合 `agent.ctx.systemPrompt.context`。⑥素材：原生图片 PNG/JPEG/WebP/GIF，文件 verbatim；AI 附件→工程资产需插件 Host 受控导入（receipt/session 授权 → 工程副本）；SVG/视频/音频是明确缺口；无宿主原生文件选择器，插件需自建 input。
- **补充复核**：并行的源码侧只读复核补强了若干边界并已并入研究记录——私有 child key 不能复用已声明槽（运行时 throw）；`SessionProvider` 的显式 `session={undefined}` 绑定 absent 且 absent 渲染 `empty` 分支；`hero:true` 会经 workspace chip 调 `openWorkspace` 导航宿主；`variant` 只改 CSS；同一 Session 双 occurrence 会通过 Lexical `setRootElement` 抢占编辑根且无守卫；`external` 只影响到达顺序、不参与 `require` 解析；`ctx.sessions.create`/`connectWorkspace` 不导航，`startSession`/`openWorkspace` 会导航。
- **未决/未测**：`main` kit 在真实注册下的实际 props、create 后会话在宿主侧栏/搜索的可见性、receipt 生命周期、VideoBridge 审批接线、HMR/停用/重连与真机视觉均未验证（本轮禁止）；工程会话是否出现在宿主历史、是否建独立 Workspace、审批期间 Stop 被隐藏的产品决策待总调度。
- **提交**：本轮文档与只读探针提交见 PR #3 最新 head（`docs: investigate native conversation, model and asset contracts`），未新建树/PR。
