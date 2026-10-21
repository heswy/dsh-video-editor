# 当前项目状态

更新：2026-10-21。**0.3.0-alpha.11 已通过真实 DSH Plugins 页安装并启用**（插件页 v0.3.0-alpha.11 / 1 of 1 运行中）；P3-028（darwin 收起侧栏顶栏居左）已随 PR #15 合并 main（merge `51b95dc`）。用户明确指示“**直接合码，这是 0.3.0 版本的最后一次改动**”，因此 alpha.11 **未等待重启后的最终视觉复核即合并**（组件/真 Chrome 几何/引擎/预览回归均通过，见下）；alpha.10 之前的用户 6 项验收结论继续有效。剩余为长期观察项（真实长片导出耗时/取消/失败、真实模型复杂多轮、极端窄窗/平台差异、宿主变量语义变化），见下。

## 当前基线

- **main是唯一长期主分支，代码与项目记忆均读origin/main。** 标准入口与路径规则见 [DEVELOPMENT](DEVELOPMENT.md)；未来bugfix从最新main建立独立codex/<问题名>分支，PR回main。
- 已合入 main：PR#1（规范/记忆整理）、PR#4（Client/Host/engine + UI 优化）、PR#5（UI 优化并入开发线）、PR#6（预览快照 CSP `'self'`）、PR#7（沙箱子资源公共 exact 路由）、PR#8（记录预览修复）、PR#9（P3-015 提速 / alpha.8）、PR#10（P3-016 面板/标题/移除显示设置）、PR#11（P3-017 预览稳定性/图片预览/产品导出 + alpha.9）、PR#12（alpha.9 收尾文档）、PR#13（P3-022 fileLink 本地预览修复 + alpha.10）、PR#14（alpha.10 收尾文档）、**PR#15（P3-028 darwin 顶栏窗口预留修复 + alpha.11）**。main 最新合并提交 **51b95dc**。
- 当前安装为 bundle **0.3.0-alpha.11**：固定 staging `artifacts/p2-b/staging-alpha11-51b95dc`（root=`engine`=`51b95dc`、rootDirty=false、bundle `0.3.0-alpha.11`、client/worker `0.4.0`；INTEGRITY.json sha256 `fd080d27086fa80bea8f4b0623d823c497c6281b8974ee1e0d0a2ac89db682ab`；目录约 203 MB）。通过真实 DSH Web GUI **Plugins → Add plugin（link staging bundle）→ Install → Enable now** 安装；插件页显示 **v0.3.0-alpha.11 / 1 of 1 运行中**。
- 回滚保留：alpha.10 staging `artifacts/p2-b/staging-alpha10-1cceb96`（INTEGRITY `6061004f…3e4f9`）、alpha.9 staging `artifacts/p2-b/staging-alpha9-573352e`（INTEGRITY `28f319b9…3b9e`）、alpha.8 staging `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593`（INTEGRITY `988302e9…6857`）、alpha.7 staging 与用户原作品均未改动。
- 产品范围仍为右侧对话生成/续改、左侧自动只读预览/播放；手动编辑延期，无底部场景卡片。alpha.9 内容：A（右栏默认 42%/320–720px、可拖拽分隔条、双击/方向键/Home、比例持久化；`project.json` 可选 `title` + UI-only `project.rename` + 顶栏左对齐内联重命名；移除插件显示设置）+ B（预览 snapshot/ready 独立 30s 预算、1s revision 去抖、失败自动重试 1 次、旧画面保留、有界诊断；内嵌对话图片/文件点击插件本地 overlay；产品顶栏右侧“导出 MP4”真实阶段/百分比/已用时间/取消/下载、绑定点击时 revision；render 900000ms、frame 仍 120000ms）。alpha.10 增量：P3-022 修复宿主 ToolRow `fileLink` 折叠摘要点击（相对/绝对路径 → 插件本地 overlay，阻止原生 `openFile → sidebarRight`；img 分支优先）。alpha.11 增量（0.3.0 最后一次改动）：P3-028 修复 darwin 折叠侧栏时重复预留窗口控制区导致的顶栏右移——darwin 下 topbar leading clamp 到 16px，保留 top-clearance 下移，非 darwin/窄屏行为不变。

## 已验证与未验证

