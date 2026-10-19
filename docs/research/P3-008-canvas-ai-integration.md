# P3-008 交付证据：受控引擎画布、直接编辑、原生 AI 与素材抽屉

日期：2026-10-18（Asia/Shanghai）。执行：p0-mode-shell（`dsh/p0-mode-shell` / PR #3）。功能提交 **`8ab5f1a`（含 Host 接线与画布/客户端/测试）**；根版本 **`0.3.0-alpha.3`**，引擎固定已审 **`74294e6` / client·worker `0.3.0`**。本文件是开发交付证据，不是安装验收、真实模型闭环或 v0.3 全体验收。

## 1. 结论

- 已交付可安装开发候选与固定 staging：受控新工程创建/重开、左画布真实播放/暂停/seek、点击选中、原位文字编辑、拖动/缩放 typed layout、颜色/字号 style、Scene 底色/新增 Scene、undo/redo、PNG/JPEG 素材上传/导入/用作 shot、真实 MP4 导出；右侧原生 Conversation/模型 seat/历史保持。
- Host/worker 真链（不是 mock）：新工程 → 3 Scene 15s → 背景黄 → 人工 text/layout/style → undo/redo → PNG asset.import → shot → 快照路由 → frame 背景像素 `255,212,0` → MP4 161,844 B/450 帧/15s → close/reopen revision 不变。
- 真浏览器 runtime 验证：Chrome 155 加载沙箱快照 iframe，ready/seek/play/hit 全通过，外部网络 0、console error 0。
- 未安装/启停/重启；未发真实模型请求；未在真实 DSH 页面点击 alpha.3。BUG-001 黑带未修，本轮 MP4 不能标为视觉通过。C 的 alpha.2 固定包/staging 独立保留。

## 2. 固定对象

| 项 | 值 |
|---|---|
| 根候选 | `dsh-video-0.3.0-alpha.3.tgz`：**86,943 B / 23 files / SHA-256 `68887366d98fc742be354cce4ea1926e6f1ed322a5279310eb6b5102889c3f08`**；23/23 与提交 `8ab5f1a` 逐字节一致 |
| 源码提交 | `8ab5f1aaae23c25cd57142cc7920533922acbec5`（含 Host 接线与 canvas/client/tests；先前 `9458291`、`568a325` 为其历史组成） |
| 引擎 | `74294e6339eb2ce2c86f6e546609e7e55a460e68`；client/worker **0.3.0** |
| staging | `artifacts/p2-b/staging-74294e6-8ab5f1a`；INTEGRITY **`8f328d80346ced750bea0623b066ad59abdfda780c19d8ead2da4874d9baaa0e`**；config `3bfc67eb134e5bb8da7526fe3a5c9935057140c3a015cf73ce16dbc304378e1d`；staged patch `0db518a3cca390cfe986df9edeccb33a37f1e2c3ca055743d1c88362839544da` |
| managed registry | `managed/registry.json` `f5b2f6b49e17fd0e7a1c02728ba9a5adf33563fc4c9e19d4fd33bf58d7a2edfc`；inner projects `a0d691daba98f0909c2158b8c2c07e6978b3455631e705745191ba81cd8a0b6b` |
| 交付时 staging 状态 | 仅 `demo` 受控 legacy fixture（与 restore 副本逐字节一致）、output/previews 清空、session-state 不存在；INTEGRITY 记录的 bundle/config/patch/registry 摘要有效 |
| 旧安装 | profile 仍为 **alpha.1 / engine 54f4671** link `staging-54f4671-b382686`；未安装/未替换/未重启 |
| C 保留 | `dsh-video-0.3.0-alpha.2.tgz`（61,611 B/`e375adfd…`）与 `staging-54f4671-3310280` 未覆盖 |

## 3. Host 接口与信任边界

新增/扩展的请求方法（均走 `VideoBridge` dispatcher；参数严格白名单、项目 allowlist、Tool 身份/工程范围校验）：

