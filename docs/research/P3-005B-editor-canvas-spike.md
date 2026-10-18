# P3-005-B 受控画布播放、点选与直接编辑验证（spike）

日期：2026-10-18。执行：p1-engine 工作区；分支 `codex/p1-engine-spike-b4bf` / PR #2；开工 HEAD **`e364017`**（已验 P3-004 交付 head，功能固定 **`df4b74f`** / 两包 0.2.1）；协调记忆读取自 `origin/codex/project-foundation` @ **`920957d`**（开工 `git fetch origin` 成功；此前一次 SSL 失败后重试通过）。实现提交 **`4ad7b2e`**（spike + 证据）；本记录另以 docs 提交。

本轮只新增 `spikes/editor-canvas/**`、`docs/research/P3-005B-editor-canvas-spike.md` 与本任务记录；**未改**两引擎生产代码/协议/schema（`git diff df4b74f -- packages` 为空）、未改根插件/Host/其它 spike/全局记忆/profile；未安装/启停/重启 DSH、未调模型、未 merge、未新 tree/PR。试验页是独立自动化试验页，**不是 DSH 真机，也不是最终 UI**。

## 结论（先行）

1. **最小真实链路跑通**：真实 worker 受控工程 → `preview.snapshot` → Host 只按 manifest 路由精确字节 → 沙箱 iframe（opaque origin）播放/seek → 点击选中实际对象 → 双击原位修改文字 → 共享 worker `edit`+`expectedRevision`+`operationId` 写回 → 新快照重载。41/41 自动化断言通过；9 个时间点 seek 请求/落点一致；预览与 worker 抽帧在 1.5/5.5/9.0s：**Δ≤2 容差内像素一致 99.30%/99.10%/99.93%**，**精确逐像素相等 99.28%/97.93%/99.92%**，MAE 0.36/0.30/0.04（差异集中在字形抗锯齿；5.5s 的精确相等率最低）。
2. **写回能力缺口明确**：现有协议只能持久化 **文字**（`text`）与 **元素显式 timing**；**Scene 级**颜色/强调色/Logo/截图/时长/标题可由 `scene.update`（整 Scene 重写）持久化。**元素位置 left/top、尺寸、颜色/字体等样式、层级/旋转、拖动/缩放均无 worker 写路径**：Host 侧拖动/缩放只能改编辑层，提交 `layout` typed op 被 worker 以 `E_PARAMS: Unsupported edit type` 拒绝，revision 不变，重载后回到模板位置。SDK `setStyle` 可在 Host 自有副本持久化，但随后 `scene.update` 的整 Scene 重生成会把元素级样式覆盖回模板值——正式实现必须把 typed layout/style op 接进生成器、历史与合并路径，不能靠 SDK 旁路写入。
3. **消息/坐标契约可冻结为 v1 最小集**：iframe WindowProxy 身份 + 每实例 instanceId + nonce + 严格消息形状/序号；`event.origin` 在 opaque origin 下为 `"null"`，**不能作为认证**；nonce 不是沙箱。命令 `ping/state/seek/play/pause/hitTest/getElements/destroy`，事件 `ready/state/seeked/playing/paused/hit/elements/destroyed/error`；所有跨层坐标使用 **composition CSS px**，Host 独立处理 letterbox/缩放。未知 stableId 在调用 worker 前由 Host 拒绝；过期 revision 没有推送通道可预知，由 worker 以 `E_REVISION_CONFLICT` 拒绝，Host 呈现冲突并支持刷新后重试。
4. **快照生命周期与隔离资源边界已实测**：`sandbox="allow-scripts"`（无 `allow-same-origin`）、`referrerpolicy=no-referrer`；父页面读 `contentDocument` 为 `null`、`contentWindow.document` 抛 `SecurityError`；entry 响应 `default-src 'none'`、`connect-src 'none'`、`frame-ancestors 'self'`、内联 timeline 按 sha256 hash 放行、Host 注入固定 runtime（外部脚本，受 host source 限制）；加载只请求本 Host 路由，外部请求 0，断网后 seek/play/选中仍工作。**只证明受控模板可行，不证明任意 HTML/JS 安全或完整沙箱。**
5. **证据与清理**：`spikes/editor-canvas/evidence/`（JSON 状态/哈希/对比 + 截图，约 0.7 MB）；销毁实例后无 frame、无新命令/事件；快照释放后 Host 路由 404、`previews/` 为空、运行目录删除、浏览器与服务关闭。

