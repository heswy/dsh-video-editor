# P3-008：把新引擎接成可持续编辑的真实视频工作区

日期：2026-10-18。执行p0-mode-shell，沿用本树/PR#3。先完成P3-006-C文件预览修复并独立提交/产出固定候选，然后**直接继续本任务开发**，不等额外启动确认；不覆盖C的包。C若已在执行则继续原工作，不为本任务中断或重做。通用规则只读DEVELOPMENT，产品/设计读协调最新版本。

> 归档说明：本文件原件位于协调分支 `codex/project-foundation`；本分支保留同一指南作为任务归档，并在文末追加 2026-10-18 的执行记录。

## 目标与固定基线

交一个可安装开发候选，让左侧真正播放、选中、原位编辑、拖动/缩放；右侧原生AI持续修改同一工程，模型/历史保留；支持受控工程创建/重开、换黄色和PNG/JPEG素材导入。无底部场景卡片、无常驻属性第三列、旧目标下拉+表单退出主路径。不是再交一份spike或提案。

- 根0.3.0-alpha.3（C为alpha.2，各自固定产物不覆盖）。引擎冻结 **74294e6**、client/worker **0.3.0**，包摘要见P3-006B-review-02。p1并行修黑带但不等待其实现开始本任务；不要自动跟随PR/分支head。后续审过的BUG-001提交再显式替换固定commit与版本、复跑相应导出检查。
- 功能仅限已审product-launch-v1和声明的PNG/JPEG资产。legacy demo仍可打开，但不能伪装成已有layout/style能力；用户新建受控工程，旧demo/用户数据不得静默重建或prepare-fixture重置。
- 接口/坐标/消息依据已审P3-005-B spike ea2d1a4和新engine README/schema；只读取p1固定Git文件，不改p1树。可以将必要runtime/contract逻辑以明确来源落入插件自有模块，不能把独立toy Host直接当生产授权边界。

## 允许范围

