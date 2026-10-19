# 预览管线修复：CSP origin 与沙箱子资源公共路由

更新：2026-10-19。记录 alpha.5/alpha.6 真实 DSH 实机测试中"作品已发布但左侧一直加载→预览准备超时"的两个根因、修复、验证与当前安装状态。证据位于仓库外固定产物 `artifacts/fixes/preview-csp/`、`artifacts/p3-013/evidence/preview-csp-diagnosis/`、`artifacts/p3-013/evidence/alpha7-preview-verified/`。

## 现象

用户在真实 DSH（Web GUI + 真实 Host/worker/模型会话）发"一个球在上下跳动"生成成功。右侧 AI 报告已发布 revision `f60fa6c…`，但左侧一直"正在准备预览"，约 15 秒后显示"预览准备超时，请重试"，重试无效。session log 显示两次 `project.compose` 均成功（`publishedRevision`/`history=recorded`），frame/read_image 自检也正常；问题只在浏览器预览路径。

## 根因一：快照 entry CSP 用内部桥接 origin（PR #6）

- 真实浏览器复现：`preview.snapshot` 200，隐藏 candidate iframe 已挂载；console 报 `gsap.min.js` 与 `canvas-runtime.js` 被 CSP 拦截，inline 脚本抛 `gsap is not defined`，runtime 永不 ready，15s 有界等待触发 `E_PREVIEW_TIMEOUT`。
- 快照 entry 实际返回 `script-src http://dsh.internal 'sha256-…'`。`host/snapshot.js#serveEntry` 用 `new URL(request.url).origin` 生成 CSP，而真实 DSH 的插件 Fetch 路由请求带内部桥接 origin `http://dsh.internal`；浏览器文档实际 origin 是 Web GUI 的 `http://127.0.0.1:<port>`。组件玩具服务器里两者恰好相同，因此此前未暴露。
- 修复：entry CSP 的 script/style/img/font 改为 `'self'`（浏览器按真实文档 origin 解析，同源限制不变），保留 inline hash 与其余指令。回归：Host 检查断言 `'self'`/无 `dsh.internal`/与 request origin 无关；真实 Chrome 回归以 `http://dsh.internal` 作为 Host 请求 origin、页面从 `127.0.0.1` 加载，修复前 staging 精确超时、修复后 ready/seek/play/hit 全通过。

## 根因二：沙箱 iframe 子资源被 /api admission fence 403（PR #7）

CSP 修好后实机仍是同一超时。真实浏览器网络证据：

```
GET /api/dsh-video/preview/<snap>/assets/gsap.min.js  → 403
GET /api/dsh-video/canvas-runtime.js?…               → 403
父页面同源 fetch 相同 URL → 200 / 72927B、14438B
```

- 预览 iframe 是 `sandbox="allow-scripts"`（opaque origin），其 script/img/font 子资源请求被浏览器视为 cross-site，不带 `SameSite=Strict` 浏览器会话 Cookie；DSH 的 Connection `/api` admission fence 对 cross-site/未认证请求返回 403。entry 文档导航仍带 Cookie 并通过认证，所以"发布、entry、快照都成功，但子资源全 403、runtime 不 ready"。
- 修复：entry 文档保持走认证 Connection Fetch 路由；声明的子资源与固定 runtime 改由 `ctx.webServer.register` 注册为 exact 公共路由（WebServer 匹配 exact 先于 `/api` prefix，因此不经过 admission fence）。路径中的随机 `snapshotId` 即能力凭据；文件不可变、TTL 有界、retention/release 语义不变，每次请求仍按 manifest 校验 bytes/sha256；响应头与 Fetch 路径一致（`no-store`、`nosniff`、content-type、font/img 需要的 ACAO/CORP）。无 `webServer` 的 tool-only/测试 composition 自动回退到原 Fetch 路由。
- 回归：Host 检查断言 entry 仅在认证路由、子资源/runtime 为 public exact、无任何 cookie/认证头也返回 200 且字节/头部正确、release 移除 asset 路由并保留 runtime 路由；真实浏览器玩具 bridge 现在模拟 SameSite=Strict + `sec-fetch-site: cross-site` 拒绝的 admission fence，alpha.6 staging 精确复现 403+超时，alpha.7 staging 通过 ready/seek/play/hit 且无 console error。

## 版本、验证与安装（2026-10-19）

- PR #6（CSP `'self'`）合并提交 `1659147`；PR #7（公共子资源路由）合并提交 `bf38fd6`；中间 alpha.6 版本 bump `9b10f64`、alpha.7 bump `2c5c62b`。
- 固定候选 staging：`artifacts/p2-b/staging-alpha7-preview-public-0deef8f-bf38fd6`；root `bf38fd6eec57b7565460333fe62e6cb5962e4c5b`、engine `0deef8fafb6c51da1db8e0cc783f54b8a0b3e585`、bundle `0.3.0-alpha.7` / client·worker `0.4.0`、INTEGRITY `775f4a3af2ae915afa68626a2386839489fc0805b65357f3d1d9b26955dc6d44`。仓库门禁：check 52/52、smoke-client 78/78、check-host 55/55、stage-version 10/10。
- 安装：真实 DSH Web GUI 的 Plugins 页，从 alpha.6 替换为 alpha.7（卸载→添加本地 staging bundle→启用），插件详情 **v0.3.0-alpha.7 / 1 of 1 运行中**，来源为该 staging；profile 依赖指向该 bundle。alpha.7 的 client.js 与 alpha.6 完全同字节（`5ae8c69d…`），客户端模块无需重启；Host 热切换后已在真实页面生效。
- 真实 DSH 实机验证（未发模型请求）：把用户测试的球工程（原 `artifacts/ui-polish/staging-alpha5/projects/proj-mveprihs-86ab8473`，index.html sha256 `e5691b24…`）按字节复制为 alpha.7 staging 的验证工程。打开 Vedio Editor 后 **约 1.9s 达到 phase=ready**，revision `f60fa6ced232…`；entry/runtime/gsap 全部 200；CSP 为 `script-src 'self'`；seek 3.2s 显示 `3.20 / 5.00`，播放从 0.97s 前进到 1.20s、按钮状态正确；console errors 为空；截图见证据目录。
- 保留：alpha.5/alpha.6 staging、旧工程、用户作品均未改写；回滚 entry 为 Plugins 页重装 alpha.6 staging bundle。
- 未做：修复验证期间未发真实模型请求；"真实模型生成→左侧自动播放→同工程连续两轮修改→左侧自动更新"完整实机闭环仍需用户下一轮测试确认（修复前用户仅观察到第一轮发布后卡加载；修复后同工程预览已恢复）。

## 结论与下一步

两个问题都是真实 Host/浏览器集成边界问题，不是题材/模型/publish 本身；修复仅动 Host 快照路由与 CSP，不改 composition 校验、发布语义、UI 或 engine。下一步由用户按正常流程实机测试；若发现新问题，从最新 main 建独立 `codex/<问题名>` 分支修复，安装/重启仍按当次授权。
