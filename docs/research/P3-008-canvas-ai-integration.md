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
