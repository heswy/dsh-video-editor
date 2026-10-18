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
| 本机应用包 | 只读 app.asar 的 dsh/package.json 为 **0.2.1-rc.2** | [对话复用调查](research/2026-10-17-conversation-embedding-v03.md)；P3-005-A交付了rc.2运行身份/live查询证据，总调度独立核包源码；嵌入实例尚未激活验证，旧rc.1证据保持历史口径 |
| 最近确认的安装 | 根插件 **0.2.1**，link 指向 `staging-54f4671-bdcfd72/bundle`；引擎 **54f4671 / 0.1.1** | [真机验收](research/P2-004-live-acceptance.md)；不是本轮重新检查 profile 的结果，安装目录不得清理或覆盖 |
| 插件最新交付 | **0.3.0-alpha.1**，功能 `26bd4c1`、head `eb8d2d8` | [P3-006-A复审](reviews/P3-006A-review-01.md) **需修复R1–R4**；独立117/117+版本10/10、包19/19和staging摘要通过；映射事务/停用排空/创建预检/跨工程去重失败；**未安装、未验收**。旧0.2.2候选保持已审状态 |
| 引擎已验收 | 两包 **0.2.1**，已审功能 `df4b74f`、head `e364017`；保留多Scene/合并/历史，新增完整schema和预览快照 | [P3-004复审](reviews/P3-004-review-01.md) 通过；worker29/29、real10/10、client18+1skip，固定包3/3+13/13一致；限本机受控范围 |
| 新产品体验 | 右侧原生 AI、历史、模型；左侧实时直接编辑；工程素材库 | 设计已确认，**尚未整体实现或验收**；不能把底层方法存在当成用户闭环完成 |

## 工作区与当前任务

工作树绝对路径和通用规则只维护在 [DEVELOPMENT](DEVELOPMENT.md)。三棵树规划保持，本轮fetch成功并核对p0-mode-shell交付eb8d2d8后干净；p1-engine最近已审交付ea2d1a4（P3-006-B实际开发状态未在本轮重查）；开发树不需要新建或重建。

| 工作区 | 分支 / PR | 最近功能交付 | 当前动作 |
|---|---|---|---|
| 主工作区（总调度） | `codex/project-foundation` / [#1](https://github.com/heswy/dsh-video-editor/pull/1) | 当前产品、规则、评审、交接 | A/B调查与spike均已验收；P3-006-A候选复审需R1–R4，P3-006-B可独立继续，随后集成实际画布 |
| p1-engine | `codex/p1-engine-spike-b4bf` / [#2](https://github.com/heswy/dsh-video-editor/pull/2) | `df4b74f`；spike head `ea2d1a4` | [P3-005-B复审](reviews/P3-005B-review-01.md) 通过；[P3-006-B](tasks/P3-006B-layout-style-persistence.md) 布局/样式持久化实现指南准备好，待用户转发 |
| p0-mode-shell | `dsh/p0-mode-shell` / [#3](https://github.com/heswy/dsh-video-editor/pull/3) | `26bd4c1`；交付head `eb8d2d8` | [P3-006-A复审](reviews/P3-006A-review-01.md) 需修复R1–R4；待用户转发，沿用原任务一次修复交回 |

本轮核对：`p0-mode-shell@eb8d2d8`（已push、干净）；p1-engine最近已审head仍为ea2d1a4，本轮未核查其进行中的B实现；未合并协调分支。

当前接手只使用 [p1-engine 交接](handoffs/p1-engine.md)、[p0-mode-shell 交接](handoffs/p0-mode-shell.md)。旧 programmer1/2 文件保留为历史，不重新执行已交付任务。

## 接下来按这个顺序

1. 用户转发P3-006-A复审后，p0-mode-shell一次修复R1–R4：映射写入成功才发布、停用排空Session请求、创建前预检、requestId按工程隔离。不重新调查、不安装旧候选。p1-engine继续P3-006-B统一edit布局/样式持久化，两线独立。
2. A调查已通过；采用videoView source、hero:false、工程映射Host持久化，不新Workspace/不归档隐藏。mainView保留计数不等于编辑器可见，接线需避免双根与错误锁定。B已验收：composition CSS px与静态布局基座分离、实例消息/生命周期；toy Host不可原样进生产，需补授权/TTL/精确脚本资源策略。
3. 会话侧P3-006-A可先实现，不等B；根版本0.3.0-alpha.1候选暂用旧已审引擎54f4671。p1引擎0.3.0补layout/style、场景重生成保留与三方合并；会话侧与引擎完成后下发真正DSH画布整合，不把暂态拖动展示为已保存。
4. 0.2.2过渡候选已通过但不自动安装；继续保留用户当前0.2.1与全部旧候选。新界面采用引擎df4b74f时需明确更新现有Host/staging版本固定与新方法白名单。
5. 后续 P3-006 接通工程创建、上下文、素材归属与冲突处理；P3-007 验收真实“一句话→15s 多场景→人工修改→AI 续改→重开→导出”。[ROADMAP](ROADMAP.md) 为规划，不自动授权实现。

## 尚未通过的关口

- 0.2.2 安装后交互（P2-007的可复建交付已通过）；旧 UI 的完整编辑/导出/取消/生命周期与主题窄窗矩阵仍按真机记录补验。
- P3 新引擎尚未全部接入插件；实时画布、原位编辑、历史续聊、模型选择嵌入、用户素材生命周期均需实际交付。
- 任意生成代码的安全执行、OS 沙箱、跨进程多写者和非 macOS 分发未验证；当前仅受控模板与工程。
- 旧忽略产物不保证随 Git 工作树归档恢复。p1-engine 依赖已重装，恢复基线 worker 17/17、client 16 pass + 1 opt-in skip；旧证据按固定提交与摘要追溯。

## Git 与授权

`main` 仍为 `9c826bd`，三个开发/协调 PR 未合并。普通 feature commit/push 与更新现有草稿 PR 已获用户授权；推送不代表验收或发布。安装、启停、重启、合并与发布按具体授权执行，本轮均不执行。开发树只同步入口文档，不拷贝整个协调分支、不 rebase、不改功能代码。

本轮整理证据见 [记忆与工作区核对记录](research/2026-10-17-memory-workspace-audit.md)。

最新评审：[P3-004](reviews/P3-004-review-01.md)、[P2-007](reviews/P2-007-review-01.md) 均在本机受控范围通过。独立检查摘要位于同级 artifacts/reviews/2026-10-18/joint-review-summary.json。评审新建staging仅作测试，其demo有写入，不作为安装路径；开发者干净候选保持原样。

最新调查验收：[P3-005-A](reviews/P3-005A-review-01.md)通过（源码/只读契约，不是实际嵌入真机）；下一任务已准备P3-006-A，安装授权仍是具体候选完成后的步骤。

最新画布spike：[P3-005-B复审](reviews/P3-005B-review-01.md)独立Node10/10、真实Chrome41/41、能力探针通过；播放/选中/文字原位写回已证明，layout/style当前E_PARAMS缺口转P3-006-B。证据在同级artifacts/reviews/2026-10-18/P3-005B-{canvas,capability}/；非真机UI。

最新会话候选复审：[P3-006-A](reviews/P3-006A-review-01.md)，eb8d2d8的117项检查通过但独立故障探针复现4项问题；待修复，不进入安装。复现与包核对在同级artifacts/reviews/2026-10-18/P3-006A/。