| 方法 | 用途 | UI/Tool |
|---|---|---|
| `project.create` | worker 生成受控 `product-launch-v1` 工程（title/width/height/fps 白名单） | UI-only |
| `project.list` | 从 worker 管理注册表发现 realpath 在 `projectsRoot` 内的工程 | UI-only |
| `asset.import` | 只接受 Host 上传 receipt → worker `asset.import` | UI-only |
| `scene.create/update/remove/reorder` | expectedRevision+operationId 的受控 Scene 写 | UI+Tool |
| `project.revise` | base/expected revision 三方修订 | UI+Tool |
| `history/undo/redo` | worker 历史与撤销 | UI+Tool |
| `preview.snapshot/release` | 只读 worker 私有快照 + Host 路由注册/撤销 | UI-only |
| `edit` 扩展 | 新增 `layout`（composition-px box）与 `style`（color/fontSize/fontWeight/textAlign）typed ops | UI+Tool |

- **managed 工程发现**：Host 读取 worker 管理的 `{projectsRoot, registryPath, outputRoot, assetInboxRoot}` 配置，要求 `artifactRoot === outputRoot`、所有注册工程 realpath 在 `projectsRoot` 内；新建工程只有在 worker 注册表发布且 Host 重新发现后才加入可信 allowlist。
- **项目/Session**：新工程先 `project.create`，再用返回 pid 创建并持久绑定原生创作 Session；绑定失败保留工程并诚实报错，不重复建工程。
- **素材收件箱**：`POST /api/dsh-video/asset-upload` 只接受 PNG/JPEG，校验扩展名/真实签名/≤8 MiB，写入 `assetInboxRoot` 随机名（0600）并返回短期 receipt；`asset.import` 只接受 receipt，worker 仅接收 inbox basename（不接受绝对路径/URL）；非图片/重命名 HTML 拒绝。
- **快照路由**：`preview.snapshot` 后 Host 按 worker manifest 逐文件 `realpath`+bytes+sha256 校验，按每个相对文件注册**精确鉴权 Fetch 路由**；entry 响应注入 Host 自有固定 runtime 并返回 CSP：`default-src 'none'`、`script-src <host> + inline sha256`、`style-src <host> 'unsafe-inline'`、`img-src <host> data:`、`connect-src 'none'`、`frame-ancestors 'self'`。每次请求重新读盘并核对 hash，篡改返回 `E_SNAPSHOT_CORRUPT`；撤销/到期/替换后路由失效。
- **Prompt context**：注入新鲜 revision、Scenes、可编辑 stableId/capabilities、素材相对路径摘要，并引导“优先同一 stableId 的 typed edit，保留人工布局/样式；scene.update 仅用于 Scene 级默认值”。模型不能调用 session 管理、project.create 或给自己任意工程授权。

## 4. 画布与直接编辑

- **iframe**：`sandbox="allow-scripts"`（无 `allow-same-origin`）、`referrerpolicy=no-referrer`；父页面不读取沙箱 DOM，不把 `origin=null` 当认证。消息信封 `{v,kind:cmd/evt,instanceId,nonce,seq,type,payload}`；Host/客户端校验 `event.source === iframe WindowProxy`、instanceId、32-hex nonce、严格形状/序号/replyTo；未知/迟到/跨实例消息丢弃并计数。runtime 自带时钟覆盖 `#main[data-duration]`，命令覆盖 `ping/state/seek/play/pause/hitTest/getElements/destroy`，事件 `ready/state/seeked/playing/paused/hit/elements/error/destroyed`。
- **letterbox/坐标**：舞台按容器尺寸等比缩放并居中；点击用 `screen -> composition` 的 scale/offset 逆映射；选择框/手柄/原位输入只在 Host 编辑层，快照 DOM 不变。
- **直接编辑**：文字（双击原位，Enter 真实提交，Esc 取消）、layout（拖动/四角缩放手柄，composition CSS px，暂停时写）、style（颜色/字号）；每次提交携带 `expectedRevision`+`operationId`，成功后换新 revision/快照，失败保留旧状态并显示可恢复错误。播放中禁止写；SVG/任意代码不在范围。
- **Scene**：底色 `scene.update` 受控 color，新增 Scene 默认 5s；没有底部场景卡片；旧右侧目标下拉/表单不再是 managed 工程主路径；legacy demo 仍走原 PNG/文本/时间路径，不伪装 layout/style 能力。
- **AI 同步**：面板每 2.5s 重新 inspect；检测到 revision 变化就撤销旧快照/载入新 revision，保留播放位置/选中 stableId（对象不存在则清除）。未用假数据。

