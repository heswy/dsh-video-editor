# 当前项目状态

更新：2026-10-18（Asia/Shanghai）。总调度为当前 Codex 主会话；开发会话以工作区名识别。这里仅保存当前状态，历史见 [STATUS-HISTORY](STATUS-HISTORY.md)。

## 产品基线：v0.3 已确认

- 核心目标：用户持续和 AI 对话创建、打磨同一份可编辑视频；人工修改后 AI 继续编辑，保存重开、导出 MP4。
- 左侧大画布：播放/暂停/定位、直接选中、原位编辑和就近浮动工具。右侧始终为 AI 对话，支持历史会话与宿主模型选择。
- 素材从左上按需展开，允许用户导入；AI 附件与工程素材共用资产归属，但不自动发送全部素材给模型。
- **不做底部场景缩略卡片带，不用右侧目标下拉+属性表单作为主路径，不常驻第三列。** 多 Scene 保留为工程结构。
- 导航保持原生 **Vedio Editor**（用户指定拼写）；UI 简洁、精致、克制。
- [PRODUCT](product/PRODUCT.md) 是产品约定，[FRONTEND-DESIGN](design/FRONTEND-DESIGN.md) 是交互设计。概念图保留移除场景卡片前版本，仅作讨论证据。

## 实现、安装、验证分别记录

| 层级 | 当前事实 | 证据 / 限制 |
|---|---|---|
| 本机应用包 | 只读 app.asar 的 dsh/package.json 为 **0.2.1-rc.2** | [对话复用调查](research/2026-10-17-conversation-embedding-v03.md)；P3-005-A交付了rc.2运行身份/live查询证据，总调度独立核包源码；嵌入已在LIVE有证据且用户实测发现文件预览缺陷，旧rc.1证据保持历史口径 |
| 最近确认的安装 | 根插件 **0.3.0-alpha.1**，link→`staging-54f4671-b382686/bundle`；引擎54f4671/0.1.1 | 用户截图与p0真机交付2cd718a；[LIVE复核](reviews/P3-006A-live-review-01.md)：原生会话/历史/标题写入有证据，**图片文件打开FAIL**；本轮未再读profile或操作GUI。旧0.2.1回滚保留 |
| 插件最新交付 | **0.3.0-alpha.1**，原生接线 `26bd4c1`、修复 `b382686`、LIVE head `2cd718a` | [修复复审](reviews/P3-006A-review-02.md) **通过，R1–R4关闭**；独立123/123+版本10/10、四场景探针及包19/19/staging摘要通过；**已按交付记录安装；文件预览缺陷待修**，基础会话链有真机证据。旧候选保留 |
| 引擎已验收 | 两包 **0.2.1**，已审功能 `df4b74f`、head `e364017`；保留多Scene/合并/历史，新增完整schema和预览快照 | [P3-004复审](reviews/P3-004-review-01.md) 通过；worker29/29、real10/10、client18+1skip，固定包3/3+13/13一致；限本机受控范围 |
| 引擎最新候选 | 两包 **0.3.0**，功能 `4c087ef`、head `fcb090f` | [P3-006-B复审](reviews/P3-006B-review-01.md) **需修复R1–R2**：旧base显式覆盖意图与首次marker迁移有丢失；暂不冻结为画布接线基线。既有MP4黑带登记BUG-001 |
| 新产品体验 | 右侧原生 AI、历史、模型；左侧实时直接编辑；工程素材库 | 设计已确认，**尚未整体实现或验收**；不能把底层方法存在当成用户闭环完成 |

## 工作区与当前任务

工作树绝对路径和通用规则只维护在 [DEVELOPMENT](DEVELOPMENT.md)。三棵树规划保持，本轮fetch成功并核对p0-mode-shell交付2cd718a（本轮读取交付记录）；本轮另核对p1-engine交付fcb090f后干净（P3-006-B需修复）；开发树不需要新建或重建。

