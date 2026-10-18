# P3-012 对话优先 MVP：实现与验证记录

日期：2026-10-18。执行：video-studio 唯一开发会话（`codex/video-studio`）。范围以协调分支
STATUS/PRODUCT 与 `docs/tasks/P3-012-conversation-first-mvp.md` 为准：**右侧对话生成/续改 →
左侧自动出现并可播放预览 → 同一工程自动更新**；用户手动选中/拖拽/原位文字/属性表单全部延期。
鹈鹕/球只是历史故障回归，不作为功能定义。

## 1. 结论摘要

- 新增同一 "完整作品提交" 路径：Engine `project.compose`（校验后原子发布完整 HTML composition）
  与 `project.source`（读取当前权威 HTML+revision）；Host `video_engine` Tool 增加两个 action，
  并把生成/修改工作流、composition 契约、错误恢复写进绑定会话的 prompt context。
- 左侧改为**只读自动预览**：任意受控工程的任意合法 composition（不再以 `scenes.length>0` 判定），
  按 Host 上报的 revision 自动加载私有快照，播放/暂停/seek；发布新 revision 后 1.5s 内自动换新，
  无需手动刷新/重开；失败保留最后有效预览并显示可恢复错误。
- 首次打开即进入创作：自动打开最近/记住的受管工程并载入其绑定会话；工程无会话时自动创建一次；
  完全无工程时自动创建「空工程+会话」一次。用户无需理解工程/模板/revision。
- 本文所有结论区分：**单元/契约（Node）**、**开发 staging 真组件浏览器**、**真实 DSH 安装**、
  **真实模型对话**。本轮未安装、未改 profile、未发真实模型请求；因此候选只申报前两层。

## 2. 权威契约

### 2.1 Composition 契约（Host/Engine 共同校验，发布前）

提交的是一个完整 HTML 文档，全部满足后才可能发布：

1. UTF-8 1..49152 bytes（48 KiB，Host 与 worker 同常量），且 JSON-stringify 后的转义形式 ≤61440 bytes（60 KiB，Host 与 worker 同常量），无 NUL；
2. 完整文档：去 BOM/前导空白后以 `<!doctype html>`（或 `<html>`）开始，包含 `</html>`；
3. 恰好一个 `id="main"` 元素，带非空 `data-composition-id`，并有数值
   `data-width`(320..3840)、`data-height`(180..2160)、`data-duration`(0.1..3600)；
4. 暴露固定预览 runtime 所需时间线：**inline `<script>` 体内**赋值 `window.__timelines = { main: … }`
   （也接受 `window["__timelines"]`；HTML 注释与 `src=` 脚本不计入），`main` 不能是字面量 `null`/`undefined`；
   代码注释与本文明确该检查是“必要非充分”，真正播放由预览 runtime 证明，静默失败会显示可恢复预览错误；
5. 无 `<iframe>/<object>/<embed>/<base>/<link>/<video>/<audio>/<source>/<track>`；
   `src`/`href`/CSS `url()` 位置禁止 `http(s):`、`//`、`file:`、`blob:`、`javascript:`；
   SVG `xmlns` 与 `url(#fragment)` 是命名空间/同文档引用，允许；
6. 本地引用只能是工程 manifest 已声明的资产（通常是 `./assets/gsap.min.js`），
   不接受未声明文件、`..`、绝对路径；`index.html` 自身不作为引用；
7. SDK 回环校验（与 inspect/frame/render 同一条路）：`openComposition(html)` 成功，
   `buildDocument(comp.serialize())` 给出的 width/height/duration 在范围内，并 `dispose()`；
8. 与当前入口字节完全一致 ⇒ 不写盘、不追加历史，返回 `unchanged`。

支持范围由该 composition 契约决定，不绑定 `product-launch-v1` 模板；正文/配色/构图/动画都可由
AI 通过同一提交入口表达（首轮采用已验证的 HTML/SVG/GSAP 程序化作品形式，不引入新渲染后端）。

### 2.2 Engine 方法（JSONL v1 不变；worker/client 0.3.2 → 0.4.0）

`project.compose` 参数：`{projectId, expectedRevision, operationId, html}`。