## 交付物与复跑

- 代码/证据：`spikes/editor-canvas/**`（README 含固定输入与命令）。
- 复跑（仓库根）：
  - `npm test --prefix spikes/editor-canvas` → 合约 + Host 服务 **10/10**，约 1.2s。
  - `node spikes/editor-canvas/scripts/run-canvas.mjs --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` → 真实 Chrome **41/41**，约 21s，输出 `evidence/canvas-evidence.json` + 截图。
  - `node spikes/editor-canvas/scripts/capability-probe.mjs` → 能力矩阵，输出 `evidence/capability-evidence.json`，约 3s。
- 固定输入：引擎 `df4b74f` / 两包 0.2.1、Node v24.14.0、Chrome 155.0.8059.84、puppeteer-core 25.14.0、`@hyperframes/sdk` 0.8.167、contract v1、runtime `p3-005b-runtime.1`。puppeteer/SDK 复用 worker 的 node_modules，本 spike 无独立依赖、无安装脚本。

## 验证数据

| 项 | 结果 |
|---|---|
| 受控工程 | 3 Scene（5+4+2=11s）、1280×720/30fps、4 个声明资产；inspect 12 个可点对象（9 个 text/timing，2 个空 capability 图片/线，1 个 badge） |
| 播放/seek | 9 点：0/0.5/1.5/2.75/4.99/5.0/6.5/9.0/10.99s 请求=落点；播放 800ms 推进约 0.70s；暂停后 250ms 时间不变 |
| 与 worker 抽帧 | 1.5s：Δ≤2 容差 99.30%（精确 99.28%）、MAE 0.358、maxΔ226；5.5s：99.10%（精确 97.93%）/0.297/240；9.0s：99.93%（精确 99.92%）/0.042/232 |
| 引擎身份 | 由 runner 执行 `git diff df4b74f -- packages` 验证两包字节未变（`packagesUnchangedSinceReviewedCommit:true`），证据记录当次 HEAD；worker/client 版本 0.2.1 |
| 快照生命周期 | 旧 revision 请求 → `E_REVISION_CONFLICT`；切换后旧 snapshotId 的 Host 路由 **404**、worker 释放 → `E_SNAPSHOT_NOT_FOUND`；worker 退出后 `previews/` 为空 |
| 断网播放 | 加载完成后 `page.setOfflineMode(true)`（`navigator.onLine=false`），9 点 seek、播放/暂停、命中/选中/letterbox 全部照常；写回阶段恢复在线（`restoredOnline:true`） |
| 命中/选择 | 单击命中 `scene-1-title`；选中覆盖层只在 Host 层，沙箱 elements 矩形不变；scene 边界 4.99s→scene-1-title、6.5s→scene-2-title；5.01s 标题入场动画未可见 → 结构容器（明确规则） |
| 隐藏/重叠 | 5.1s 点 scene-2-subtitle 坐标 → `scene-2-section`（时间窗未开始）；5.6s → `scene-2-subtitle`；重叠点返回 shot，stack `[shot, rule, section, main]` |
| letterbox | 1100×700（scale 0.859375，top 40.625）与 760×640（scale 0.59375，top 106.25）：映射点击命中同一 stableId，留白区不命中 |
| 文字编辑 | Esc 取消：revision 不变；Enter 提交：`449648a3…` → `876ae63b…`，inspect/新快照文字为“画布原位修改”；close/reopen 与整 worker 重启后仍为同一文字/revision |
| 冲突 | 外部写入 `外部 AI 修改` 后旧快照提交：`E_REVISION_CONFLICT`，未覆盖；刷新后重试成功 `07244433…` → “冲突后重试” |
| 失败恢复 | 项目目录只读：`E_PERSIST`，草稿保留、revision 不变；恢复权限后重试成功 `25397eb4…` → “持久失败后重试” |
| 拖动/缩放缺口 | 拖动仅编辑层（88,196→208,236），快照 DOM 矩形不变；`layout` op → `E_PARAMS`，revision 不变；缩放同理；播放中拖动被阻止 |
| 合约探针 | runtime 消息 origin=`null`；错误 nonce 无响应（0 命令/事件增量）；foreign source +1；撤销实例后 `E_INSTANCE_NOT_FOUND`；ledger 对跨实例/迟到/过期序号拒绝（Node 合约测试） |
| 清理 | 实例销毁 1/1、frame=0、销毁后 300ms 命令/事件增量 0；Host 快照路由 404；`previews/` 空；临时目录删除 |

