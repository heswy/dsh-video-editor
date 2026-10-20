# 当前项目状态

更新：2026-10-20。**0.3.0-alpha.9 已通过真实 DSH Plugins 页安装并启用**（插件页 v0.3.0-alpha.9 / 1 of 1 运行中），重启 DSH 后已加载新 client bundle，并通过首轮真机 UI 验收（面板分隔条拖动/持久化、作品名内联重命名、右侧导出按钮真实 5s 导出下载、无显示设置）。P3-016（A）与 P3-017（B）均已合并 main（PR #10 `61c566e`、PR #11 `573352e`）；alpha.9 固定 staging 已完成真引擎/staging 回归（stage-version 10/10、host-engine ok、conversation-chain 261/261、conversation-preview 164/164）。剩余真机验证项见下（原生内嵌对话图片/文件点击、真实模型连续修改、长片导出体验）。

## 当前基线

- **main是唯一长期主分支，代码与项目记忆均读origin/main。** 标准入口与路径规则见 [DEVELOPMENT](DEVELOPMENT.md)；未来bugfix从最新main建立独立codex/<问题名>分支，PR回main。
- 已合入 main：PR#1（规范/记忆整理）、PR#4（Client/Host/engine + UI 优化）、PR#5（UI 优化并入开发线）、PR#6（预览快照 CSP `'self'`）、PR#7（沙箱子资源公共 exact 路由）、PR#8（记录预览修复）、PR#9（P3-015 提速 / alpha.8）、PR#10（P3-016 面板/标题/移除显示设置）、**PR#11（P3-017 预览稳定性/图片预览/产品导出 + alpha.9 bump）**。main 最新合并提交 **573352e**。
- 当前安装为 bundle **0.3.0-alpha.9**：固定 staging `artifacts/p2-b/staging-alpha9-573352e`（root=`engine`=`573352e`、rootDirty=false、bundle `0.3.0-alpha.9`、client/worker `0.4.0`；INTEGRITY.json sha256 `28f319b91583ae008c577f1caef9f6d89c2a7679bd710aca0a958141cfe53b9e`；目录约 204 MB）。通过真实 DSH Web GUI **Plugins → Add plugin（link staging bundle）→ Install → Enable now** 安装；插件页显示 **v0.3.0-alpha.9 / 1 of 1 运行中**，重启 DSH 后 client bundle 已加载新 UI。
- 回滚保留：alpha.8 staging `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593`（INTEGRITY `988302e9…6857`）与 alpha.7 staging、用户原作品均未改动。
- 产品范围仍为右侧对话生成/续改、左侧自动只读预览/播放；手动编辑延期，无底部场景卡片。alpha.9 内容：A（右栏默认 42%/320–720px、可拖拽分隔条、双击/方向键/Home、比例持久化；`project.json` 可选 `title` + UI-only `project.rename` + 顶栏左对齐内联重命名；移除插件显示设置）+ B（预览 snapshot/ready 独立 30s 预算、1s revision 去抖、失败自动重试 1 次、旧画面保留、有界诊断；内嵌对话图片/文件点击插件本地 overlay；产品顶栏右侧“导出 MP4”真实阶段/百分比/已用时间/取消/下载、绑定点击时 revision；render 900000ms、frame 仍 120000ms）。

## 已验证与未验证

- **alpha.9 固定 staging 回归（2026-10-20，未安装/未发模型阶段）**：`test-stage-version` **10/10**（REVIEWED_BUNDLE_VERSION=alpha.9）；`test-host-engine --staging <new>` **ok=true**（doctor 真实 Node/HyperFrames/Chrome/ffmpeg；frame PNG 273,055 B、render MP4 137,707 B / 150 帧 / 5.00s / 30fps、取消→`cancelled`；integrityVerified）；`test-conversation-chain` **261/261 ok=true**；`test-conversation-preview`（real Chrome，fixed staging）**164/164 ok=true**（B1–B5 全 true、staging 只读审计 same=true）。证据：`artifacts/p2-b/evidence/engine-run-2026-10-20T14-35-53-694Z.json`，chain/preview 证据在 `/tmp/p3-021-alpha9/`（运行产物，未入仓）。staging 构建与回归过程见 [P3-017 任务](tasks/P3-017-preview-export.md) 的“合并/安装/真机验收”记录（task-21）。
- **alpha.9 真机安装与首轮 UI 验收（2026-10-20）**：真实 Plugins 页安装/启用成功，插件页 v0.3.0-alpha.9 / 1 of 1 运行中；重启 DSH 后 client bundle 已加载新 UI。真机确认：① A1 面板分隔条可拖拽（42%→50%）且 reload 后比例持久；② A2 顶部左侧作品名内联重命名生效且工程 revision 不变；③ B3 顶栏右侧导出按钮真实执行 5s 工程导出约 **10s** 并出现下载链接；④ 无显示设置/简化界面效果入口。详见 [P3-016](tasks/P3-016-panel-title.md)/[P3-017](tasks/P3-017-preview-export.md) 的“合并/安装/真机验收”记录。
- **合并后仓库门禁（alpha.9 候选）**：check **54/54**、smoke-client **80/80**、check-host **68/68**（连续 3 次稳定）、worker **56/56**、test-stage-version **10/10**、real Chrome conversation-preview **164/164**；A/B 顶栏冲突已解决并保留“A 左侧作品名/箭头/内联 rename + B 右侧导出，显示设置保持删除”。
- **alpha.8 历史真机事实**：P3-015 真机 2 次真实模型请求通过（3 步/44.2s、2 步/39.3s，对比基线 14 步/536s）；证据 `artifacts/p3-015/evidence/`。
- **未验证/边界（需用户实际操作确认）**：
  - **已安装 DSH 内嵌原生对话中的图片/文件点击**：真实外部 Web 页面没有 native conversation kit，P3-012 真浏览器脚本使用 inert harness faces；alpha.9 的本地预览需要在已安装 DSH 的内嵌会话里实际点一次图片/文件卡确认。
  - **真实模型连续修改**：alpha.9 未发真实模型请求；多轮对话修改→左侧自动更新仍需真实模型操作确认（alpha.8 时代已验 2 轮简单修改）。
  - **长片导出体验**：/tmp 曾实测 20s 工程约 28s、120s 工程约 160s（同源代码、合并前）；真机只验证了 5s 工程导出约 10s，20s/120s 长片、取消/失败路径与下载耗时仍需用户实际作品确认。
  - 预览 retention/自动重试在真实 DSH 的 3–4 连发 revision 未制造；rename 与 AI 发布交错竞态未做真实并发压力；极窄窗口/字体缩放手感待用户确认。

## 下一步

1. 用户以已安装 alpha.9 正常在桌面窗口 Vedio Editor 中继续实机使用，重点确认上述剩余项（内嵌对话图片/文件点击、真实模型连续修改、长片导出与取消）。
2. 新问题从最新 main 建独立 `codex/<问题名>` 分支修复并交 PR；安装/重启/发布/合并按当次授权。
3. 回滚入口：重新安装 alpha.8 staging `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593/bundle`；保留用户工程、旧 staging 与作品，不 reset/clean/强推。

规则：[DEVELOPMENT](DEVELOPMENT.md)；当前入口：[handoffs/README](handoffs/README.md)；产品：[PRODUCT](product/PRODUCT.md)；预览修复：[预览管线修复](research/2026-10-19-preview-pipeline-fixes.md)；提速记录：[P3-015](research/2026-10-20-faster-video-turn.md)。
