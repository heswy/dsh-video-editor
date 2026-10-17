# 当前项目状态

更新：2026-10-17（Asia/Shanghai）。总调度为当前 Codex 主会话；开发会话以工作区名识别。这里仅保存当前状态，历史见 [STATUS-HISTORY](STATUS-HISTORY.md)。

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
| 插件最新交付 | **0.2.2**，实现 `97c0609`、记录 `16d60aa` | [P2-006](tasks/P2-006-cancel-and-timing-ux-fixes.md)；开发者记录 103/103 + staging 真实链通过，**待独立复审、未安装** |
| 引擎已验收 | 两包 **0.2.0**，实现 `9df968c`、记录 `aae05e9`；工程创建、多 Scene、三方合并、历史/撤销/重做 | [P3-003 复审](reviews/P3-003-review-01.md)；17/17、real 9/9、client 16+1 skip；真实 15s 视频，限本机受控范围 |
| 新产品体验 | 右侧原生 AI、历史、模型；左侧实时直接编辑；工程素材库 | 设计已确认，**尚未整体实现或验收**；不能把底层方法存在当成用户闭环完成 |

## 工作区与当前任务

工作树绝对路径和通用规则只维护在 [DEVELOPMENT](DEVELOPMENT.md)。2026-10-17 已 fetch 并核对：三棵树完整、整理前均干净、开发分支与远端一致。不需要新建或重建。

| 工作区 | 分支 / PR | 最近功能交付 | 当前动作 |
|---|---|---|---|
| 主工作区（总调度） | `codex/project-foundation` / [#1](https://github.com/heswy/dsh-video-editor/pull/1) | 当前产品、规则、评审、交接 | 复审 P2-006；核实新对话契约并准备新版画布指南 |
| p1-engine | `codex/p1-engine-spike-b4bf` / [#2](https://github.com/heswy/dsh-video-editor/pull/2) | `aae05e9`（本轮后续仅同步 AGENTS 入口，不改变功能基线） | [P3-004](tasks/P3-004-engine-preview-snapshot.md) 已下发；尚无本任务功能交付。继续快照/schema/registry 清理，不受布局变化影响 |
| p0-mode-shell | `dsh/p0-mode-shell` / [#3](https://github.com/heswy/dsh-video-editor/pull/3) | `16d60aa`（本轮后续仅同步 AGENTS 入口，不改变功能基线） | P2-006 已交回等待复审；新版任务未下发，不按旧右侧属性栏方案开工 |

当前工作区 HEAD：`p1-engine@929ff37`、`p0-mode-shell@2c46daa`；相对上表功能交付均只增加 AGENTS 入口提交，两树干净并已普通 push。

当前接手只使用 [p1-engine 交接](handoffs/p1-engine.md)、[p0-mode-shell 交接](handoffs/p0-mode-shell.md)。旧 programmer1/2 文件保留为历史，不重新执行已交付任务。

## 接下来按这个顺序

1. p1-engine 完成 P3-004：协议 schema、固定 revision 的预览快照及生命周期、registry 失败恢复；两包 0.2.1，交回复审。
2. 总调度复审 p0-mode-shell 的 P2-006 与 0.2.2 包/staging。注意 staging 脚本硬编码期望根版本 0.2.1，开发者用临时副本生成 0.2.2；这是待处理的可复现性事项，不视为已通过。
3. 总调度核对目标运行 Host 的 SessionProvider + Conversation Factory、会话创建/历史与模型控件的原生嵌入方式。现有文档线索不是 live 通过。
4. 编写并下发 **P3-005**（目前没有正式任务文件）：实时画布/直接编辑与常驻右侧 AI 的新布局；按快照与会话调查结果拆实施阶段，不加场景卡片。
5. 后续 P3-006 接通工程创建、上下文、素材归属与冲突处理；P3-007 验收真实“一句话→15s 多场景→人工修改→AI 续改→重开→导出”。[ROADMAP](ROADMAP.md) 为规划，不自动授权实现。

## 尚未通过的关口

- P2-006 独立复审与安装后交互；旧 UI 的完整编辑/导出/取消/生命周期与主题窄窗矩阵仍按真机记录补验。
- P3 新引擎尚未全部接入插件；实时画布、原位编辑、历史续聊、模型选择嵌入、用户素材生命周期均需实际交付。
- 任意生成代码的安全执行、OS 沙箱、跨进程多写者和非 macOS 分发未验证；当前仅受控模板与工程。
- 旧忽略产物不保证随 Git 工作树归档恢复。p1-engine 依赖已重装，恢复基线 worker 17/17、client 16 pass + 1 opt-in skip；旧证据按固定提交与摘要追溯。

## Git 与授权

`main` 仍为 `9c826bd`，三个开发/协调 PR 未合并。普通 feature commit/push 与更新现有草稿 PR 已获用户授权；推送不代表验收或发布。安装、启停、重启、合并与发布按具体授权执行，本轮均不执行。开发树只同步入口文档，不拷贝整个协调分支、不 rebase、不改功能代码。

本轮整理证据见 [记忆与工作区核对记录](research/2026-10-17-memory-workspace-audit.md)。
