# 当前项目状态

更新：2026-10-20。P3-016（A：面板可拖拽加宽/工程标题重命名/移除显示设置）已合并 main（PR #10，merge commit `61c566e`）；P3-017（B：预览稳定性/图片文件本地预览/产品态导出）已合并该 main 形成 **0.3.0-alpha.9 候选**（B 分支 merge `55fbed7`、版本 bump `795acaa`，PR #11），合并后全量门禁与 real Chrome 验收全过；**候选未构建 staging、未安装**，当前安装仍为 alpha.8。待独立 verifier 合并后复验、Lead 合并 PR #11 并构建/安装 alpha.9 后做真机验收。

## 当前基线

- **main是唯一长期主分支，代码与项目记忆均读origin/main。** 标准入口 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor`；未来bugfix从最新main建立独立codex/<问题名>分支，PR回main。
- 已合入 main：PR#1（规范/记忆整理）、PR#4（Client/Host/engine + UI 优化）、PR#5（UI 优化并入开发线）、PR#6（预览快照 CSP `'self'`）、PR#7（沙箱子资源公共 exact 路由）、PR#8（记录预览修复）、PR#9（P3-015 提速 / alpha.8）、**PR#10（P3-016 面板/标题/移除显示设置）**。main 最新合并提交 **61c566e**。
- 当前安装为 bundle **0.3.0-alpha.8**（root=`engine`=`cf7e593`，client/worker `0.4.0`，staging `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593`，INTEGRITY `988302e9…6857`）；alpha.7 staging 与用户原作品保留，回滚入口已记录。
- **0.3.0-alpha.9 候选（未安装）**：`codex/p3-017-preview-export`（PR #11）合并 main（`55fbed7`）并 bump 版本（`795acaa`），包含 P3-016 A（右栏默认 42%/320–720px、可拖拽分隔条、双击/方向键/Home、比例持久化；`project.json` 可选 `title` + UI-only `project.rename` + 顶栏左对齐内联重命名；移除插件显示设置）与 P3-017 B（预览 30s 独立预算/1s 去抖/失败自动重试 1 次/旧画面保留/有界诊断；内嵌对话图片/文件点击走插件本地 overlay；产品顶栏右侧“导出 MP4”真实进度/已用时间/取消/下载、绑定点击时 revision；render 900000ms、frame 仍 120000ms）。产品范围仍为右侧对话生成/续改、左侧自动只读预览/播放；手动编辑延期，无底部场景卡片。

## 已验证与未验证

- **P3-016 A**：自测门禁 check 54/54、smoke 77/77、check-host 66/66、worker 56/56、frame-times 8/8，真 Chrome 组件 harness 23/23（顶栏顺序、分隔条拖动/持久化/720px 上限/双击/方向键、内联重命名）；PR #10 已合并 main。详见 [P3-016 任务](tasks/P3-016-panel-title.md)。
- **P3-017 B（合并前）**：check 52/52、smoke 81/81、check-host 67/67、worker 54/54；P3-012 真浏览器预览脚本已按 B1 新契约更新（单次失败自动重试恢复、连续失败才出 retention notice，事件驱动等待）并在 real Chrome 161/161；/tmp 真实 Host+worker 导出 5s/20s/120s 均成功（13.1s/28.2s/160.3s，120s 片超过旧 120s 上限）、并发 frame+2 snapshot 与运行中取消（1.7s）通过。详见 [P3-017 任务](tasks/P3-017-preview-export.md)。
- **alpha.9 候选（A+B 合并 main 后）**：`client.js` 顶栏冲突按“A 左侧作品名/箭头/内联 rename + B 右侧导出控件；显示设置保持删除”解决；门禁 check **54/54**、smoke-client **80/80**、check-host **68/68**（连续 3 次稳定）、worker **56/56**（`cf7e593` reviewed `node_modules` 只读载体）、test-stage-version **10/10（已转绿）**；`test-conversation-preview` real Chrome **164/164**（B1–B5 acceptance 全 true，新增 3 个 A+B 顶栏/分隔条集成断言；staging 只读审计 same=true、external=0、writeRequests=0）。证据 `/tmp/p3-019-preview-evidence/preview-2026-10-20T12-30-33-409Z/`；设计文档已同步（`FRONTEND-DESIGN` AI 栏 42%/320–720px、左保底约 360px、窄屏堆叠）。
- **alpha.8 已安装真机事实（历史）**：真实 DSH Web GUI Plugins 页 v0.3.0-alpha.8 / 1 of 1 运行中；P3-015 真机验收 2 次真实模型请求通过（3 步/44.2s、2 步/39.3s，对比基线 14 步/536s）；证据 `artifacts/p3-015/evidence/`。
- **未验证/边界**：alpha.9 尚未构建固定 staging、未安装/重启、未跑真实 DSH 与模型；真机待验 P3-017 的导出按钮/进度/取消/下载、图片/文件点击本地预览、连续 revision 预览，以及 P3-016 的拖拽手感/模型名完整显示/rename 持久与失败提示（A 的 rename+AI 发布交错竞态未做真实并发压力）。B 的 120s 片导出实测在 /tmp 简单 composition；用户复杂作品与长片体验待真机确认。

## 下一步

1. 独立 verifier 对 PR #11（alpha.9 候选）做合并后整体复验：diff/边界、门禁复跑、real Chrome 预览、A+B UI 共存与冲突解决审查。
2. Lead 按授权合并 PR #11 → 从合并提交构建 alpha.9 固定 staging（记录 root/engine/INTEGRITY 摘要）→ 安装/启用并做真机验收；保留 alpha.8 staging、用户工程与作品作为回滚入口（回滚：重新安装 `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593/bundle`）。
3. 安装/重启/发布仍按当次授权；不 reset/clean/强推，不自动跨会话联系。

规则：[DEVELOPMENT](DEVELOPMENT.md)；当前入口：[handoffs/README](handoffs/README.md)；产品：[PRODUCT](product/PRODUCT.md)；预览修复：[预览管线修复](research/2026-10-19-preview-pipeline-fixes.md)；提速记录：[P3-015](research/2026-10-20-faster-video-turn.md)。