## 5. 素材抽屉

- 左上按需打开；`<input type=file accept="image/png,image/jpeg">` 直接上传字节，无绝对路径/URL；Host 返回 receipt 后调用 `asset.import`；成功后刷新 inspect，列出 `assets/*.png|jpg`；“用作画面”把当前 Scene 的 `shot` 设为该 asset（携带当前已知 Scene 标题/时长/底色）。
- worker 侧限额沿用：单张 ≤8 MiB、每工程 ≤16 张图片、声明资产总量 ≤64 MiB；视频/音频/SVG 明确拒绝，不画假按钮。原生附件不会自动全部入库。

## 6. 验证证据

| 检查 | 结果 | 证据 |
|---|---|---|
| `npm run check` | **42 + 56 + 38 = 136/136** | 静态 42（含 canvas/runtime/Host 方法门禁）、Client smoke 56（含 managed 新工程→Session→画布 shell/iframe/snapshot/播放/素材入口）、Host 契约 38（含 layout/style 参数、Tool UI-only 拒绝、snapshot CSP/字节/release、inbox receipt） |
| 版本门禁 | **10/10** | alpha.3 |
| 旧 demo Host→engine 兼容链 | ok=true | `artifacts/p2-b/evidence/engine-run-2026-10-18T04-55-59-463Z.json`，SHA `afadbd4f…dbf29` |
| 受控新工程全链 | ok=true | `artifacts/p2-b/evidence/canvas-chain-2026-10-18T04-56-14-621Z.json`，SHA `2d632f6b…997a0` |
| 真浏览器 runtime | ok=true | `artifacts/p2-b/evidence/canvas-browser-2026-10-18T04-56-15-926Z.json`，SHA `b54beea5…9f1d5` |
| 真实帧/渲染产物 | frame 14,970 B/`e9538abb…`；MP4 161,844 B/`0e0d6333…` | `artifacts/p2-b/evidence/p3-008-artifacts/frame-yellow-1.5s.png`、`render-15s.mp4`；与 canvas-chain 证据一致 |

### 受控新工程链关键数据（canvas-chain）

- 新工程 `proj-mvdcrgwh-1d4c757b`，初始 revision `51686ab6…a28236e`；绑定 Session `session-canvas-42c68558-1`；3 Scene 各 5s，总 15s。
- 换背景黄：`scene.update` → revision `51b0d542…c3bcdf`。
- 人工同对象 `scene-1-title` text+layout+style（left 120/top 260/width 900、color `#112233`、fontSize 64）→ revision `c2f02526…326d379`；undo 回到 `51b0d542…` 文案恢复默认，redo 回 `c2f02526…` 且人工文案回来。
- PNG 上传/导入：`assets/canvas-test.png` 68 B / SHA `71a8ae4e…986aa7f`，revision `3afd4366…42d77b`；用于 `scene-1` shot → revision `b4a06abd…5f115f75b`。
- 快照 `4686f66064397ebfe8f9a873a707a0ed`：entry 路由 200、runtime 注入、CSP、assets 字节正确；release 后路由移除。
- 最终 frame：job succeeded，1.5s PNG 14,970 B / `e9538abb…`；`(8,8)` 像素实测 **RGB 255,212,0**（黄色）。
- 最终 MP4：**161,844 B / SHA `0e0d633357a8bf924148815c5a97884d952cd3e83b2f41feec1ddce49a9cefce`**；H.264 1280×720、30/1、450 帧、15s。
- history：6 条、canUndo=true；close/reopen revision 保持 `b4a06abd…`，3 Scene/15s 与导入资产保留；hostWarnings=[]。

### 真浏览器 runtime 数据

- Chrome `155.0.8059.84`，沙箱 iframe 加载快照 entry；`ready` runtimeVersion `p3-008-runtime.1`、1280×720、5s。
- seek 3s 精确；hitTest 命中 `scene-1-title`（rect x88 y196 w980 h71.67）；播放 450ms 推进到 3.43s 后暂停；外部网络请求 **0**、console error **0**。
- 这是独立开发页 + 同一 Host 快照/固定 runtime 的真浏览器验证，不是真实 DSH 插件激活。

