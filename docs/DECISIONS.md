# 项目决策

状态：accepted 为已采纳，proposed 为待验证；变更通过新增替代记录保留原因。

## 当前有效索引（先读）

- 调度/称呼/目录：D025、D026；替代 D017 当前人员安排和 D014 旧称呼/旧路径。
- 产品：D011 侧栏入口；D012 克制；D027 + D028 确认 v0.3，取消场景卡片。旧顶部切换、右属性表单与常驻资源列不是现目标。
- 引擎/协议：ADR-0001、ADR-0002、D020–D022；受控模板，不等于任意代码沙箱。
- 预览：D024 的快照/资产路由/隔离画布路线保留；右侧目标同步的具体表单表达由 v0.3 的直接编辑/AI 上下文替代。
- Git：D016，正常 feature push/草稿 PR；不自动 merge、安装或发布。
- 版本事实读 STATUS。D003/D013 是历史 Host 证据范围，不代表今天仍运行该版本；D005 的可行性已由后续评审推进，不能据旧 proposed 判断没有引擎。

以下按历史顺序保留决策原文；“accepted”不代表不受后续替代记录影响。

| ID / 日期 | 决定 | 状态与理由 |
|---|---|---|
| D001 / 2026-10-17 | Codex 管产品/架构/任务/评审，用户指定 DSH Agent 实现/验证/修复 | accepted；遵循用户个人开发工作流 |
| D002 / 2026-10-17 | 顶部「普通｜视频」作为主入口，模式是工作区视图而非 Agent preset | superseded by D011；保留历史来源与验证 |
| D003 / 2026-10-17 | 当前以本机 Desktop 0.2.0-rc.2 及其官方内置 Skill 为宿主基线 | accepted；先前 master 调研不作为当前 API 契约 |
| D004 / 2026-10-17 | 原生 Slot 工作区，主题控件；不把整页编辑器做成独立 iframe 应用 | accepted；匹配宿主规范；视频画布隔离方式仍待验证 |
| D005 / 2026-10-17 | 优先验证 HyperFrames；UI/Tool 共享 Host 写入入口，内容权威来源唯一 | proposed；通过 P1 编辑/持久化/渲染验证后冻结接口 |
| D006 / 2026-10-17 | DSH 分支 dsh/p0-mode-shell；Codex 建立与维护同级独立 worktree；首轮不授权安装或 push | accepted；固定基线与职责，避免影响正在使用的 Desktop profile |
| D007 / 2026-10-17 | 用户要求精致、优美、优雅及丰富动效，考虑液态玻璃 | accepted（偏好）；具体「玻璃上的剪辑台」设计和数值为 proposed，见 design/FRONTEND-DESIGN.md；不覆盖原生主题、可读性与精确编辑 |
| D008 / 2026-10-17 | 首版顶部切换采用靠左原生入口，居中后续优化；不在其它全局面板常驻 | superseded by D011；原靠左实现保留为历史证据 |
| D009 / 2026-10-17 | P0-B 用插件级内存保留跨面板界面状态；只对简化效果等已有 UI 偏好使用带版本的浏览器持久化 | accepted；不记住 activePanel 自动抢导航，不在 localStorage 放工程、媒体或提示词。持久化失败退回内存并告知限制，不影响模式切换 |
| D010 / 2026-10-17 | 工程内容 Host 权威持久化归 P1 验证、P2 固化；P0-B 无工程创建/保存能力 | accepted；解决 D-D，不提前选未验证 storageDomain API；跨刷新恢复项目不由 P0-B 承诺 |

历史待决（立项时）：顶部 Slot、视图保持、宿主依赖和通信、引擎版本及预览隔离；后续已有阶段结论，当前未验证关口以 STATUS 为准。

2026-10-17 引擎路线：[ADR-0001](adr/0001-independent-video-worker.md) 接受独立 Node worker + stdio 协议作为实施路线。P1 单 Scene 验证采用 HyperFrames 0.8.167，尚不承诺其他版本兼容；DSH 接入及任意代码执行隔离另行验证。

