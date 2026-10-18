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
| 本机应用包 | 只读 app.asar 的 dsh/package.json 为 **0.2.1-rc.2** | [对话复用调查](research/2026-10-17-conversation-embedding-v03.md)；当前运行 Host 未在本轮核实，旧 live 证据为 rc.1 |
| 最近确认的安装 | 根插件 **0.2.1**，link 指向 `staging-54f4671-bdcfd72/bundle`；引擎 **54f4671 / 0.1.1** | [真机验收](research/P2-004-live-acceptance.md)；不是本轮重新检查 profile 的结果，安装目录不得清理或覆盖 |
| 插件最新交付 | **0.2.2**，功能修复 `97c0609`、交付门禁 `8c6bf26`、head `b204760` | [P2-007复审](reviews/P2-007-review-01.md) 通过；103/103+版本10/10、包17/17一致，独立原脚本复建与真实链通过；**可作受控安装候选，未安装** |
| 引擎已验收 | 两包 **0.2.1**，已审功能 `df4b74f`、head `e364017`；保留多Scene/合并/历史，新增完整schema和预览快照 | [P3-004复审](reviews/P3-004-review-01.md) 通过；worker29/29、real10/10、client18+1skip，固定包3/3+13/13一致；限本机受控范围 |
| 新产品体验 | 右侧原生 AI、历史、模型；左侧实时直接编辑；工程素材库 | 设计已确认，**尚未整体实现或验收**；不能把底层方法存在当成用户闭环完成 |

## 工作区与当前任务

工作树绝对路径和通用规则只维护在 [DEVELOPMENT](DEVELOPMENT.md)。2026-10-18 已 fetch 并核对：三棵树完整、整理前均干净、开发分支与远端一致。不需要新建或重建。

| 工作区 | 分支 / PR | 最近功能交付 | 当前动作 |
|---|---|---|---|
| 主工作区（总调度） | `codex/project-foundation` / [#1](https://github.com/heswy/dsh-video-editor/pull/1) | 当前产品、规则、评审、交接 | 两线复审通过；待用户转发P3-005-A/B，随后冻结正式UI/Host实现 |
| p1-engine | `codex/p1-engine-spike-b4bf` / [#2](https://github.com/heswy/dsh-video-editor/pull/2) | `df4b74f` / `e364017` | P3-004 已验收；[P3-005-B](tasks/P3-005B-canvas-direct-edit-spike.md) 受控画布/直接编辑验证指南准备好，待用户转发 |
| p0-mode-shell | `dsh/p0-mode-shell` / [#3](https://github.com/heswy/dsh-video-editor/pull/3) | `8c6bf26` / `b204760` | P2-007 已验收；[P3-005-A](tasks/P3-005A-native-conversation-contract.md) 原生会话/模型/素材契约调查指南准备好，待用户转发 |

当前工作区 HEAD：`p1-engine@e364017`、`p0-mode-shell@b204760`；两树干净并已普通 push，未合并协调分支。

当前接手只使用 [p1-engine 交接](handoffs/p1-engine.md)、[p0-mode-shell 交接](handoffs/p0-mode-shell.md)。旧 programmer1/2 文件保留为历史，不重新执行已交付任务。

## 接下来按这个顺序

1. 用户转发当前工作区handoff后，两线按白名单并行：p0-mode-shell调查P3-005-A原生Conversation/Session/历史/模型/素材，p1-engine验证P3-005-B画布播放/点选/文字写回及位置缩放能力缺口。
2. 总调度分别评审A/B，冻结消息/坐标/持久化和Session生命周期。无现有引擎写接口的拖动或样式不能靠DOM暂态冒充已保存。
3. 正式UI/Host实现指南在A/B结果收敛后下发。已确认布局不变：左直接编辑、右AI常驻、素材抽屉、无场景卡片；P3-005-A/B不是最终DSH界面实现。
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