## 7. 未测 / 风险 / 回滚

- **未安装 alpha.3、未启停/重启、未发真实模型请求**；未在真实 DSH 页面点击画布/拖拽/抽屉/导出，不能把本文件当安装验收或 AI 真机闭环。
- 真实 AI 同对象续改保留人工布局：由 Host/Tool typed ops + prompt context 契约保障并有 engine/Host 测试，但没有真实模型 UI 证据。
- 拖拽/缩放鼠标手势、播放观感、窄窗/明暗/宿主字号/reduced-motion 像素级表现需安装验收。
- Scene 读取接口不暴露 color/shot；UI 对重开工程的自定义 Scene 颜色/旧 shot 只能按本地已知字段或默认模板重建，本版未声称完全恢复任意历史自定义 Scene 字段；后续需受控 inspect 扩展。
- BUG-001 渲染底部黑带未修；MP4 视觉质量不标通过。
- 安全边界：sandbox/CSP/精确路由是隔离与资源约束，不是 OS 沙箱；仅受控 `product-launch-v1` 模板，不支持任意 HTML/JS、SVG、视频/音频素材。
- 回滚：现有安装仍是 alpha.1/旧引擎，无需回滚；如后续安装 alpha.3 后需回退，按 Plugin Manager remove 后 link 回 `artifacts/p2-b/staging-54f4671-b382686/bundle`（alpha.1）。不手改 profile。
- C 的 alpha.2 固定包/staging 独立保留、未覆盖；未改 engine/p1/spike/全局文档；未 merge。

## 8. 联合复审 R1–R5 修复轮（2026-10-18，固定引擎 d383e3d / 0.3.2）

本节记录 [P3-008 联合复审](../reviews/P3-008-review-01.md) 五项缺陷与 parent 消息契约的修复实现、固定候选和证据；结论与交付清单以 [任务执行记录](../tasks/P3-008-canvas-ai-integration.md) 为准。**未安装/未重启/未发真实模型请求/未 merge；旧候选与 alpha.1 安装保留。**

### 8.1 固定基线

- 引擎最终固定 **`d383e3d53a9401285519ee578d993081c3cb4b51` / client·worker `0.3.2`**（P3-009 完整 `scene.template` 读取契约 + BUG-001 全幅修复均已经独立复审）；p1 树 `artifacts/engine/d383e3d/` 两包 SHA-256 与 P3-008 指南一致（client `0830ab71…1311a5`、worker `e4e16141…3716c3`）。不读移动 HEAD、不 merge p1。
- 新 staging **`artifacts/p2-b/staging-d383e3d-5f2df96`**：root `5f2df96`、engine `d383e3d`、bundle `0.3.0-alpha.3`、client/worker `0.3.2`、rootDirty=false；INTEGRITY `f0065803…73b52d`、config `2dcb316a…1c3171`；bundle 22/client 16/worker 35 文件摘要通过。
- 固定包 `artifacts/p2-b/5f2df96/dsh-video-0.3.0-alpha.3.tgz`：103,200 B / 23 files / SHA-256 `b0af95b4…0a45`，23/23 与提交 `5f2df96` 逐字节一致。

### 8.2 实现要点