2026-10-17 并行决定：用户已同意加速并行开发。DSH 拥有 P0 宿主/UI 文件；新 Codex 开发会话拥有 `spikes/hyperframes/**` 与 P1-001 记录；主会话继续架构、协调和验收。两边独立 worktree，无共享代码写入区域，接入契约由 P1 提议、主会话评审后冻结。

2026-10-17 D011 / accepted：用户明确改为左侧导航「上下文洞察」之后、「工作区」之前的 **Vedio Editor** + 细线条视频图标；移除两处顶部胶囊。替代 D002/D008 的入口位置与形态，保留原生 Slot、宿主导航状态和会话保持原则。精确位置先核对运行时支持。

2026-10-17 D012 / accepted：UI 简洁克制、信息层级清楚；空状态只保留一句状态，开发说明和未来能力留文档，玻璃与动效作为适量点缀。以用户最新反馈替代 v0.1 中过重的空页面表达。

2026-10-17 D013 / accepted：用户侧已升级 Desktop 至 0.2.1-rc.1，P0-006 核心侧栏/主面板证据以此版本为准。后续 Host 接入基线改为当前实际版本；D003 的 0.2.0-rc.2 保留历史，不能据其旧归档直接断言新版本 Host API。升级非本轮 Agent 操作，P2-002-A 先核对变更。

2026-10-17 D014 / accepted：用户固定称呼程序员 1（dsh-video-editor，DeepSeek 接手原 Codex 的 b4bf 引擎/通信线）与程序员 2（p0-mode-shell，原 DeepSeek 插件/Host 线）。工作树与历史分支沿用，原 Codex 不同时写入；主会话继续协调/评审，任务边界不因更换模型自动扩展。

2026-10-17 D015 / accepted：采用 [ADR-0002](adr/0002-host-bridge-runtime-and-boundaries.md) 的真实 Node 配置与显式 env/cwd、单 VideoBridge/Fetch/Tool、受控 allowlist/job 归属和开发 staging 路线。程序员 1 做 P2-003 包能力，程序员 2 做 P2-002-B 根宿主接入；仅本地实现，安装授权仍单独决定。

2026-10-17 D016 / accepted：用户授权正常 feature 分支持续 commit/push 与草稿 PR 流程，替代旧任务的 local-only/no-push 限制；不等于自动 merge main、发布或替换真实安装。主会话协调基础文档与评审，两程序员维护各自分支和 PR；不清理未提交工作。

2026-10-17 D017 / accepted：总调度由原 Codex 主会话交接给 DSH 继任会话；两个程序员会话、工作区、分支与草稿 PR 不变，交接由用户粘贴转发。既有分支/worktree/任务/评审记录延续，不重置、不重开；历史 Codex 提交与文档保留。

2026-10-17 D018 / proposed：P3 首版由 DSH Agent 通过 Tool 驱动创作，插件不内置模型凭据；内容为受模板约束的 Code-as-Video（HTML + GSAP + 稳定 ID），任意 Agent 代码安全隔离后置；人工与 AI 共用 Host 写入入口，写入带 `expectedRevision` + `actor`，冲突显式返回不静默覆盖。待 P3-001 spike 与契约评审后确认。

2026-10-17 D019 / accepted：用户授权并完成 `dsh-video 0.2.0` 真机安装——卸载 0.1.3 后以 Plugin Manager link 指向 clean staging（root `fa7b0e2` + engine `54f4671`）；回滚保留 0.1.3 固定包与解包目录，main 不合并。安装后真机验收按 [P2-004-live-acceptance](research/P2-004-live-acceptance.md) 清单继续，未通过前不宣称 P2 完成。
2026-10-17 D020 / accepted：P3 多 Scene 采用 **B 结构**（单 HTML 文档 + Scene 区段 + 单一 master timeline），Scene 局部时间生成时换算全局时间；Scene 结构变化走受控整文件重写 + SDK 校验 + 原子写 + revision 重算；元素级人工/AI 修改走 stableId 三方合并，冲突显式返回（`BOTH_MODIFIED` 等），不静默覆盖。依据 [P3-001 复审](reviews/P3-001-review-01.md)。
2026-10-17 D021 / accepted：revision 保持内容哈希定义；undo/redo 恢复旧内容时 revision 可回到旧值，历史以 `.dsh-video/history/` 的 entries/ops/snapshots + 单调 `historyCursor` 表示且不进 revision；不要求“撤销产生新 revision”。
2026-10-17 D022 / accepted：工程创建采用 worker 管理 `projectsRoot` + 持久 registry + `project.create`（原子写、启动 reload、路径包含、单写者）；Host 不直接改 worker 文件，Host 重启 worker 为回退。v1 工程生成受模板约束（非任意 HTML/JS），任意 Agent 代码隔离另立任务。