## 消息契约提案（v1，最小）

信封：命令 `{v:1, kind:"cmd", instanceId, nonce, seq, type, payload}`；事件 `{v:1, kind:"evt", instanceId, nonce, seq, type, replyTo, payload}`。绑定期望：每实例随机 `instanceId`（随 URL 传给 runtime）+ 32-hex `nonce`（每条命令/事件回显）；Host 校验 `event.source === 该 iframe 的 WindowProxy`、instanceId、nonce、形状、序号；**origin 不能当认证**（opaque origin 恒为 `"null"`），nonce 也不是沙箱。

- 生命周期：创建实例（唯一 id/nonce）→ runtime 载入后发 `ready{runtimeVersion,width,height,duration}` → 命令/应答（应答必须 `replyTo` 对应命令 seq；`seq` 单调；迟到/未知/跨实例应答丢弃并计数）→ 新快照时 Host 销毁旧实例（拒绝后续命令，旧事件丢弃）→ `destroy` → `destroyed`。
- 严格形状：payload 只允许类型定义的键；`seek.time`、`hitTest.{x,y}` 必须有限数；`duration` 来自 `#main[data-duration]`；时间越界返回 `error{E_TIME_RANGE}`；Host 侧在调用 worker 前校验 **revision 必须等于当前显示快照**、**stableId 必须在该快照 inspect 目录且具备 text capability**。
- 坐标：跨层一律 **composition CSS px**（0..data-width/height）；Host 用 `computeStage` 计算 letterbox 的 `scale/left/top` 与 `compositionToScreen`/`screenToComposition`；沙箱文档保持自然尺寸、由外层 CSS transform 缩放。选中框/手柄/原位输入框都在 Host 编辑层，不修改快照 DOM。
- 播放模型：composition duration 以 `#main[data-duration]` 为准（本工程 11s，而 GSAP timeline 因最后场景无尾部 tween 只到 10.4s）；runtime 用自身时钟覆盖整段 duration，渲染 `min(time, timeline.duration())`，并按 `data-start/data-duration` 在每步应用可见时间窗（这是在预览侧对 HyperFrames 导出语义的近似，需要正式实现前冻结/验证）。

## 直接编辑可持久能力矩阵

| 能力 | 现有路径 | 持久化 | 依据 / 缺口 |
|---|---|---|---|
| 文字内容 | `edit {type:"text",target,text}` | ✅ | 实链提交、inspect/新快照/重启后一致 |
| 元素显式 timing | `edit {type:"timing",target,start?,duration?}` | ✅ | start 5.3/duration 3.5 写回 inspect |
| Scene 颜色/强调色/Logo/截图/时长/标题 | `scene.update`（整 Scene 重写） | ✅ | `background:#123456`/`#abcdef` 写入快照；元素 left/top 保持模板 88/196 |
| 元素位置 left/top | 无 worker 方法；SDK `setStyle` 仅 Host 副本 | ❌ | `layout` op → `E_PARAMS`；拖动仅编辑层；重载回模板位置 |
| 元素尺寸 width/height | 同上 | ❌ | `resize`/`layout` op → `E_PARAMS` |
| 元素颜色/字体/字重/对齐 | 无 worker 方法（Scene 级颜色≠元素颜色） | ❌ | `style`/`color` op → `E_PARAMS`；SDK 仅副本 |
| 拖动/缩放直接操纵 | 无协议方法 | ❌ | canvas 证据：暂态 + 提交被拒；revision 不变 |
| 层级/z-index/旋转 | 无方法 | ❌ | `E_PARAMS`；模板无对应模型字段 |
| SDK 旁路写入 | `comp.setStyle(id,{left,top,width,height,color})` + `flush` | ⚠️ 仅 Host 自有副本 | 写入副本后 HTML hash 变化；随后 `scene.update` 整 Scene 重生成把 title 样式还原为模板 `left:88px;top:196px`，SDK 样式未保留 |