根client/index、host/**、插件自有canvas/client模块、locale、package/files/patch、scripts的stage/检查/真实链与必要测试、README、本任务与对应research/去标识证据。不改packages/video-engine-*、p1 spike或全局协调文档，不merge/rebase协调分支。可增加插件自有源码目录，不为了保持单个client.js制造超大文件；按本机client loader可用形式组织，依赖/构建如确需增加先记录实际契约，不能装未知postinstall。

## Host与持久边界

1. staging支持明确固定commit/完整manifest版本，换到0.3.0导出，不再暗中钉54f4671。核对worker-managed registry/projectsRoot/assetInboxRoot/outputRoot配置，保留Node/env/cwd和artifact完整性门禁。配置/包缺失typed error，不能退回旧worker假装新功能可用。
2. Host dispatcher/UI/Tool统一接project.create、asset.import、scene.create/update/reorder/remove、project.revise、history/undo/redo、preview.snapshot/release及layout/style edit；方法不应因“worker有”就跳过参数、范围与job/snapshot所属工程检验。模型不能调用会话管理或给自己任意工程授权。
3. UI显式“新建工程/开始创作”可先创建受控默认工程，再创建并绑定原生创作Session；只采用worker实际返回projectId。新工程加入Host可信版本化工程目录/授权映射，支持重启恢复和再次打开，不能只存在客户端Set。普通UI请求、native Session绑定与Tool范围统一；project.create不接受模型自填路径/任意projectId来绕过范围。创建/绑定中途失败诚实报告并可恢复，避免重复建工程/会话，不声称跨worker与宿主Session的分布式事务。
4. 现有绑定工程的AI只操作该工程；scope和动态上下文升级为新鲜revision、Scene、当前stableId/能力及素材摘要。同字段冲突展示为可恢复状态，AI修改后重新inspect、撤销旧预览并载入新revision，不让旧PNG/旧snapshot冒充当前画面。工程级换背景走scene级颜色操作；样式/布局走typed edit，不建议bash直接写index.html或后期调色替代修改。

## 左画布与实时预览

- 使用worker私有revision快照；Host按快照manifest逐文件验证/服务，project/snapshot/当前连接归属校验、失效/TTL/释放清理。sandbox仅allow-scripts，不加allow-same-origin；CSP禁止外网与任意脚本，timeline精确hash、Host固定runtime。消息绑定WindowProxy+instanceId+nonce+严格形状/序号；origin=null不当认证。关闭/换会话/换工程/停用后拒绝迟到消息，资源路由失效。不能宣称iframe构成OS沙箱。
- 真播放/暂停/时间定位，轻量单条进度，不做场景缩略条。选择描边/手柄只在编辑层；暂停后直接点击选择，双击原位改文字，Esc取消，Enter真实提交；小型就近工具调整颜色/字号。移动/缩放经composition CSS px及静态基座逆映射提交layout，不存当前动画矩形或transform。播放中禁写；未知auto尺寸不能伪造已知尺寸，必要时用显式尺寸patch。
- 每次成功编辑发布新revision并换快照，失败保留草稿/拖动前基座，冲突不覆盖。更新快照保留播放定位与选中stableId；对象消失时清除选中。undo/redo作用于工程内容并更新预览，不另建UI真相。
- 窄窗/明暗/宿主字号和reduced-motion保留，简洁克制，不新增阶段说明、长解释或装饰性状态栏。工程/错误/运行状态按需出现。

## 素材抽屉

左上按需展开、默认关闭，可用file input选PNG/JPEG、真实导入/列出/使用；不需要独立常驻素材列。上传Host先校验大小/签名/安全命名并发受控receipt，来源写入可信inbox，再调用worker asset.import。UI/Tool只接受receipt/assetId，不接受绝对路径/URL；工程归属校验、取消/失败清临时文件，thumbnail走受控路由。沿用worker单张8MiB/每工程16张/总64MiB等现有上限，原生附件不自动全部入库或发给模型。不支持的视频/音频/任意SVG明确拒绝，不画假按钮。

## 本轮开发验收（一次交回）

- Host与真实worker：新建受控工程→持久目录与会话绑定→三个Scene约15s→换背景黄→人工文字/位置/颜色→AI同对象续改文案保留人工布局→history/undo/redo→close/reopen内容一致→真实MP4。使用受控adapter/脚本验证；不需要真实模型来证明引擎/Host链。
- 真浏览器插件开发页/组件验证：实际播放/seek；两个动画时刻和两种letterbox尺寸下命中及拖动/缩放基座正确；原位编辑失败/冲突恢复；AI写入后画布更新；文件预览C不回归、返回/历史/草稿与单编辑根保留。
- 素材真实PNG/JPEG导入并用于受控Scene；跨工程receipt/路径穿越/越限拒绝；快照过期/切换/停用后旧消息和路由失效。日志不含私钥、个人会话正文或任意绝对文件内容。
- 固定源码提交、新包、新staging与INTEGRITY和完整SHA、分项测试、真实帧/渲染证据、开发记录一次交回PR#3。不把独立开发页当真实DSH激活。BUG-001未关闭时披露黑带，不能把该MP4视觉标为通过。

本指南授权开发与任务fixture的本地验证，不自动安装alpha.2/alpha.3、不重启DSH、不新增真实模型请求、不改用户当前工程/会话、不merge。现有alpha.1 staging已是用户安装依赖，禁止覆盖/归一化。实际候选完成并复审后再做明确安装验收；安全定向输入规则不变。

---

## 执行记录（2026-10-18，p0-mode-shell / PR #3）

**结论：交付可安装开发候选 `0.3.0-alpha.3`（引擎固定已审 `74294e6` / 两包 `0.3.0`），完成受控新工程、左画布实时播放/直接编辑、右原生 AI、素材抽屉与换黄真机链；未安装、未重启、未调用真实模型、未改用户数据。** P3-006-C 的 alpha.2 候选独立保留，不覆盖。

### 关键实现

- **Host（提交 `8ab5f1a`）**：managed worker 配置（projectsRoot/registryPath/outputRoot/assetInboxRoot），Host 从 worker 管理注册表发现/校验工程并加入可信 allowlist；project.create/list、asset.import、scene.create/update/remove/reorder、project.revise、history/undo/redo、preview.snapshot/release 全部走同一 dispatcher；project.create/asset/preview 为 UI-only（Tool 不能调用）。快照按 worker manifest 逐文件 hex/bytes 校验后注册精确鉴权 Fetch 路由；entry 注入固定 runtime、CSP `connect-src 'none'`/inline hash/`allow-scripts` iframe。素材上传只收 PNG/JPEG（签名/扩展名、≤8 MiB）到受控 inbox，返回短期 receipt；asset.import 只收 receipt。edit 的 typed ops 增加 layout/style，Tool 同步支持 text/timing/layout/style 与 scene/history/revise actions。prompt context 增加新鲜 revision、Scenes、可编辑 stableId/capabilities、素材摘要和“优先 stableId typed edit 保留人工布局”的引导。
- **Client（提交 `8ab5f1a`）**：managed 工程进入画布工作区：sandboxed snapshot iframe + 固定 runtime 消息契约（WindowProxy+instanceId+nonce+seq，origin 不作认证）、letterbox composition-px 映射、播放/暂停/seek、点击 hitTest 选中、双击原位文字编辑（Enter 提交/Esc 取消）、拖拽/缩放手柄 layout 提交、颜色/字号 style、Scene 底色和新增 Scene、undo/redo、PNG/JPEG 素材抽屉上传/列出/用作 shot、真实 MP4 导出。AI 修改通过 revision 轮询重新 inspect/换快照；播放中禁止写。旧 legacy demo（无 scenes）保留原 PNG/文本/时间路径，不伪装 layout/style 能力。嵌入文件预览（C）不回归。

### 验证

| 项 | 结果 | 证据 |
|---|---|---|
| 静态检查 | **42/42** | `npm run check` 首段；新增 P3-008 canvas/runtime/Host 方法/manager 门禁 |
| Client smoke | **56/56** | 新增 managed 新工程→Session 绑定→画布 shell/sandbox iframe/snapshot 请求/播放/素材入口 |
| Host 契约 | **38/38** | 新增 layout/style 参数、Tool UI-only 拒绝、snapshot 注册/CSP/字节/release、inbox 上传与 receipt 导入、非图片拒绝 |
| 版本门禁 | **10/10** | `node scripts/test-stage-version.mjs`（alpha.3） |
| 固定候选 | `dsh-video-0.3.0-alpha.3.tgz`：**86,943 B / 23 files / SHA-256 `68887366…889c3f08`** | `artifacts/p2-b/8ab5f1a/`；23/23 与提交 8ab5f1a 逐字节一致 |
| 新 staging | `artifacts/p2-b/staging-74294e6-8ab5f1a`；INTEGRITY **`8f328d80…d9baaa0e`**、config `3bfc67eb…4378e1d`、patch `0db518a3…544da`、managed registry `f5b2f6b4…a2edfc`、inner registry `a0d691da…8a0b6b` | root 8ab5f1a / engine 74294e6 / bundle 0.3.0-alpha.3 / client/worker 0.3.0；pinned 源码/版本门禁通过 |
| 真实 Host→engine 链（旧 demo 兼容） | **ok=true** | `artifacts/p2-b/evidence/engine-run-2026-10-18T04-55-59-463Z.json`（SHA `afadbd4f…dbf29`），帧/MP4/cancel/close 不变 |
| 受控新工程全链 | **ok=true** | `artifacts/p2-b/evidence/canvas-chain-2026-10-18T04-56-14-621Z.json`（SHA `2d632f6b…997a0`）：project.create→Session 绑定→3 Scene/15s→换黄 revision→人工 text+layout+style→undo/redo→PNG asset.import→shot→snapshot 路由/CSP/字节→frame（背景像素 `255,212,0`）→MP4 161,844 B/`0e0d6333…` 450 帧/15s→history 6 条→close/reopen revision 不变 |
| 真浏览器 runtime | **ok=true** | `artifacts/p2-b/evidence/canvas-browser-2026-10-18T04-56-15-926Z.json`（SHA `b54beea5…9f1d5`）：Chrome 155 加载沙箱 iframe，ready 1280×720/5s，seek 3s 命中 `scene-1-title`，播放 0.43s 推进，外部网络 0，console error 0 |
| 真实帧/渲染产物 | PNG 14,970 B/`e9538abb…`；MP4 161,844 B/`0e0d6333…`（H.264 1280×720/450 帧/15s） | 本地证据 `artifacts/p2-b/evidence/p3-008-artifacts/frame-yellow-1.5s.png`、`render-15s.mp4` |
| C 候选保留 | alpha.2 包/staging 未覆盖 | `artifacts/p2-b/3310280/...`、`artifacts/p2-b/staging-54f4671-3310280` 未动 |

### 未测 / 边界

- **未安装/启停/重启**；未在真实 DSH 页面点击验证 alpha.3（画布组件由 VM smoke + 独立真浏览器 runtime/Host 路由 + 真实 Host-worker 链验证，不能当 DSH 激活验收）。
- 真实 AI 模型请求未执行（按 handoff）；AI 同对象续改保留人工布局由 Host/Tool typed ops 契约与 prompt 上下文保障，但未用真实模型跑 UI 闭环。
- 拖拽/缩放的本机鼠标手势、原生播放观感、窄窗/主题/reduced-motion 像素级观感需安装验收。
- 素材只支持 PNG/JPEG；视频/音频/SVG 拒绝。Scene.update 未暴露 color/shot 的读取接口，UI 换 shot/底色使用当前 UI 已知 Scene 字段；重开工程后未知自定义颜色/旧 shot 的保留需后续接口（本版未声称）。
- BUG-001 黑带未修，本轮 MP4 不声称视觉通过。未改 engine/p1/spike/全局文档；未 merge；已安装 alpha.1 staging 未动。
- 详细接口/安全/测试数据见 [P3-008 交付证据](../research/P3-008-canvas-ai-integration.md)。

---

## 执行记录（2026-10-18 联合复审 R1–R5 修复轮，p0-mode-shell / PR #3）

**结论：R1–R5 与 parent 消息契约已集中修复，并按规定固定已复审引擎 `d383e3d` / client·worker `0.3.2` 生成新 staging 交回。未安装、未启停/重启、未改 profile/用户工程/个人会话、未发真实模型请求、未 merge、未改 p1 树；旧 C/008 候选、旧 staging 与当前 alpha.1 安装全部保留。**

### 固定源码与候选

| 项 | 值 |
|---|---|
| 功能提交 | `a030fd4`（Host R3/R4）+ `2c2771c`（Client R1/R2/R5/R6），修复链见下 |
| 交付头 | `5f2df9621cce2886cad574d171bb8cdb43f3f14d` |
| 修复提交 | `a030fd4` Host R3/R4；`2c2771c` Client R1/R2/R5/R6；`329dd0d` staging/回归工具；`454f156` 真实双击；`0e5be80` iframe composition 视口；`5f2df96` harness/chain/静态门禁 |
| 固定引擎 | `d383e3d53a9401285519ee578d993081c3cb4b51`，client SHA-256 `0830ab71…1311a5`、worker `e4e16141…3716c3`（与 P3-009 复审包摘要一致） |
| 固定包 | `artifacts/p2-b/5f2df96/dsh-video-0.3.0-alpha.3.tgz`：**103,200 B / 23 files / SHA-256 `b0af95b4c5087bc6446a65fcade8fd931b4d8b556b5dbed8feee865f4a260a45`**；23/23 与提交 `5f2df96` 逐字节一致（`package-check.json` SHA-256 `de0b708a…7867f614`） |
| 新 staging | `artifacts/p2-b/staging-d383e3d-5f2df96`；INTEGRITY **`f0065803…73b52d`**、config `2dcb316a…1c3171`；root `5f2df96` / engine `d383e3d` / bundle `0.3.0-alpha.3` / client+worker `0.3.2` / rootDirty=false；bundle 22、client 16、worker 35 文件摘要通过，esbuild 可用 |

### 关键实现

- **R1 Scene 完整模板**：`applySceneColor` / `useAsset` 先取当次权威 `inspect`，用 `canvasSceneTemplate()` 复制完整冻结 `scenes[].template`（无 sceneId/未知键），只改 color/shot 并以该 revision 提交；模板缺失/非法时本地化拒绝且不发 `scene.update`，不再用 UI 默认值猜补；`useAsset` 不注入 UI 颜色。
- **R2 静态基座逆映射**：拖动时保留 `elements[].layout` 静态基座与动画命中矩形，`canvasLayoutPatch()` 计算 patch——移动只写 left/top = base + 动画增量；四角缩放按 sx=动画宽/静态宽、sy=动画高/静态高（未知回退 sx）逆映射 width/height，west/north 再按 scale 逆映射 left/top；不写入动画偏移/transform/伪 auto 尺寸；静态原点或必需 scale 未知时拒绝且不发请求；写失败保留选择与拖动前矩形，不自动重试。
- **R2 附带真实画布缺陷修复**：快照 iframe 保持 composition 尺寸（1280×720 inline width/height）并由 Host 层 CSS `scale(stage scale)` 缩放；此前 iframe 被拉成 letterbox 后视口尺寸，导致 scale<1 时画面裁切、runtime `elementsFromPoint` 命中在 composition 坐标越界后静默 miss。Canvas stage 独立 class 避免 legacy `.dv-stage` flex/padding 拉伸。
- **R5 原位编辑失败恢复**：编辑器打开时生成一个 operationId 并在重试中复用（worker 幂等重放 uncertain 写）；成功后才关闭并 reload；失败保留 draft/target/错误与 `.dv-editor-retry`，不自动重放；冲突需显式 retry 触发一次 `onReload`（只刷新权威 revision），再显式提交；Esc 不发任何请求。
- **R6 parent 消息契约**：按已审 P3-005-B `contract.js` 恢复严格 v1 信封/固定键/允许事件/逐事件载荷形状/每实例单调序号/仅接受相关回复；错误来源、实例、nonce、迟到、重复、超长消息丢弃；pending command 在 unbind、快照替换、destroyed、实例撤销时显式 resolve(null)+清 timer+清 Map，不再悬挂 Promise。
- **R3 预览归属**：`preview` 由 bridge 计算 owned roots：本工程工程目录、`<sessionCwd>/<projectId>` 工程独立 Session 根、按 jobs 登记归属的 `<jobId>.png|mp4` 产物、本工程 receipt；旧共享 sessionCwd 文件只有在该绑定 Session 自己的 `inspect` 事件明确引用精确绝对路径时才允许（512 events / 256KiB / depth 8 有界扫描，controller 不可用即拒绝）。同根跨工程 artifact/工程目录/receipt、symlink/.. 逃逸、任意绝对路径全部拒绝；本工程文件保持可用。
- **R4 准入/排空/清理**：`VideoBridge.invoke()` 改为非 async 单点准入，在任何 await 前把 dispatch task 放进唯一 `inFlight`；`dispose()` 先关写入口并取消上传 reader，再排空 inFlight，最后 teardown worker/session/snapshot/inbox；迟到 `preview.snapshot` 返回 `E_WORKER_DISPOSED` 并 release worker 快照，不注册路由/record。AssetInbox 校验可信工程、跟踪 handler/reader、上限 32 receipt、失败/过期/dispose 清理本实例临时文件（不删已复制工程资产），重复 dispose 幂等。

### 验证

| 项 | 结果 | 证据 |
|---|---|---|
| `npm run check` | **48 静态 + 75 Client + 44 Host = 167/167**（基线 136；新增 R1/R2/R5/R6 静态门禁、17+2 Client 画布回归、6 Host R3/R4 回归） | 本地实跑，HEAD `5f2df96` |
| 版本门禁 | **10/10** | `node scripts/test-stage-version.mjs` |
| 旧 demo Host→engine 链 | ok=true | `artifacts/p2-b/evidence/engine-run-2026-10-18T05-48-18-895Z.json`，SHA `667f3211…aa605` |
| 受控新工程全链（0.3.2） | ok=true | `canvas-chain-2026-10-18T05-48-47-303Z.json`，SHA `32f7ae32…49bf9`：3 Scene/15s；富字段 template；换色后 subtitle/badge/accent/shot 与人工 layout/style 保留；真实 Tool `project.revise` 续改 `written=true` 且保留人工 layout/style/可选字段；close/reopen revision 不变；同根跨工程 artifact `E_PREVIEW_DENIED`、本工程文件可用、`/etc/hosts` 拒绝；dispose 后 inFlight=0、routes=0 |
| 真浏览器快照 runtime | ok=true | `canvas-browser-2026-10-18T05-48-48-744Z.json`，SHA `29ab45c3…f2b16` |
| 真实 CanvasWorkspace 手势/失败恢复（固定 staging） | **10/10 用例、175/175 断言、ok=true** | `staging-d383e3d-5f2df96/evidence/canvas-workspace-2026-10-18T05-48-26-807Z.json`，SHA `e2f0aced…5f051c`；staged client.js SHA `8c4c2b12…cf9957` 与 INTEGRITY 一致，helpers/canvas slice 摘要记录；10 cases：2 动画时刻×2 letterbox 拖动、rule scaleX 逆映射、auto-height 缩放、拖动 E_PERSIST、真实双击文字 E_PERSIST/重试、Esc、真实 revision 冲突两阶段；外部网络 0、非预期 console 0、page error 0、teardown ok、staging 只读审计 75/75 |
| 真实帧/MP4 完整画面 | ok=true | `artifacts/p2-b/evidence/p3-008-r5/render-check.json`，SHA `4fd0c66f…d57e6`：frame PNG 22,734 B / `9a0dcdf7…edbc0f8`、像素 `(8,8)=RGB 255,212,0`；MP4 **143,794 B / SHA `e2bc1806…20f44b2`**，H.264 1280×720、30/1、450 帧、15s；1.5/7.5/13.5s 抽帧底部 86 行 darkRatio=0 且有可见内容；帧 PNG 证据同目录 `render-frame-{1.5,7.5,13.5}s.png` |

### 未测 / 边界

- **未安装/启停/重启**：本候选未进 profile；真实 DSH 页面点击、拖拽、输入、窄窗/主题/reduced-motion 观感仍需安装验收。浏览器证据是真实 Chrome + 真实 staged Host/worker/runtime + 真实 DOM 手势，但不是真实 DSH 激活。
- 真实模型请求未执行；“AI 续改”由真实 Host Tool→worker `project.revise`（带 Session scope）证明，不是模型驱动 UI 闭环。
- 引擎 `scene.template` 只覆盖受控 `product-launch-v1`；legacy demo 仍无 layout/style/Scene 能力。视频/音频/SVG 仍拒绝。
- iframe/CSP/精确路由是资源隔离，不是 OS 沙箱；任意 HTML/JS 不支持。
- 当前安装 alpha.1/旧引擎与全部旧 staging/包未动；本轮未 merge、未改 p1/全局协调文档。

---

## 执行记录（2026-10-18 第二轮复审 R1/R5 补修轮，p0-mode-shell / PR #3）

**结论：仅集中补修 [review-02](../reviews/P3-008-review-02.md) 要求的 R1-follow-up（长模板上限对齐）与 R5-follow-up（不确定写入后的不可变请求重试），R2/R3/R4/parent 等已通过项全部保留。继续固定已复审引擎 `d383e3d` / client·worker `0.3.2`，新提交目录出包、新 staging 一次交回；未安装、未启停/重启、未发真实模型请求、未 merge、未改 p1 树，旧候选/证据/当前 alpha.1 安装未动。**

### 固定源码与候选

| 项 | 值 |
|---|---|
| 功能提交 | `c2a1e2b`（Host 长模板上限）；`550516d`（Client 不可变写入尝试）；`9d74f46`（chain/静态门禁）；`d4f3f73`（harness mechanics）；`7d60312`（T4C/chain revision 修正） |
| 交付头 | `7d60312`（+ 本轮文档提交） |
| 固定引擎 | `d383e3d53a9401285519ee578d993081c3cb4b51`，client·worker `0.3.2`（与 P3-009 复审包摘要一致，本轮未换） |
| 固定包 | `artifacts/p2-b/7d60312/dsh-video-0.3.0-alpha.3.tgz`：**104,913 B / 23 files / SHA-256 `7bccb425a926b335d735cc9c57c4288636769ccba73161a063626454c2cd46ab`**；23/23 与提交 `7d60312` 逐字节一致（`package-check.json` SHA-256 `fce3edfd…22d8c71`） |
| 新 staging | `artifacts/p2-b/staging-d383e3d-7d60312`；INTEGRITY **`b4fadefa…30d0f69a`**、config `b9f90c5c…f7fab361`；root `7d60312` / engine `d383e3d` / bundle `0.3.0-alpha.3` / client+worker `0.3.2` / rootDirty=false；bundle22/client16/worker35 摘要通过，esbuild 可用 |

### R1-follow-up 实现（长模板契约对齐）

- **Client** `canvasCopySceneTemplate` 与 **Host** `sceneTemplate` 的文本上限统一到冻结 0.3.2/typed text 语义：UTF-16 length，`title` 1..2048，`subtitle`/`badge` 0..2048；不截断合法文本，2049 超界拒绝且 Host 在 worker 前返回 `E_PARAMS`；duration/颜色/资产路径/未知键/full-template 等其它校验不变。`host/tool.js` 的 template JSON schema 保持 type-only（Host 是权威校验器；未加可选 `maxLength` 以免形成第二份契约）。
- **回归**：Client 覆盖 201/300/301/49 旧上限穿越、2048 边界保留、2049 逐字段拒绝、空 title 拒绝、空 subtitle/badge 合法、UTF-16 astral 语义（1024 emoji=2048 units 接受、1025=2050 拒绝）；Host 覆盖三种方法（scene.update/scene.create/project.revise）的 2048 接受/2049 拒绝、多字节、未截断字符串逐字节到达 worker。
- **真实 Host→worker 链**：typed edit 写入 300 字 title、400 字 subtitle、60 字 badge 后 `inspect.template` 完整往返；随后仅改 color、换 shot、真实 Tool `project.revise`（标题改为 AI 文案）均保留长 subtitle/badge、shot 与人工 layout/style；2049 字模板逐字段被 `E_PARAMS` 拒绝且 project revision 不变。

### R5-follow-up 实现（不可变写入尝试）

- 编辑器状态新增 `attempt: null | {operationId, expectedRevision, ops, value}`；首次显式提交时冻结一次请求（先存后发）。尝试 null：新建 attempt 发送；可恢复错误（E_REVISION_CONFLICT/E_OPERATION_REUSED）→ 清 attempt + 显式 refresh 两阶段；其它失败 → 保留冻结 attempt 与草稿。
- 草稿未改：显式重试**原样重发**冻结请求（同 operationId/expectedRevision/ops），不读取最新 revision 或变化草稿；若原写已落盘，worker 缓存按同签名返回成功 → 只应用一次并关闭编辑器。
- 草稿已改：本次显式提交先**结算旧 attempt**（重发冻结请求）；成功则用结算结果 revision + **新 operationId** + 新文案发送；结算冲突（无缓存 ⇒ 旧写未落盘）→ 显式 refresh 路径；结算 uncertain/E_PERSIST → 继续保留旧 attempt，不换 id。
- 任何 E_OPERATION_REUSED 都进入可恢复 refresh 路径，不再是死路；无需 Esc/重开编辑器。Esc 仍零写，无自动重放/静默覆盖。

### 验证

| 项 | 结果 | 证据 |
|---|---|---|
| `npm run check` | **48 静态 + 80 Client + 46 Host = 174/174**（round-1 为 167；+5 Client、+2 Host、静态门禁更新） | 本地实跑，HEAD `7d60312` |
| 版本门禁 | **10/10** | `node scripts/test-stage-version.mjs` |
| 旧 demo Host→engine 链 | ok=true | `artifacts/p2-b/evidence/engine-run-2026-10-18T07-36-10-512Z.json`，SHA `8d968506…3e49746` |
| 受控新工程全链（长模板） | ok=true | `canvas-chain-2026-10-18T07-36-40-021Z.json`，SHA `1f5d37f8…4bc6c6a`：长文案 300/400/60 往返、2049 逐字段 E_PARAMS、仅改 color/换 shot/Tool revise 后长字段+人工 layout/style/shot 保留；跨工程预览拒绝/本工程允许、dispose routes=0、close/reopen revision `bcc195cf…` 不变；frame 像素 255,212,0、MP4 328,275 B |
| 真浏览器快照 runtime | ok=true | `canvas-browser-2026-10-18T07-36-41-418Z.json`，SHA `832d382a…86975` |
| 真实 CanvasWorkspace（固定 staging） | **13/13 用例、249/249 断言、ok=true** | `staging-d383e3d-7d60312/evidence/canvas-workspace-2026-10-18T07-36-42-636Z.json`，SHA `66c1c8c5…4a1ec`；staged client.js SHA `ec2ff3ff…68a2c` 与 INTEGRITY 一致；原 10 用例仍 175/175；T4A 20/20、T4B 24/24、T4C 30/30；外部网络 0、非预期 console 0、page error 0、teardown ok、staging 只读审计 75/75 |
| 真实帧/MP4 完整画面 | ok=true | `artifacts/p2-b/evidence/p3-008-r5/render-check.json`，SHA `b3922dc7…92ca2a`：frame PNG 25,952 B / `f36d6201…423e43884`、像素 (8,8)=RGB 255,212,0；MP4 **328,275 B / SHA `3f464ba1…0c5e389`**、H.264 1280×720/30fps/450 帧/15s；1.5/7.5/13.5s 底部 86 行 darkRatio=0 且有可见内容 |

**R5 真实浏览器关键数据（T4）**：T4A 首写经真实 Host 落盘为 revision B 后响应被丢弃（页面得到 `E_TRANSPORT` uncertain），显式重试发送**完全相同** body（同 operationId/expectedRevision/ops）→ 200 缓存 revision B，编辑器关闭、文案只应用一次、无新 revision、单编辑根。T4B 同场景修改草稿后提交：先发完全相同冻结 settle 请求（200 缓存 B），再用**新 operationId** + 新文案 + expectedRevision B 发送 → revision C，最终文案为新文案，无 E_OPERATION_REUSED、单编辑根。T4C 合并并发 revision 冲突：frozen settle 成功后新意图真实 409；显式 refresh（仅 inspect）后用第三个新 id/新 revision 提交成功；三个不可变尝试 id 互异。

### 未测 / 边界

- 未安装/启停/重启；真实 DSH 页面点击/拖拽/输入、窄窗/主题/reduced-motion 观感仍需安装验收。浏览器证据是真实 Chrome + 真实 staged Host/worker/runtime + 真实 DOM 手势的开发页组件验证，不是 DSH 宿主 React/Slot 激活或安装验收。
- 未发真实模型请求；AI 续改仍由真实 Host Tool→worker `project.revise`（Session scope）证明。
- 受控 `product-launch-v1` 之外（legacy demo/任意 HTML/视频/音频/SVG）不支持；iframe/CSP/精确路由不是 OS 沙箱。
- 旧候选、旧 staging、旧证据与当前 alpha.1 安装全部保留；本轮未 merge、未改 p1/全局协调文档。