语义：先做 48 KiB 原始 + 60 KiB escaped 双上限校验（escaped 上限保证请求帧与 source 结果都留在 64 KiB 协议/结果预算内）；项目队列串行；operationId 幂等（同 payload 返回缓存结果，不同 payload
`E_OPERATION_REUSED`）；`expectedRevision` 不匹配在任何校验/写入前返回
`E_REVISION_CONFLICT`；契约失败 `E_COMPOSE_INVALID`（不发生产物、不写 revision）；通过后
原子写 `<project>/index.html`、重新读取并逐字节比对；随后用既有 `Previews.create` 生成并丢弃
私有快照，证明该 revision 可经既有 snapshot 路由提供（**不声称浏览器已播放**）；写盘或快照证明
失败会用旧字节回滚并返回 `E_PERSIST`（回滚也失败时 `uncertain:true`）；成功后写入
`.dsh-video/history`（actor `ai`，kind `project.compose`）。

结果（Host/Agent 依赖的权威形状）：

```json
{
  "projectId": "…", "revision": "…", "publishedRevision": "…",
  "written": true, "unchanged": false, "scenes": [], "entry": "index.html",
  "width": 1280, "height": 720, "duration": 17.5, "bytes": 18342,
  "assets": ["assets/gsap.min.js"],
  "elements": [{"stableId": "…", "capabilities": ["text","timing"]}],
  "files": [{"path": "index.html", "bytes": 18342, "sha256": "…"}],
  "preview": {"mode": "snapshot", "status": "ready", "checked": "composition+snapshot", "revision": "…"}
}
```

`project.source` 参数 `{projectId}`；结果 `{projectId, revision, entry, bytes, assets, html}`
（当前入口精确字节）；原始 >48 KiB 或 escaped >60 KiB 返回 `E_LIMIT`（保证单次 Tool 结果在 64 KiB 预算内）。

### 2.3 Host / Tool / prompt context

- Host `REQUEST_METHODS` 增加 `project.compose`/`project.source`，同一 dispatcher；`html` 先做
  类型、NUL、UTF-8 48 KiB 预校验（坏请求不启动 worker），沿用 Agent Session→工程持久映射校验
  （无 Agent/未绑定/跨工程分别 `E_AGENT_REQUIRED`/`E_SESSION_NOT_BOUND`/`E_PROJECT_SCOPE`）。
- `project.compose` 成功结果会刷新 Host 的 prompt facts（revision/尺寸/时长/`mode:"composition"`），
  下一次 prompt assembly 即携带新 revision，避免同回合连续改错 revision。
- `project.list`（UI-only）改为 `{projects:[{projectId,updatedAt}], defaultProjectId}`，按入口文件
  mtime 倒序；stat 失败记 0 不整体失败；客户端过滤旧 demo。
- `video_engine` Tool 新增 `project.compose`/`project.source`，Tool 描述写明工作流：
  inspect（或 source 读当前 HTML）→ 生成完整文档 → compose + expectedRevision →
  左侧自动跟随发布 revision；只有 `publishedRevision` 才算完成；禁止用 shell/文件工具改工程文件。
- 绑定会话 prompt context（有界 ≤4000 字符）加入：工作流、E_REVISION_CONFLICT 恢复
  （重新 source 再提交，不拿 stale revision 盲写）、composition 契约、最小 skeleton（`#main`、
  `data-*`、`window.__timelines={main:tl}`、`tl.seek(0)`）、自由创作工程用 source+compose 修改的
  说明、"never write project files with shell/file tools"、不支持时诚实说明。

### 2.4 Client：只读自动预览与首开流程

- `CanvasWorkspace` 新增 `previewOnly`（产品 UI 传 `true`，默认 false 保留既有 P3-008 手动路径代码与
  浏览器回归）：保留快照加载/重试、fixed runtime 消息契约、播放/暂停、seek、时间、revision/phase 标记；
  不渲染选中框/手柄/拖拽/原位文字/属性工具/素材抽屉/加场景/导出/撤销重做，也没有任何能发写请求的
  用户手势。
- 左面板对**任何已载入工程**（不再要求 `scenes.length>0`）挂载该预览；每 1500ms `inspect` 一次，
  revision 变化即换新快照（旧结果有 projectId/mounted 守卫），新快照加载期间保留最后有效画面；
  快照失败显示本地化可恢复错误+重试，不再出现旧 PNG/表单路径或永久"画面尚未生成"。