1. **R1 完整 Scene 模板（client）**：`canvasCopySceneTemplate`/`canvasSceneTemplate` 从当次权威 `inspect` 复制冻结模板 `{title,duration,subtitle?,badge?,color?,accent?,logo?,shot?}`，拒绝 sceneId 与未知键；`applySceneColor`/`useAsset` 只改 color/shot 并用该 inspect 的 revision 提交。模板缺失/非法 → 本地化拒绝 + 零 `scene.update`。真实链验证：换色后 subtitle/badge/accent/shot、其它 Scene 与人工 layout/style 均保留；真实 Host Tool `project.revise` 在人工编辑后续改 `written=true`，保留人工 layout/style/subtitle/badge/shot；close/reopen revision 不变。
2. **R2 静态基座逆映射（client）**：`canvasStaticBase` 读 `elements[].layout`（null=auto），`canvasLayoutPatch` 用动画命中矩形与预览矩形求 patch：move 只写 left/top=base+动画增量；resize 以 sx=动画宽/静态宽、sy=动画高/静态高（未知回退 sx）逆映射宽高，west/north 再按 scale 逆映射 left/top；不写动画偏移/transform/伪 auto 尺寸；静态原点/必需 scale 未知时拒绝。失败保留选择与拖动前矩形、不自动重试。
3. **R2 附带修复（真实浏览器发现）**：快照 iframe 必须保持 composition 尺寸（1280×720）并由 Host 层 CSS `scale(stage scale)` 缩放。否则 iframe 被拉伸成 letterbox 后视口（如 600×337.5），scale<1 时画面被裁切，且 runtime `elementsFromPoint` 命中在 composition 坐标越界后静默 miss（真实 Chrome M2/M4 复现）。修复后 iframe offset 1280×720 + `matrix(scale…)`，600×500 letterbox 下 composition x=678 命中恢复。另用 `.dv-stage.dv-canvas-stage` 隔离 legacy `.dv-stage` flex/padding 对舞台尺寸的拉伸。
4. **R5 失败恢复（client）**：编辑器打开时生成一个 operationId 并跨重试复用（worker 幂等，uncertain 不重复应用）；成功后才关闭+reload；失败保留 draft/target/error 与 `.dv-editor-retry`；冲突需显式 retry 先 `onReload` 刷新权威 revision，再显式提交；Esc 零请求。真实浏览器覆盖 E_PERSIST、Esc、真实 revision 冲突两阶段与成功路径。
5. **R6 parent 消息契约（client）**：按已审 P3-005-B `contract.js` 实现纯函数 `canvasValidateEvent`/`canvasValidateCommand`/`canvasMessageLedger`：v1 信封/固定键/允许事件/逐事件载荷形状/每实例单调序号/仅相关回复；错误来源/实例/nonce/迟到/重复/超长丢弃；pending 在 unbind、快照替换、destroyed、实例撤销时显式结算（resolve null + 清 timer + 清 Map），不靠清 timer 留悬挂 Promise。
6. **R3 预览归属（host）**：`VideoBridge.previewRoots(projectId,sessionId,path)` 生成 owned roots：本工程工程目录（managed/legacy 注册表 realpath）、`<sessionCwd>/<projectId>` 工程独立 Session 根（新 Session 同时创建于此）、jobs 登记归属的 `<jobId>.png|mp4`、本工程 receipt target；旧共享 sessionCwd 仅当绑定 Session 自己的 `inspect` 事件明确引用精确路径时允许（512 events/256KiB/depth8 有界扫描；controller 或事件不可用即拒绝；其它工程 per-project Session 根排除）。`host/preview.js` 只按这些 roots + 精确 verifier 读取；同根跨工程 artifact/工程目录/receipt、symlink/`..` 逃逸、任意绝对路径拒绝。
7. **R4 准入/排空/清理（host）**：`VideoBridge.invoke()` 非 async 单点准入，在任何 await 前把 dispatch task 加入唯一 `inFlight`；`dispose()` 先 `closing` 并取消上传 reader，再排空 inFlight，最后 teardown worker/session/snapshot/inbox；迟到 `preview.snapshot` 返回 `E_WORKER_DISPOSED` 且用未关闭的 client 直发 `preview.release`，不注册路由/record。`AssetInbox` 校验可信工程、跟踪 handler/reader、上限 32 receipt、失败/过期/dispose 清理本实例创建的文件（不删已复制工程资产），重复 dispose 幂等。

### 8.3 验证摘要

- `npm run check`：**167/167**（48 静态 + 75 Client smoke + 44 Host），版本门禁 10/10。
- 固定 staging 真实链：`engine-run-…05-48-18-895Z.json` ok=true；`canvas-chain-…05-48-47-303Z.json` ok=true（R1 模板/换色/换 shot 保留、Tool project.revise 续改、R3 归属、R4 dispose）；`canvas-browser-…05-48-48-744Z.json` ok=true。
- 真实 CanvasWorkspace 浏览器手势/失败恢复：`staging-d383e3d-5f2df96/evidence/canvas-workspace-2026-10-18T05-48-26-807Z.json`，**10/10 用例、175/175 断言、ok=true**；staged client.js SHA `8c4c2b12…cf9957` 与 INTEGRITY 一致；外部网络 0、非预期 console 0、page error 0、teardown clean、staging 不可变源文件 75/75 未变。
- 真实帧/MP4：frame PNG 22,734 B / `9a0dcdf7…`（像素 255,212,0）；MP4 143,794 B / `e2bc1806…`，1280×720/30fps/450 帧/15s；1.5/7.5/13.5s 底部 86 行均非黑（darkRatio=0，有可见内容）——0.3.2 黑带修复在本任务 staging 上复核通过。证据 `artifacts/p2-b/evidence/p3-008-r5/render-check.json`。