2026-10-17 D023 / accepted：编辑器画布 v1（sandbox iframe + 播放/暂停/seek + 画布点击选中 + 选中描边 + 右侧目标联动）排在 P3-004 之前；依赖 engine snapshot 与 Host 精确资产路由，P3-003 的合并 Phase B 可与画布并行。未接入实时画布前，PNG 画布不伪装可点选，右侧目标下拉是唯一选中入口。依据用户 2026-10-17 画布要求。

2026-10-17 D024 / accepted：编辑器画布采用 A1 架构——worker 受控 `preview.snapshot`（entry+声明资产、只读、TTL、不进 revision）+ Host 精确资产路由（只认 snapshotId/声明路径，不接收任意 path/URL）+ Client sandbox iframe（播放/暂停/seek、画布点选、选中描边、目标联动）。任务编号相应调整为：P3-004 引擎预览快照、P3-005 编辑器画布、P3-006 插件创作流程/AI 上下文/冲突 UI、P3-007 端到端 15 秒样例验收；D023 中「P3-004」指插件创作 UI，按新编号为 P3-006。

2026-10-17 D025 / accepted：用户重新指定当前 Codex 主会话为总调度，替代 D017 的当前人员安排，历史交接记录保留。用户授权恢复程序员 1 工作树到同级 `dsh-video-editor-worktrees/p1-engine`，与程序员 2 的 `p0-mode-shell` 并列；沿用 `codex/p1-engine-spike-b4bf` 与 `aae05e9`，不新开开发线、不改变任务与 PR #2。归档 snapshot 与该提交一致，无额外跟踪文件差异；依赖重新按锁文件安装且禁用安装脚本，旧忽略产物不宣称已恢复。

2026-10-17 D026 / accepted：按用户要求取消“程序员 1/2”的当前称呼，开发会话直接以工作区名 `p1-engine`、`p0-mode-shell` 识别；未来新增工作树同样按树名识别。历史记录、分支与既有交接文件名保留，不因更名重开开发线。

2026-10-17 D027 / accepted（交互要求）+ proposed（布局）：用户要求回到 AI 创作核心，右侧持续对话、历史会话与宿主模型选择，左侧播放并直接选中/就地编辑，支持用户素材；替代右侧目标下拉+表单主路径。v0.3 提案为左画布+底部场景条/右 AI 常驻，素材从左上抽屉按需展开；对话历史与工程版本历史分离，一工程多创作会话；布局与关系待用户看图确认。示意图为生成概念图，非真机证据。P3-004 快照继续；P3-005 暂不按旧属性栏路线下发，先核对原生 Conversation/SessionProvider/模型复用契约。

2026-10-17 D028 / accepted：用户看 v0.3 示意图后明确移除底部场景缩略卡片带，其余设计确认。画面下仅保留轻量播放控制和连续进度条，更多空间给预览；多 Scene 仍为工程内部结构，不要求用户通过卡片列表才能编辑。D027 中布局待确认状态由本决定收敛，场景条方案被替代。概念图保留为移除前讨论证据，不作为后续照搬依据。

2026-10-18 D029 / accepted：P3-004的df4b74f及e364017记录在受控本机范围验收，两包0.2.1、22方法schema、快照与registry恢复。preview.release未知/重复返回E_SNAPSHOT_NOT_FOUND，清理效果幂等；Host后续按登记/TTL判断有效，不凭磁盘存在。P2-007的8c6bf26/b204760通过，P2-006交付R1关闭；0.2.2可作受控候选但未授权本轮安装。下一阶段拆P3-005-A原生会话/模型/素材契约（p0-mode-shell）、P3-005-B受控画布播放/直接编辑写回验证（p1-engine），按白名单并行，待用户转发启动；不直接开发旧右侧表单或场景卡片。