- 首次打开：`project.list` → 记住的工程（经列表校验）/Host `defaultProjectId`/最近受管工程（过滤 demo）
  → `open`+`inspect` → 载入绑定会话；工程无会话则自动创建一次（ref 守卫 + requestId 去重）；
  完全没有工程时自动创建「空工程+会话」一次，失败可重试。右侧原生 Conversation/历史/模型/
  文件预览保持不变；已删除旧 PNG/表单编辑器渲染分支与 demo 入口。

## 3. 版本、包与 staging

| 项 | 值 |
|---|---|
| Bundle | `0.3.0-alpha.4`（root commit 见下） |
| Engine client / worker | `0.4.0` / `0.4.0`（协议 JSONL v1 不变，24 方法） |
| 固定提交 | `9efb172`（engine 0.4.0）、`32f4f77`（host）、`97a2ec0`（client）、`8799260`（harness/checks）、`79c6e20`（alpha.4 staging gate）、`5f2a271`（docs）、`d84ec5d`（复审缺陷修复）、`5956a93`（测试去 flake）；最终 docs commit 见 STATUS/PR |
| Engine tarball | 从固定提交 `d84ec5d` 的 `git archive` 后 `npm pack`：client 8610 B `14b85c39e89e912d6ab0924c88967c85c83c43921420a8b44334f4a5f35ed513`，worker 66733 B `f86b8639280b4c9f9d3dfefc4f11f41767f2912a228bafdb88a29e940ce7863b`（`artifacts/p3-012/packages/`） |
| Staging | 最终 clean 快照 `artifacts/p2-b/staging-p3-012-d84ec5d-d84ec5d/`（rootCommit=engineCommit=`d84ec5d`，rootDirty=false；`INTEGRITY.json` sha256 `9b8aff4ba3f9afaec75d603ed5dc6652aac9e987b9c8e43bf5e37de9c15ba199`，逐文件摘要记录 root/engine/versions） |

未安装到用户 DSH、未改 profile/调用模型：安装与真机验收仍需总调度复审后另行授权。

## 4. 验证分层与结果

> 数字为本轮实际命令输出；命令与证据文件在交付消息/证据目录中。复述时不把 mock 或工具调用当作
> 真实 DSH 激活或真实模型发起。

1. **Engine 单元/契约（Node，真实 worker 子进程）**
   - `packages/video-engine-worker`: `node --test --test-concurrency=1 test/*.test.mjs` →
     **44 pass / 0 fail**（含扩展后的 schema 双方法校验）。
   - `packages/video-engine-worker`: `node --test --test-concurrency=1 test/compose.integration.mjs`
     → **5/5**：发布/source/历史/重开/重启一致；unchanged/幂等复用；契约失败矩阵不写入口；
     stale revision 拒绝；写盘与快照证明失败均回滚旧作品；source 原始/escaped 界；复审回归
     （quote 密集文档 typed 拒绝且 worker 存活、注释/null timeline 被拒）。
   - `packages/video-engine-client`: 同命令 → **22 pass / 0 fail / 1 opt-in skip**（0.4.0 打包、
     compose/source 帧形状、worker `uncertain` 透传）。
2. **Host 契约（fake worker seam，Node）**：`node scripts/check-host.mjs` → **53/53**。覆盖 Tool
   action/参数/schema/工作流文案、48 KiB 预校验、compose 后 facts/下一轮 context 的 revision 与
   free-form mode、prompt context 必须片段/预算/无路径泄漏、compose/source 的 Agent Session 作用域、
   project.list recency/default/stat 容错。基线 46 项保留，无删除。
3. **Client 冒烟（fake host，Node VM）**：`node scripts/smoke-client.mjs` → **71/71**。新增
   P3-012 流程用例（首开自动供给一次、自动打开最近工程并忽略 demo、revision 轮询自动换快照、
   快照失败可恢复且非旧文案、产品面板无手动控件、返回面板恢复记住工程、无会话自动建一次、
   previewOnly 组件门禁）。基线 80 项中手动画布/旧表单相关 16 项按新范围替换（清单见交付消息），
   P3-008 runtime 契约与手动 wiring 用例继续覆盖。
4. **静态/打包门禁**：`node scripts/check.mjs` → **50/50**；`node scripts/test-stage-version.mjs`
   → **10/10**（alpha.4 版本门禁）；`npm run check` 全绿。