### 8.4 未测/边界

- 未安装/启停/重启、未在真实 DSH 页面点击；浏览器证据是真实 Chrome + 真实 staged Host/worker/runtime + 真实 DOM 手势的开发页组件验证，不是真实 DSH 激活或安装验收。
- 未发真实模型请求；AI 续改链由真实 Host Tool→worker project.revise（Session scope）验证，不冒充模型驱动 UI 闭环。
- 受控 `product-launch-v1` 之外（legacy demo/任意 HTML/视频/音频/SVG）不支持；iframe/CSP/精确路由不是 OS 沙箱。

## 9. 第二轮复审 R1-follow-up / R5-follow-up 补修（2026-10-18，固定引擎不变 d383e3d/0.3.2）

本节记录 [P3-008 第二轮复审](../reviews/P3-008-review-02.md) 两项补修的最终实现、固定候选与证据；结论与交付清单以 [任务执行记录](../tasks/P3-008-canvas-ai-integration.md) 为准。R2 动画基座/letterbox、R3 归属、R4 准入排空、parent 消息等已通过项保持原实现与回归，不重做调查/黑带定位；未安装、未重启、未发真实模型请求、未 merge、未改 p1。

### 9.1 固定基线（未换引擎）

- 仍固定已复审 `d383e3d53a9401285519ee578d993081c3cb4b51` / client·worker `0.3.2`；包摘要与 P3-009 复审一致。
- 新 staging `artifacts/p2-b/staging-d383e3d-7d60312`（root `7d60312`、INTEGRITY `b4fadefa…30d0f69a`、rootDirty=false、bundle22/client16/worker35）与固定包 `artifacts/p2-b/7d60312/dsh-video-0.3.0-alpha.3.tgz`（104,913 B / 23 files / SHA-256 `7bccb425…2cd46ab`，23/23 与提交逐字节一致）。
- 修复提交：`c2a1e2b`（Host 模板文本上限）、`550516d`（Client 不可变写入尝试 + Client 模板上限）、`9d74f46`（chain/静态门禁）、`d4f3f73`/`7d60312`（真实浏览器 T4 用例与 runner）。

### 9.2 R1-follow-up：长模板上限对齐

- 缺陷：Client `canvasCopySceneTemplate` 与 Host `sceneTemplate` 仍用旧投影上限（title 200、subtitle 300、badge 48），而冻结 0.3.2 与 typed text 编辑允许 title/subtitle/badge 各 2048；用户在画布/AI 写入长文案后无法再换 background/shot 或用完整模板 Tool revise。
- 实现：两处统一为 UTF-16 length（与 worker `validateSceneSpec` 的 `value.length` 一致）：title 1..2048；subtitle/badge 0..2048（空串合法）。保留 duration 0.5..60、color/accent 正则、logo/shot 资产路径、未知键拒绝与 full-template 要求；不截断；2049 在 Host 侧 `E_PARAMS` 于 worker 前拒绝。`host/tool.js` template JSON schema 保持 type-only（Host 为权威校验器，避免第二份契约）。
- 回归：Client smoke 覆盖旧上限穿越（201/300/301/49）、2048 边界保留、2049 拒绝、空 title 拒绝、空可选字段、UTF-16 astral 语义；Host check 覆盖 scene.update/scene.create/project.revise 三方法的接受/拒绝边界与“未截断字符串逐字节到 worker”。真实 Host→worker 链写入 300/400/60 长文案后 `inspect.template` 完整往返，仅改 color/换 shot/Tool revise 均保留长 subtitle/badge/shot 与人工 layout/style；2049 模板逐字段 `E_PARAMS` 且 revision 不变。

