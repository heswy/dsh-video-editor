# v1.0 规划文档索引（docs/plans）

日期：2026-10-21。本目录是 **1.0.0 大版本**的规划与执行文档入口；实现开始前只含文档，不含代码。

| 文件 | 用途 | 状态 |
|---|---|---|
| [V1.0-PLAN.md](V1.0-PLAN.md) | 实施总规划：目标/范围/架构/里程碑与任务分解/工作区/版本发布/风险/估算 | 已定稿（待“开始”） |
| [V1.0-DEVELOPMENT-GUIDE.md](V1.0-DEVELOPMENT-GUIDE.md) | 开发运行指南：角色授权/工作区/任务协议/验证分层/staging/验收/发布/模板/红线 | 已定稿（待“开始”） |
| [V1.0-ACCEPTANCE.md](V1.0-ACCEPTANCE.md) | 验收矩阵：M0–M6 用户清单、回归、迁移/回滚演练、发布门禁、已知限制 | 已定稿（待“开始”） |
| [V1.0-DECISIONS-DRAFT.md](V1.0-DECISIONS-DRAFT.md) | D035–D041 决策草案（随文档 PR 并入 `docs/DECISIONS.md`） | 待入库 |
| [../research/2026-10-21-v1-major-version-proposal.md](../research/2026-10-21-v1-major-version-proposal.md) | 预研报告与方案（v2，已按用户决策修订） | 已完成 |
| [../research/2026-10-21-timeline-architecture-research.md](../research/2026-10-21-timeline-architecture-research.md) | 时间线数据模型/剪辑协议/预览导出管线 | 已完成 |
| [../research/2026-10-21-qianwen-audio-provider.md](../research/2026-10-21-qianwen-audio-provider.md) | 千问云音频供应商调研与试点验证（TTS/Audiogen 实测可用；Fun-Music 邀测 403；适配层草案） | 已完成 |
| [../design/concepts/v1-timeline-concept.md](../design/concepts/v1-timeline-concept.md) | v1 剪辑台概念图（非真机） | 已完成 |

## 开工状态

- 基线：缓存 `origin/main` @ `1aabd6e`（0.3.0-alpha.11 已安装；网络暂不可 fetch）。
- 规划工作区：`dsh-video-editor-worktrees/v1-plan`（分支 `codex/v1-plan`）。
- 待用户“开始”后：建 `v1-m0-validation` 树 → 下发 M0 任务卡（M0-01…M0-08）→ M0 报告 → Go/No-Go。
- 未完成/未验证：M0 全部实测、真实用户数据迁移（未执行）、1.0.0 分发形态；千问 Fun-Music 邀测未开通（音乐生成待兜底/申请）。