| 工作区 | 分支 / PR | 最近功能交付 | 当前动作 |
|---|---|---|---|
| 主工作区（总调度） | `codex/project-foundation` / [#1](https://github.com/heswy/dsh-video-editor/pull/1) | 当前产品、规则、评审、交接 | A/B调查与spike均已验收；P3-006-A已安装，原生文件预览FAIL，转P3-006-C修复，P3-006-B复审需R1–R2；两线各自推进后集成实际画布 |
| p1-engine | `codex/p1-engine-spike-b4bf` / [#2](https://github.com/heswy/dsh-video-editor/pull/2) | `4c087ef`；交付head `fcb090f` | [P3-006-B复审](reviews/P3-006B-review-01.md)需集中修复R1–R2；原树/PR#2交回新候选，黑带另登记BUG-001 |
| p0-mode-shell | `dsh/p0-mode-shell` / [#3](https://github.com/heswy/dsh-video-editor/pull/3) | 功能 `b382686`；LIVE交付 `2cd718a` | [LIVE复核](reviews/P3-006A-live-review-01.md)：基础闭环有证据、文件打开FAIL；下一任务[P3-006-C](tasks/P3-006C-embedded-file-preview.md)实际修复候选 |

本轮核对：`p0-mode-shell@2cd718a`（已push；本轮读取LIVE交付）；p1-engine@fcb090f（已push、干净，B候选待修复）；未合并协调分支。

当前接手只使用 [p1-engine 交接](handoffs/p1-engine.md)、[p0-mode-shell 交接](handoffs/p0-mode-shell.md)。旧 programmer1/2 文件保留为历史，不重新执行已交付任务。

## 接下来按这个顺序

1. p0-mode-shell执行P3-006-C修复嵌入会话图片/文件打开，交alpha.2具体候选；不重做完整调查，不覆盖已安装staging。p1-engine按P3-006-B复审集中修复R1–R2，两线独立。P3-006-A已授权LIVE完成基础链，但文件打开FAIL、操作事故另记，不能标整个原生嵌入通过。
2. A调查已通过；采用videoView source、hero:false、工程映射Host持久化，不新Workspace/不归档隐藏。mainView保留计数不等于编辑器可见，接线需避免双根与错误锁定。B已验收：composition CSS px与静态布局基座分离、实例消息/生命周期；toy Host不可原样进生产，需补授权/TTL/精确脚本资源策略。
3. 会话侧基础接线已装alpha.1、引擎仍54f4671；p0先修图片打开。p1的0.3.0覆盖语义修好验收后，冻结新引擎+受控工程创建/迁移+Host/Tool方法+实际画布整合，不把换版本号或暂态拖动当用户闭环。
4. 保留当前已安装alpha.1与全部旧候选、0.2.1回滚入口；后续新候选需精确包/实际渲染版本核对。link更新本轮曾需用户手动重启，不许通过热改旧staging凑验证。
5. 后续 P3-006 接通工程创建、上下文、素材归属与冲突处理；P3-007 验收真实“一句话→15s 多场景→人工修改→AI 续改→重开→导出”。[ROADMAP](ROADMAP.md) 为规划，不自动授权实现。

## 尚未通过的关口

- alpha.1原生文件/图片打开FAIL；自然审批、附件功能、主题窄窗等未覆盖项按LIVE记录保留，不因入口可见就通过。
- P3新引擎未接插件，legacy demo不能换色；实时画布、原位编辑、工程创建/保存重开与用户素材尚未整体实现。历史/模型seat/标题续改已有基础真机证据。
- 任意生成代码的安全执行、OS 沙箱、跨进程多写者和非 macOS 分发未验证；当前仅受控模板与工程。
- 旧忽略产物不保证随 Git 工作树归档恢复。p1-engine 依赖已重装，恢复基线 worker 17/17、client 16 pass + 1 opt-in skip；旧证据按固定提交与摘要追溯。

## Git 与授权

`main` 仍为 `9c826bd`，三个开发/协调 PR 未合并。普通 feature commit/push 与更新现有草稿 PR 已获用户授权；推送不代表验收或发布。安装、启停、重启、合并与发布按具体授权执行，本轮均不执行。开发树只同步入口文档，不拷贝整个协调分支、不 rebase、不改功能代码。

本轮整理证据见 [记忆与工作区核对记录](research/2026-10-17-memory-workspace-audit.md)。

最新评审：[P3-004](reviews/P3-004-review-01.md)、[P2-007](reviews/P2-007-review-01.md) 均在本机受控范围通过。独立检查摘要位于同级 artifacts/reviews/2026-10-18/joint-review-summary.json。评审新建staging仅作测试，其demo有写入，不作为安装路径；开发者干净候选保持原样。

已审前置调查：[P3-005-A](reviews/P3-005A-review-01.md)通过（源码/只读契约，不是实际嵌入真机）；P3-006-A后续已实施LIVE，当前任务以表格和handoff为准。

最新画布spike：[P3-005-B复审](reviews/P3-005B-review-01.md)独立Node10/10、真实Chrome41/41、能力探针通过；播放/选中/文字原位写回已证明，layout/style当前E_PARAMS缺口转P3-006-B。证据在同级artifacts/reviews/2026-10-18/P3-005B-{canvas,capability}/；非真机UI。

最新会话候选复审：[P3-006-A修复](reviews/P3-006A-review-02.md)，831d275的123项检查与版本10/10、四故障场景修复探针及固定包/staging通过；R1–R4关闭。安装验收指南已准备，用户随后明确回复“我授权。完全授权。”，本任务已获授权并已有LIVE交付；当前文件预览修复另见P3-006-C。原始复现与修复后探针在同级artifacts/reviews/2026-10-18/P3-006A/。

最新引擎候选：[P3-006-B复审](reviews/P3-006B-review-01.md)发现并独立复现两类人工修改丢失；待集中修复，禁止将4c087ef当已验收新画布基线。[BUG-001](tasks/BUG-001-render-bottom-band.md)登记导出底部黑带，后续实现尚未下发，正式导出视觉验收前需关闭。

最新LIVE：[P3-006-A复核](reviews/P3-006A-live-review-01.md)，交付2cd718a的证据摘要吻合；用户实测PNG文件卡报sidebarRight缺session surface，源码根因已独立确认。根插件仍旧引擎/legacy demo，不支持工程换色；后续必须接新引擎+受控工程+Host/Tool/预览，不能用后期调色图片或直接改HTML替代。用户报告的全局输入误发/个人剪贴板使用违反既有边界，后续禁止再用，缺定向通道改人工。