5. **开发 staging 真组件浏览器（真实 Chrome + 真实 staging Host/worker）**：
   - P3-008 runtime/画布回归（旧手动路径仍保留在默认 false 分支）：
     `scripts/test-canvas-browser.mjs` → ok；`scripts/test-canvas-chain.mjs` → ok（managed 工程
     创建/编辑/历史/快照/frame/render/close/reopen 全链）；`scripts/test-host-engine.mjs` → ok
     （doctor/open/inspect/frame/render/cancel/close 真实子进程链）。证据在
     `artifacts/p2-b/evidence/{canvas-browser,canvas-chain,engine-run}-2026-10-18T*.json`。
     `test-canvas-workspace.mjs` 手动画布套件本轮按任务不重跑，不作为交付关口。
   - P3-012 新闭环（独立 verifier harness，见第 5 节）全部通过；另有 P3-008 canvas 浏览器 runtime
     契约保持通过（fixed runtime ready/seek/play，旧 `previewOnly:false` 实现未改动）。
6. **未验证（诚实申报）**：真实 DSH 安装/激活、真实模型对话闭环、真机 UI 像素/主题/窄窗、
   外部素材导入新路径、任意更大 HTML 的模型生成质量、宿主崩溃/重启后的自动恢复、其他插件共存。

## 5. 独立验证（verifier，最终 fix staging）

两个 harness 由独立 verifier 编写，在最终 clean 快照上按顺序运行（非并发），产物与截图在
`artifacts/p3-012/evidence/`：

- `scripts/test-conversation-chain.mjs --staging staging-p3-012-d84ec5d-d84ec5d` →
  **ok=true，230/230 checks**（chain-2026-10-18T09-21-36-685Z）。同一受管工程经真实 staged Tool
  （`agent.session.id`）连续 3 次 compose：genre A 插画动画 (1280×720/6s)、genre B 文字动效
  (720×1280/5s)、以及基于已发布 source 的第二轮修改（改 headline/accent/动画，kicker/sub/footer/
  背景字节保留）；每轮 inspect revision/frame 同步、source 精确往返。失败矩阵 **28/28** 均返回
  typed error 且 revision 与入口字节不变；另有 E_REVISION_CONFLICT / E_OPERATION_REUSED /
  unchanged / 幂等重放 / Tool 作用域三态 / 参数错误。snapshot entry 逐字节一致（仅注入固定
  runtime）、CSP `connect-src 'none'`、gsap 资产字节一致；真 Chrome fixed runtime：genre A ready
  {1280,720,6}、seek 2.4 精确、play 到 2.867s；genre B {720,1280,5}、seek 2.0、play 到 2.467s；
  无外部请求。真实 host prompt context 3303 字符，含工作流/双上限/`window.__timelines`/禁止 shell
  写工程/自由创作路径/新 revision，无绝对路径。close→reopen 同一 revision 与精确字节；dispose 后
  0 路由/in-flight/snapshot；staging 前后源文件摘要审计 same=true（只读）。
- `scripts/test-conversation-preview.mjs --staging staging-p3-012-d84ec5d-d84ec5d` →
  **ok=true，41/41 checks，B1–B5 全 true**（preview-2026-10-18T09-23-44-973Z，8 张真实页面截图）。
  真实 staged client factory 按 region 标记抽取并与 INTEGRITY 校验后在真 Chrome 挂载、对真实
  staged bridge/worker/request route 运行。模拟边界已记录：宿主原生会话渲染面用 inert harness
  faces、页面内一次性 fetch 失败注入；P3-012 未改会话面板。
  - **B1** 首次挂载自动供给工程+Session 并自动出画面：mount→ready **708ms**（无用户动作、无 demo）；
    Tool compose A 发布→左侧 ready **1518ms**（Tool 59 + follow poll/load 1459）。
  - **B2** 同工程第二次 compose B 发布→ready **1221ms**；revision 标记/snapshot/画面像素均变化；
    poll 实测 1500ms 中位；全程无手动刷新。
  - **B3** 真鼠标播放→时间前进、按钮变 Pause；暂停稳定；真 range 点击 seek→`3.01 / 5.00`。
  - **B4** 注入 preview.snapshot 失败→phase=error 且提示可恢复+Retry（非旧文案）；Retry→同 revision
    ready；后续正常 revision 自动恢复，无需用户动作；无工程写请求。
  - **B5** 产品面板审计：0 个延期手动控件，仅 Play+seek+time；真实点击/双击/ArrowRight/Space
    产生 **0 写请求**、无选择/编辑器；external requests 0。
  - 诚实噪声：旧 iframe 的 gsap 资产加载在新 revision 注册时被替换取消（Host 替换同工程旧 snapshot
    路由），属替换期取消，非用户可见失败；最终检查通过。

