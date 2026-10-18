> 固定交付ea2d1a4的记录；2026-10-18总调度已独立复审通过，见 [P3-005B-review-01](../reviews/P3-005B-review-01.md)。这是受控独立浏览器spike，不是DSH生产界面；下一任务P3-006-B。

# P3-005-B：受控画布播放、点选与直接编辑验证

日期：2026-10-18。执行：**p1-engine**；分支 `codex/p1-engine-spike-b4bf` / PR#2；开工head `e364017`，已审功能固定 **df4b74f / 两包0.2.1**。沿用当前树；先记实际HEAD和协调SHA，不reset。依据 [P3-004复审](../reviews/P3-004-review-01.md)。

## 目标与范围

验证“worker预览快照→隔离画面播放/seek→点击选中→文字原位修改→共享worker写回→新快照”的最小真实浏览器链，并识别位置/缩放/样式写回的确切缺口。为正式画布接线冻结消息和坐标契约，**不是开发最终DSH UI，也不是只做静态PNG点选。** 产品方向读最新PRODUCT/FRONTEND-DESIGN：右AI常驻、左直接编辑、无底部场景卡片。

允许：`spikes/editor-canvas/**`、`docs/research/P3-005B-*.md`、本任务记录；必要独立包/锁文件仅在该spike内部，优先复用当前已安装的puppeteer-core等开发工具，不引入线上依赖/未知安装脚本。所有项目/素材/截图/产物使用任务自有fixtures/artifacts。

不改根插件、Host、两引擎包生产代码/协议/schema、其他spike、全局记忆、profile；不安装/启停/重启DSH，不调模型，不merge，不新tree/PR。发现引擎缺能力先给契约提案，不能越界私加接口。浏览器操作使用绑定该试验页面的自动化，不用全局坐标/键盘/剪贴板。

## 必须验证

1. 通过公开client/worker调用创建受控多Scene工程、open/inspect、previewSnapshot。入口和资源只从worker声明manifest读取，校验路径/字节/hash；不改快照内容，不使用任意URL/宿主凭据。取快照时固定revision，切换后释放旧快照，过期/release/close/worker退出有明确无效状态。
2. 在独立浏览器试验页挂隔离预览文档和固定runtime：可借鉴已验A1，但不能把整个DSH编辑器塞进iframe。说明sandbox/CSP/资源装载/网络阻断方法；bridge不提供Host/Node/模型权限。这里只证明受控模板可行，不证明任意代码安全。
3. 真正播放/暂停/seek；可重复定位至少8个时间点，定位与worker抽帧/工程时序可核对。编辑前暂停；播放时不误触拖动。不把CSS UI transition混入影片时间，内存/RAF/listener在销毁后清理。
4. 点击实际可编辑元素取stableId；选中描边/手柄只在编辑层存在，不修改工程、revision或导出内容。验证缩放适配/letterbox时坐标、边界裁切、多Scene交界、隐藏/重叠对象、未知/不可编辑对象，给明确选择范围，不承诺Canvas/WebGL任意内部对象。
5. 文字双击原位编辑，Esc恢复，提交走现有共享worker edit+expectedRevision+operationId，再inspect与新快照；验证人工修改持久/重开、旧revision冲突不覆盖、失败恢复可重试。右侧不存在目标下拉必经步骤。不要直接改磁盘HTML或只改DOM后声称保存成功。
6. **位置/缩放/颜色等能力缺口表**：核对当前worker/SDK实际支持哪些写操作。能持久写回才演示“已保存”；无现有接口时仅做明确标注的暂态验证和最小typed操作提案（坐标单位、transform与GSAP关系、revision、undo/AI合并、可编辑能力）。不在本任务实现新引擎方法，不用整文件覆盖绕过人工冲突保护。
7. 隔离文档与外层的消息契约给最小版本化字段：实例绑定/握手、稳定元素ID、project/revision、时间与坐标、命令/事件、顺序/迟到响应处理。必须约束source/window或绑定MessagePort、每实例标识和严格消息形状；测试跨实例/过期revision/未知stableId拒绝。opaque origin下不能把event.origin为null当安全认证，nonce也不是完整沙箱。

## 交付与验收

- 真实受控浏览器截图/短录屏或自动化证据，注明独立试验页，不能包装成DSH真机。
- 可重跑的命令、固定引擎提交/Node/浏览器/runtime版本；关键行为测试与失败注入，资源清理结果。时刻一致性给可核对数据，不凭肉眼说完全一致。
- 研究记录给：已验证范围、消息/坐标契约提案、直接编辑可持久能力矩阵、未决项，以及下一阶段引擎/Host/UI文件拆分。粗略概念动画或无写回演示不能替代目标。
- 原单元/真实链无需无意义重复全跑，除非新试验暴露回归或修改测试依赖；两包生产源码必须保持df4b74f字节不变。
- 普通commit/push更新PR#2后由用户交回复审，不安装。与p0-mode-shell的P3-005-A按白名单并行，互不修改对方文件；总调度据两份结果冻结正式实现。

## 开发记录（p1-engine）

填写：2026-10-18。按本指南执行；开工 `git fetch origin` 成功，协调记忆使用 `origin/codex/project-foundation` @ **920957d**（期间一次 SSL 失败后重试通过）。未切分支、未修改全局规则、未 merge。

### 起点、范围与提交

