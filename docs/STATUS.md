# 当前项目状态

更新：2026-10-20。P3-015 创作提速修复已完成代码、固定 staging、真引擎验证与 **2 次真实模型真机验收**；alpha.8 已通过真实 Plugins 页安装启用，PR #9 已获授权合并（本记录随 PR 进入 main）。

## 当前基线

- **main是唯一长期主分支，代码与项目记忆均读origin/main。** 标准入口 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor`；未来bugfix从最新main建立独立codex/<问题名>分支，PR回main。
- 已合入 main：PR#1（规范/记忆整理）、PR#4（Client/Host/engine + UI 优化）、PR#5（UI 优化并入开发线）、PR#6（预览快照 CSP `'self'`）、PR#7（沙箱子资源公共 exact 路由）、PR#8（记录预览修复）。最新合并提交 **1672a42**。
- 当前安装为 bundle **0.3.0-alpha.8**（root=`engine`=`cf7e593`，client/worker `0.4.0`，staging `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593`，INTEGRITY `988302e9…6857`）；client.js 与 alpha.7 字节相同。alpha.7 staging 与用户原作品保留，回滚入口已记录。产品范围仍为右侧对话生成/续改、左侧自动只读预览/播放；手动编辑延期，无底部场景卡片。

## 已验证与未验证

- P3-012 开发候选复审通过；P3-014 UI 优化已整合；固定 root/engine 的链/预览/压力检查与不可变源审计见各任务文件。
- 真实 DSH 实机问题已定位并修复：alpha.5/alpha.6 下"作品发布成功但左侧准备超时"由两段集成边界造成——(1) 快照 entry CSP 用内部桥接 origin `http://dsh.internal` 生成，拦截 gsap/runtime；(2) 沙箱 iframe 的 opaque-origin 子资源被 `/api` admission fence 403。修复见 PR#6/#7 与 [预览管线修复记录](research/2026-10-19-preview-pipeline-fixes.md)。
- 固定候选 alpha.7 staging：`artifacts/p2-b/staging-alpha7-preview-public-0deef8f-bf38fd6`（root `bf38fd6` / engine `0deef8f` / INTEGRITY `775f4a3a…6d44`）。仓库门禁 check 52/52、smoke-client 78/78、check-host 55/55、stage-version 10/10；真实浏览器（模拟 DSH admission fence）alpha.6 精确复现 403+超时、alpha.7 通过。
- **已安装并启用 alpha.8（真实 DSH Web GUI / Plugins 页，v0.3.0-alpha.8 / 1 of 1 运行中）**；P3-015 真机验收 2 次真实模型请求通过：同一球工程字节副本、同模型 `deepseek-account/deepseek-flash/max`，请求 1「把球换成足球」**3 步 / 44.2s**（source→compose，revision `f60fa6c…`→`66e401f…`），请求 2「时长改 8 秒 + 更有弹性」**2 步 / 39.3s**（直接 compose，revision→`d73089e…`、duration 8）；对比基线 536s / 14 步 / 40 次工具调用。左侧自动更新：phase ready、revision 跟随、播放 `2.50/5.00` 与 `3.98/8.00`；证据 `artifacts/p3-015/evidence/live-acceptance-2026-10-20.json` 与截图。测试后模型默认已恢复为用户原设置，插件重新加载为干净状态。
- P3-015 实现与真引擎门禁：prompt 快路径/禁本地试验/验证预算 + `frame` 批量 `times`/`wait`/单张 contact sheet + wait 成功 `frameImage` 相对路径。check 52/52、smoke 78/78、check-host 65/65、stage-version 10/10、worker frame-times 8/8；staging 真引擎 host-engine 通过、`times:[0.5,2.5,4.5]` 得到 1440×270 sheet、conversation-chain 261/261。证据与范围见 [P3-015 任务](tasks/P3-015-faster-video-turn.md)、[提速记录](research/2026-10-20-faster-video-turn.md)。
- 未验证/边界：真机 2 轮均为简单修改、未触发视觉自检，`frame→frameImage→read_image` 的模型侧实跑未出现（工具/真引擎已覆盖）；请求通过 Host 原生 `sessionController.prompt` RPC 发送（外部 Web GUI 页无插件内嵌会话 kit），未在右栏 Composer 自动键入；手动编辑仍延期；用户窗口内面板如需刷新/重开属正常 UI 行为。

## 下一步

用户以已安装 alpha.8 正常在桌面窗口 Vedio Editor 中继续实机使用；P3-015 PR #9 已按授权合并，旧 alpha.7 staging、用户工程与作品保留。回滚：重新安装 alpha.7 staging `artifacts/p2-b/staging-alpha7-preview-public-0deef8f-bf38fd6/bundle`。后续新问题从最新 main 建独立分支修复；安装/重启/发布/合并按当次授权；保留旧 staging、用户工程与作品，不 reset/clean/强推。

规则：[DEVELOPMENT](DEVELOPMENT.md)；当前入口：[handoffs/README](handoffs/README.md)；产品：[PRODUCT](product/PRODUCT.md)；预览修复：[预览管线修复](research/2026-10-19-preview-pipeline-fixes.md)；提速记录：[P3-015](research/2026-10-20-faster-video-turn.md)。