## 6. 独立复审发现的缺陷与修复（2026-10-18，commit `d84ec5d`）

独立 verifier 在冻结 staging 上做了对抗性边界 probe，发现并报告 3 项；修复后已用可执行证据闭环：

1. **HIGH（已关闭）— 一个契约合法输入可杀死视频引擎。** 原始 48 KiB 内但 quote/backslash 密集的
   HTML，JSON 转义后使 JSONL 请求帧 > 65536；worker 返回无法关联的 `id:null` E_LINE_LIMIT 帧，
   engine client 视为协议失败并 SIGTERM worker，之后所有视频请求 `E_WORKER_EXITED`，需重载插件。
   修复：Host 在 validate 阶段同时校验 escaped ≤61440（`E_PARAMS`，不启动 worker）；worker
   composition 校验同一 escaped 上限（`E_COMPOSE_INVALID`）；worker `project.source` 加 escaped
   `E_LIMIT`。修复后 probe：49024 B quote 文档被 typed 拒绝（fatalProtocolError=false、入口字节
   不变）、随后 inspect/source/normal compose 均正常（无 E_PROTOCOL/E_WORKER_EXITED）；较小的
   escaped 60499 B 文档仍可正常 compose（边界是 escaped 驱动，不过度收紧）。证据：
   `artifacts/p3-012/evidence/defect-boundary-2026-10-18T09-14-26-864Z/`（修复前）、
   `defect-postfix-2026-10-18T09-23-59-589Z/`（修复后 7/7 期望结果）。
2. **MEDIUM（已关闭）— timeline 暴露是原始 HTML 文本匹配。** `window.__timelines = { main: tl };`
   写在 HTML 注释里、或 `main: null` 都能 compose 成功并拿到 `publishedRevision`，但 runtime 永远
   无法 ready。修复：只扫描 inline `<script>` 体（忽略 HTML 注释与 `src=` 脚本），拒绝字面量
   `main: null/undefined`；代码注释与本文明确这是“必要非充分”静态检查，播放证明仍由预览 runtime
   承担，失败会显示可恢复预览错误而不是静默成功。
3. **LOW（已关闭）— “48 KiB 保证 source <64 KiB”的声言不总成立。** escaped 上限修复后该声言可执行
   成立：source escaped >61440 返回 `E_LIMIT`（planted 49024 B quote 入口验证），正常 source 结果
   与 Tool wrapper 都在 64 KiB 内；composition.mjs 头部注释同步更正。

残留限制（如实记录，不影响本轮 A–E 验收）：engine client 对无法关联的协议帧仍按致命处理（既有设计），
Host 的 escaped 预校验使文档允许路径不再能产生这种帧。engine-client 有一个 spawn-context 测试在原
200ms handshake 预算下受高负载影响偶发超时（与运行时修复无关），已在 `5956a93` 给该两类用例独立
宽松预算（负向超时用例保持 200ms）。

## 7. 已知限制与后续

- 原始 48 KiB + JSON-escaped 60 KiB 双上限是 AI 编辑路径的 MVP 边界；已有更大的旧工程仍可被浏览器预览，但
  `project.source` 会明确 `E_LIMIT`，不静默截断。
- 发布前校验是"契约+SDK+快照管线"验证，不是"浏览器已播放"证明；timeline 暴露是静态必要非充分
  校验；真正播放由左侧 snapshot+runtime 证实，运行时播放失败会显示可恢复错误（用户可让 AI 修正
  或重试），不谎报完成。
- iframe sandbox/CSP 不是 OS 沙箱；本轮没有新增任意 Node/文件/网络入口：compose 只能写绑定工程入口。
- compose 全量替换文档，AI 需自行保留未要求修改的内容；prompt 已明确要求，但复杂回归仍取决于模型。
- 手动编辑控件已从产品 UI 移除但底层 typed API/代码保留，后续恢复直接编辑时无需重做引擎。
- 安装、真实模型、真机与发布到 main 仍按协调规则另行授权。