- 工作树：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p1-engine`，分支 `codex/p1-engine-spike-b4bf`（PR #2）。
- 开工 HEAD **`e364017`**；引擎功能固定 **`df4b74f`** / 两包 **0.2.1**（P3-004 已验收）。实现提交 **`4ad7b2ec563e125138064305d9bc7742b9b129cb`**（spike + 证据），本记录与研究记录另以 docs 提交。
- 范围：只新增 `spikes/editor-canvas/**`、`docs/research/P3-005B-editor-canvas-spike.md`、本任务记录；`git diff df4b74f -- packages` 为空（两引擎生产代码/协议/schema 字节不变）；未改根插件/Host/其它 spike/全局 STATUS/决策/profile；未安装/启停/重启、未调模型、未 merge。
- 试验依赖复用 `packages/video-engine-worker/node_modules`：puppeteer-core 25.14.0、`@hyperframes/sdk` 0.8.167；spike 自身无依赖、无 package-lock/安装脚本。Node v24.14.0、Chrome 155.0.8059.84。

### 真实行为结果（自述，待独立复审）

- 独立试验页 + 真实 Chrome：`spikes/editor-canvas/scripts/run-canvas.mjs` → **41/41 断言通过**（约 21s，含断网阶段）；合约/Host 服务 Node 测试 `npm test --prefix spikes/editor-canvas` → **10/10**（约 1.2s）；能力探针 `capability-probe.mjs` 通过（约 3s）。
- 播放/seek：9 个时间点（含 4.99/5.0/9.0/10.99s）请求=落点；播放 800ms 推进约 0.70s，暂停后保持。与 worker 抽帧 1.5/5.5/9.0s：Δ≤2 容差内 **99.30%/99.10%/99.93%**，精确逐像素 **99.28%/97.93%/99.92%**，MAE 0.36/0.30/0.04；证据记录 runner 用 git 验证两包相对 `df4b74f` 未变。
- 选择/坐标：真实鼠标命中 `scene-1-title`；选中层只在 Host 编辑层；letterbox 1100×700 与 760×640 映射点击命中一致、留白不命中；Scene 边界/隐藏对象（时间窗）/重叠 stack/结构容器规则明确。
- 文字原位编辑：Esc 不写回；Enter 经共享 worker `edit`+`expectedRevision`+`operationId` 写回并重载新快照（`449648a3…`→`876ae63b…`），close/reopen 与 worker 重启后持久；旧 revision 冲突 `E_REVISION_CONFLICT` 不覆盖，刷新重试成功；只读目录注入 `E_PERSIST`，草稿保留、恢复后重试成功。
- 缺口：拖动/缩放仅编辑层暂态，`layout` op 被 worker `E_PARAMS` 拒绝、revision 不变；播放中拖动被阻止。能力矩阵：文字/timing/Scene 级颜色等可持久化；元素位置/尺寸/样式/层级无协议写路径；SDK `setStyle` 只在 Host 自有副本生效，`scene.update` 整 Scene 重生成会覆盖元素级样式。

### 契约与能力缺口（详见研究记录）

- 冻结最小 v1 消息/坐标契约：iframe WindowProxy 身份 + instanceId + nonce + 严格形状/序号；opaque origin 下 origin=`"null"` 不能认证；命令/事件白名单；迟到/跨实例/撤销实例拒绝；跨层坐标统一 composition CSS px，Host 处理 letterbox。
- 隔离：`sandbox=allow-scripts`、CSP `default-src none`/`connect-src none`/inline sha256、只按 manifest 路由并逐文件校验；外部请求 0；断网播放可用。只证明受控模板，不是完整安全边界。
- 最小 typed op 提案（未实现）：`layout`（composition-px）与 `style`（属性白名单），需接入生成器、`expectedRevision`/幂等、历史/undo、merge（`inlineStyles` 已在 stableId 签名中），并让 `scene.*` 重生成保留元素 deltas 或显式冲突。

### 证据

- `spikes/editor-canvas/evidence/canvas-evidence.json`：41 项断言、播放/seek/命中/letterbox/文字编辑/冲突/失败/缺口/合约探针/清理；截图 `canvas-boot.png`、`selection-title.png`、`text-editor-open.png`、`text-committed.png`、`transient-drag.png`、`letterbox-1100x700.png`、3 组预览/worker 帧 PNG。
- `spikes/editor-canvas/evidence/capability-evidence.json`：worker/SDK 写回矩阵、SDK `setStyle` 持久化与重生成覆盖证据、typed op 提案。
- 证据中的仓库/试验目录路径已替换为 `<repo>`/`<spike>`，不含个人目录路径。
- 快照生命周期：旧 revision 请求 `E_REVISION_CONFLICT`；切换后旧 Host 路由 404 + `E_SNAPSHOT_NOT_FOUND`；worker 退出后 `previews/` 为空（证据 `host.snapshotLifecycle`）。

### 未测项与风险

- 未接入真实 DSH/Host：宿主 CSP/焦点/主题/多插件共存、真实 Host 资产路由与会话生命周期未测；本页是独立试验页。
- 仅受控 `product-launch-v1` 模板；任意 HTML/JS、不可信素材、音视频、多用户、Safari/Firefox/Windows 未测。
- runtime 对 `data-start` 时间窗的可见性是预览侧近似，非 HyperFrames 导出逐帧 parity（3 个采样点 99% 级一致）。
- sandbox/CSP 非完整安全边界；nonce/origin 非认证。拖拽对齐线、缩放约束、完整工具条/多选不在本 spike。
