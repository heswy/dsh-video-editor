# 当前项目状态

更新：2026-10-19。用户已授权从 main 修复实机问题并完成安装验证；当前进入 alpha.7 实机测试。

## 当前基线

- **main是唯一长期主分支，代码与项目记忆均读origin/main。** 标准入口 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor`；未来bugfix从最新main建立独立codex/<问题名>分支，PR回main。
- 已合入 main：PR#1（规范/记忆整理）、PR#4（Client/Host/engine + UI 优化）、PR#5（UI 优化并入开发线）、PR#6（预览快照 CSP `'self'`）、PR#7（沙箱子资源公共 exact 路由）。最新合并提交 **bf38fd6**。
- 当前bundle **0.3.0-alpha.7**；engine **0.4.0**（固定 `0deef8f`）。产品范围仍为右侧对话生成/续改、左侧自动只读预览/播放；手动编辑延期，无底部场景卡片。

## 已验证与未验证

- P3-012 开发候选复审通过；P3-014 UI 优化已整合；固定 root/engine 的链/预览/压力检查与不可变源审计见各任务文件。
- 真实 DSH 实机问题已定位并修复：alpha.5/alpha.6 下"作品发布成功但左侧准备超时"由两段集成边界造成——(1) 快照 entry CSP 用内部桥接 origin `http://dsh.internal` 生成，拦截 gsap/runtime；(2) 沙箱 iframe 的 opaque-origin 子资源被 `/api` admission fence 403。修复见 PR#6/#7 与 [预览管线修复记录](research/2026-10-19-preview-pipeline-fixes.md)。
- 固定候选 alpha.7 staging：`artifacts/p2-b/staging-alpha7-preview-public-0deef8f-bf38fd6`（root `bf38fd6` / engine `0deef8f` / INTEGRITY `775f4a3a…6d44`）。仓库门禁 check 52/52、smoke-client 78/78、check-host 55/55、stage-version 10/10；真实浏览器（模拟 DSH admission fence）alpha.6 精确复现 403+超时、alpha.7 通过。
- **已安装并启用 alpha.7（真实 DSH Web GUI / Plugins 页）**；在真实页面用用户测试工程的字节级副本验证：预览约 1.9s ready、revision `f60fa6c…`、entry/runtime/gsap 200、seek/play 正常、console errors 空，**未发模型请求**。证据见 `artifacts/p3-013/evidence/alpha7-preview-verified/`。
- 未验证：alpha.7 下"真实模型生成→左侧自动播放→同工程连续两轮对话修改→左侧自动更新→重开一致"完整闭环（用户下一轮实机测试）；手动编辑仍延期；alpha.7 安装后用户窗口内的面板如需刷新/重开属正常 UI 行为。

## 下一步

用户以已安装 alpha.7 继续实机测试。新问题记录现象、工程/revision 及必要脱敏证据，从最新 main 建独立分支，不继续旧 p0/p1/video-studio/ui-polish/project-foundation 分支。安装/重启/发布按当次授权；保留旧 staging、用户工程与作品，不 reset/clean/强推。

规则：[DEVELOPMENT](DEVELOPMENT.md)；当前入口：[handoffs/README](handoffs/README.md)；产品：[PRODUCT](product/PRODUCT.md)；本次修复：[预览管线修复](research/2026-10-19-preview-pipeline-fixes.md)。