### 9.3 R5-follow-up：不可变写入尝试

- 缺陷：operationId 以编辑器生命周期为单位，而 worker 幂等键是完整请求签名（operationId+expectedRevision+ops）。真实写已落盘但响应丢失后，用户修改保留草稿再提交会复用旧 id → 必然 `E_OPERATION_REUSED`，且可能把变化草稿与陈旧 revision 混在一起；仅靠“保留草稿”不能恢复。
- 实现：编辑器新增冻结 `attempt {operationId, expectedRevision, ops, value}`，首次显式提交时先冻结后发送。① 草稿未改：显式重试原样重发冻结请求，不读取最新 revision/草稿；若原写已落盘，worker 在 revision 检查前按同签名返回缓存成功 → 只应用一次并关闭。② 草稿已改：先重发旧冻结请求结算旧尝试，成功后用结算结果 revision + 新 operationId + 新文案发送；结算冲突（无缓存 ⇒ 旧写未落盘）走既有显式 refresh 两阶段；结算 uncertain/E_PERSIST 保留旧 attempt，不换 id。③ 任何 E_OPERATION_REUSED 都进入可恢复 refresh 路径，不再死路；Esc 仍零写；不自动重放/静默覆盖，无需 Esc/重开编辑器脱困。
- 回归：smoke 新增 5 条（写已落盘+丢确认的未改草稿原样重试、改草稿先结算再新 id、settle 也丢确认、冲突 refresh 后新 id、E_OPERATION_REUSED 可恢复）且原 E_PERSIST/network/Esc/成功/冲突两阶段保持。真实浏览器新增 T4A/T4B/T4C：首写经真实 Host 落盘后丢弃响应（页面得到 uncertain），未改草稿精确重试同 body 得到缓存成功、单编辑根且无新 revision；改草稿先同 body settle 再用新 operationId/settled revision 提交新文案；并发 revision 下真实 409 后显式 refresh 再以第三个新 id 提交。证据见 `staging-d383e3d-7d60312/evidence/canvas-workspace-2026-10-18T07-36-42-636Z.json`（13/13 用例、249/249 断言、外部网络 0、非预期 console 0、teardown ok、staging 不可变源文件 75/75 未变）。

### 9.4 验证摘要（固定 staging d383e3d-7d60312）

- `npm run check`：**48 静态 + 80 Client smoke + 46 Host = 174/174**；版本门禁 10/10。
- 真实链：`engine-run-…07-36-10-512Z.json`（SHA `8d968506…`）ok；`canvas-chain-…07-36-40-021Z.json`（SHA `1f5d37f8…`）ok，含长模板往返/2049 拒绝、仅改 color/换 shot/Tool revise 保留、R3 归属、R4 dispose、frame 像素 255,212,0；`canvas-browser-…07-36-41-418Z.json`（SHA `832d382a…`）ok。
- 真实 CanvasWorkspace：13/13 用例、249/249 断言、ok=true（原 10 用例 175/175 保持）；staged client.js SHA `ec2ff3ff…` 与 INTEGRITY 一致；T4A/T4B/T4C 关键 operationId/revision 序列见任务记录。
- MP4：328,275 B / SHA `3f464ba1…`，H.264 1280×720/30fps/450 帧/15s；1.5/7.5/13.5s 底部 86 行非黑；frame PNG 像素 255,212,0；`artifacts/p2-b/evidence/p3-008-r5/render-check.json`（SHA `b3922dc7…`）。

### 9.5 未测 / 边界

- 未安装/启停/重启、未在真实 DSH 页面点击；浏览器证据是真实 Chrome + 真实 staged Host/worker/runtime + 真实 DOM 手势的开发页组件验证，不是 DSH 宿主 React/Slot 激活或安装验收。
- 未发真实模型请求；AI 续改由真实 Host Tool→worker project.revise（Session scope）证明。
- 仅受控 `product-launch-v1`；legacy demo、任意 HTML/视频/音频/SVG 不支持；iframe/CSP/精确路由不是 OS 沙箱。
- 当前安装 alpha.1、旧候选/旧 staging/旧证据保留；未 merge、未改 p1/全局协调文档。