**最小 typed 操作提案（不在本任务实现）**

```json
{"type":"layout","target":"<stableId>","box":{"left":120,"top":240,"width":900,"height":80},"unit":"composition-px"}
{"type":"style","target":"<stableId>","styles":{"color":"#ff0000","fontSize":"48px"}}
```

约束：整数级 composition px、画布边界与最小尺寸校验；只对具备 layout/style capability 的对象开放；必须复用 `expectedRevision`+`operationId` 幂等、`recordWrite` 历史与 undo；不得改写 GSAP timeline 条目（inline left/top 是静态基座，GSAP 的 y/scaleX 是相对变换）；`merge.mjs` 的 stableId 签名已包含 `inlineStyles`，style/layout 变更应参与同一三方合并；`scene.update`/`project.revise` 的整 Scene 重生成必须保留元素级 deltas 或显式返回冲突，不能静默覆盖。正式接线还需 engine 测试（写入/冲突/undo/merge/限额）、Host 会话/资产路由、UI 画布/覆盖层/工具条拆分。

## 隔离、CSP 与资源装载（实测）

- `sandbox="allow-scripts"`（无同源/弹窗/表单/top 导航）；`referrerpolicy=no-referrer`；父页面无法读取沙箱文档（`contentDocument=null`，`contentWindow.document` 抛 `SecurityError`）。
- Host 只注册当前 `snapshotId`，只按 worker manifest 精确相对路径供字节；注册与每次请求都校验字节/`sha256`，篡改返回 409 `E_SNAPSHOT_CORRUPT`；未知/撤销快照 404；entry 原始字节 hash 校验后才注入固定 runtime。
- CSP：`default-src 'none'; script-src <host> 'sha256-<inline timeline>'; style-src <host> 'unsafe-inline'; img-src <host> data:; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'`。加载期只请求 Host 路由（session/entry/assets/runtime/page），外部请求 0；断网后播放/seek/选中仍工作。
- bridge 不暴露 Host/Node/模型权限：沙箱内无 Node API、无宿主桥；Host 反向只投递白名单命令；runtime 不联网（CSP `connect-src 'none'`）。

## 未测项 / 风险

- 未接入真实 DSH：宿主 CSP/焦点/主题/多插件共存、真实 Host 的精确资产路由与会话生命周期均未测。
- 抽帧一致性只在 3 个采样点、以 Δ≤2 容差与精确相等双口径报告，不是逐帧 parity。
- 只验证受控 `product-launch-v1` 模板；任意工程 HTML/JS、不可信素材、SVG/视频/音频、多用户并发、Safari/Firefox/Windows 未测。
- sandbox/CSP 是隔离与资源约束，不是完整浏览器/渲染器安全边界或 OS 沙箱；inline hash 只覆盖受控模板的已知内联脚本。
- 预览的 `data-start` 时间窗由 runtime 近似实现，与 HyperFrames 真导出在边界/动画细节上可能不同；抽帧仅 3 个采样点、99% 级一致，不宣称逐帧 parity。
- 拖动对齐线、缩放比例约束、完整浮动工具条、多选不在本 spike；位置/缩放/样式正式写回需引擎新 typed op + 历史/合并/Host/UI 分阶段实现。
- 消息契约中 `instanceId/nonce` 只用于绑定与串话防护（非认证）；真实 DSH 中还需 Host 自己的权限/路由边界。