- **alpha.11 固定 staging 回归（2026-10-21，安装前）**：`test-stage-version` **10/10**；`test-ui-polish`（仓库 client）**27/27**、以 **staging client.js 字节** 再跑 **27/27**；`test-host-engine --staging <new>` **ok=true**（真实 Node/HyperFrames/Chrome/ffmpeg；frame PNG 273,055 B、demo 5s render MP4 137,707 B / 150 帧 / 30fps、取消→`cancelled`；integrityVerified）；`test-conversation-chain` **261/261 ok=true**；`test-conversation-preview`（real Chrome，fixed staging）**164/164 ok=true**（B1–B5 全 true、staging 只读审计 same=true）。独立 verifier P3-028 **PASS**。darwin 几何（真 Chrome、staging client 字节）：topbar `paddingLeft=16px`（旧 160px）、`paddingTop=56px`、返回按钮 `left=16/top=56`、作品名 `left=58/top=56`；清除变量后非 darwin 与基线一致。证据：`artifacts/p2-b/evidence/engine-run-2026-10-21T05-48-17-925Z.json`，其余运行产物在 `/tmp/p3-031-alpha11/`（未入仓）。详见 [P3-028 任务](tasks/P3-028-topbar-left.md)。
- **alpha.11 安装与“直接合码”决定（2026-10-21）**：真实 Plugins 页安装/启用成功，插件页 **v0.3.0-alpha.11 / 1 of 1 运行中**。用户明确指示“直接合码，这是 0.3.0 版本的最后一次改动”；按此决定 **未等待重启后的最终视觉复核即合并**——折叠侧栏顶栏居左的真机视觉确认仍属未复核项（组件/真 Chrome 几何已通过，安装本身成功）。
- **alpha.10 用户最终验收（历史，2026-10-21）**：用户 6 项全部通过并反馈“非常好，现在我觉得没什么问题了”：①右侧面板可拖拽加宽/模型选择可看全；②作品名左对齐可内联重命名（revision 不变）；③预览超时自动恢复；④`read_image` fileLink 点击不再弹 sidebarRight；⑤显示设置/简化效果已移除；⑥产品态导出按钮可用。
- **alpha.9 / alpha.8 历史事实**：alpha.9 首轮真机 UI 验收通过（splitter 42%→50% 且 reload 持久、rename、5s 导出约 10s）；alpha.8 真机 2 次真实模型请求通过（3 步/44.2s、2 步/39.3s，对比基线 14 步/536s）；证据 `artifacts/p3-015/evidence/`。
- **剩余长期观察项（不阻塞 0.3.0 收尾，继续用真实使用确认）**：
  - **真实长片导出**：真机已验证 5s 工程（alpha.9 约 10s）；用户 20s/120s 复杂作品的实际耗时、取消、失败/重试路径与下载耗时仍需长时间使用确认（/tmp 同源代码曾实测 20s≈28s、120s≈160s，非真机用户作品）。
  - **真实模型复杂多轮修改**：多轮复杂修改下的左侧自动更新、预览去抖/失败恢复仍需持续观察（alpha.8 只验 2 轮简单修改）。
  - **极端窄窗口/宿主字体缩放**：320–720px clamp 与左保底、模型名完整显示在极端环境下未做真机压力。
  - **平台差异**：非 darwin（Windows/Linux）的窗口控制区/leading 行为未真机验证；宿主未来若改 `--dsh-frame-leading-clearance`/`--dsh-frame-top-clearance` 语义，需重新核对 P3-028 修复。
  - **alpha.11 未等待重启视觉复核**（用户直接合码）；未额外发起真实模型请求；未在真机复测 3–4 连发 revision 的 retention 行为。

## 下一步

1. 0.3.0 版本线按用户决定在 **alpha.11** 收尾（最后一次改动已合并/安装）；用户以已安装 alpha.11 在 Vedio Editor 中正常使用，上述长期观察项通过真实使用持续确认。
2. 出现具体问题再从最新 main 建 `codex/<问题名>` 分支修复并交 PR；安装/重启/发布/合并按当次授权，不 reset/clean/强推，不自动跨会话联系。
3. 回滚入口：重新安装 alpha.10 staging `artifacts/p2-b/staging-alpha10-1cceb96/bundle`（或 alpha.9/alpha.8 staging）；保留用户工程、旧 staging 与作品。

规则：[DEVELOPMENT](DEVELOPMENT.md)；当前入口：[handoffs/README](handoffs/README.md)；产品：[PRODUCT](product/PRODUCT.md)；预览修复：[预览管线修复](research/2026-10-19-preview-pipeline-fixes.md)；提速记录：[P3-015](research/2026-10-20-faster-video-turn.md)。

## V1 M1（1.0.0-alpha.1）实现会话自测（2026-10-21，待 Lead 复跑/提交/staging）

- 分支 `codex/v1-m1-storage`（base `1aabd6e`）；候选版本已 bump **`1.0.0-alpha.1`**；**已 commit，候选 staging 由 Lead 构建，未安装/未重启 DSH**。
- 已完成 M1-01…M1-06 实现：稳定数据根（`~/Movies/DSH Video`，config `dataRoot` > env `DSH_VIDEO_DATA_ROOT`；目录 0700、不 chmod 父目录）、数据根两文件布局（worker `registry.json` 5 键不变 + `projects.json` 工程表）、旧 staging 只读迁移（`migration.json`、幂等、失败重试、session 合并）、registry/session/ui-state 容错与单工程 quarantine（含 map 从磁盘扫描重建 source=scan）、UI-only `project.path`/`project.reveal`（argv spawn、跨平台、错误 `E_REVEAL_FAILED`）+ 顶栏可见文件夹按钮与菜单「在 Finder 中显示/复制路径」、UI-only `ui.state.get/set` + 启动恢复 lastProjectId/比例 + 保存状态指示。
- 门禁（临时 HOME/dataRoot；真实 `~/Movies/DSH Video` 未创建）：check **58/58**、smoke-client **84/84**、check-host **71/71**、test-stage-version **10/10**、新增 `scripts/test-v1-storage.mjs` **21/21**（无外部 env 与 `DSH_VIDEO_DATA_ROOT` 外部注入两种跑法均 21/21）。
- 迁移演练：alpha.11 staging 数据副本（只读）→ 数据根，demo + 真实工程 `proj-mvhq5nnj-3eb8e5db` 与会话映射迁移成功；重复激活幂等、旧目录未改写。
- L3（alpha.11 staging 旧快照回归 + dataRoot 能力门控）：`test-host-engine` ok=true、`test-conversation-chain` 261/261 ok=true、`test-canvas-chain` ok=true；真实数据根未被创建/修改；conversation-preview/canvas-browser 本轮未跑。
- 待 Lead：评审 + 复跑门禁 + commit + 构建 `1.0.0-alpha.1` staging（`--data-root`/`--legacy-data-root /…/staging-alpha11-51b95dc`）+ 用户真机验收（重启≥3 次、旧工程迁移、文件夹按钮、保存状态）。
- 已知限制：迁移在首个业务请求同步执行（大工程可能拖慢首次 project.list，M3 评估后台化）；非 darwin 默认数据根与 reveal 命令未验证；v1 默认数据根以 macOS 为准。
