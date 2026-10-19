# P2-005 A spike：插件内隔离预览/播放可行性

日期：2026-10-17。执行：程序员 2（DSH 会话）。基线 `afd2a29`，B 小改提交 `da8a22b`。本文件只记录 **dev-only spike**，不改变生产 Host/Client/worker；不是安装、发布或安全认证。

## 结论（先行）

1. **A1（sandbox iframe + 工程快照 + 固定 HyperFrames runtime）在受控工程上可行**：真实 Chrome 155 中，opaque-origin iframe 可播放/暂停/seek；断网后 seek 0.5/2.5/4.5s 均成功，播放推进，外部请求 0。它与现有 `frame` 输出在内容和时间点上一致，但**像素不逐字节相同**（详见 §4）。
2. **A1 的生产化前置是 engine 新 snapshot/preview 能力**：现有 Host/worker 没有“按 projectId+revision 只读提供快照”的方法。建议 worker 生成不可变 preview snapshot（entry+声明资产，relative allowlist、hash、过期清理），Host 只按 snapshotId 提供精确 asset 路由；**预览面永远不接受任意 path/URL**。只用 Host 直接读 registry 目录会让 Host 复制内容/绕过 worker 单写者与 revision 权威，不够干净。
3. **A2（复用 HyperFrames Player/Studio）不建议作为第一版路径**：Studio 是完整编辑器（dist 6.1 MB + `@hyperframes/studio-server` 672 KB），`hyperframes preview` 启动的是本地 Studio server，`hyperframes-player` asset 仍 import Studio bundle 并默认从 CDN 取 runtime；没有找到可独立嵌入的只读 player 入口。若未来官方提供稳定只读 player API，再单独评估。
4. **A3（抽帧升级）不满足“真播放”**：真实 `frame` 每个时间点约 **5.0–5.5 秒**（本机 1280×720、5s fixture；见 §4），无法提供流畅 seek/播放；适合作为 B 的回退或时间点预览增强，不应冒充播放器。
5. **推荐**：先做 A1，按“engine snapshot → Host preview route → Client sandbox iframe + transport/fallback”拆任务；A2 另立调研，A3 保留为 fallback。受控 fixture 之外，不可信 HTML/JS 的隔离仍不能仅靠 iframe sandbox 宣称安全。

## 1. 原型与证据

目录：`experiments/preview/`（dev-only，`node_modules` 不提交）。

- 固定 `@hyperframes/core` **0.8.167**（runtime IIFE SHA-256 `d775fc6cd16859218f09e1ba1fa0b0d37792982e9b222592a149451addb53cef`）与 `puppeteer-core` **25.14.0**；`package-lock.json` 入库，`npm ci --ignore-scripts`。
- 原型 server 只从一个受控 fixture 提供：`index.html`、`project.json`、声明资产（GSAP/MotionPath/本地 Heiti 字体）以及固定 runtime 文件；不是通用文件服务器。
- 父页面 sandbox iframe：`sandbox="allow-scripts"`（**无** `allow-same-origin`），CSP：默认 none、脚本/样式/字体/图片/媒体仅本地 snapshot origin、`connect-src 'none'`；父页面只通过窄 `postMessage` 发送 `play/pause/seek`，不读取 iframe DOM、不注入宿主/插件 API。
- 真实 Chrome evidence（headless，`Chrome/155.0.8059.79`）：
  - 证据 JSON：`experiments/preview/evidence/offline-seek.json`
  - 截图：`experiments/preview/evidence/seek-0.5s.png`、`seek-2.5s.png`、`seek-4.5s.png`、`playback-paused.png`
  - 关键事实：snapshot ready `~1438 ms`、assets ready `~1441 ms`；`navigator.onLine=false` 后 seek 0.5/2.5/4.5s 的 runtime state 分别为 `0.5/2.5/4.5`（误差 <0.15s），每次 seek 约 `406–440 ms`；play 后 state `isPlaying:true` 且 `currentTime` 推进，pause 后 `isPlaying:false`；**external request count 0**；iframe `contentDocument` 访问被阻止（`sandboxProbe.access="blocked"`，frame origin opaque）。
  - 运行命令：`node experiments/preview/run.mjs --fixture <controlled demo> --chrome "<Chrome>"`.

> 注意：这是 headless Chrome 的本地 prototype，不等于 DSH 页面内实际 CSP/键盘/焦点/主题表现；也不是对不可信代码的安全证明。

## 2. 候选对比

| 方案 | 播放/暂停/seek | 首帧/seek 延迟（实测） | 与 frame/render 一致性 | 实现复杂度/风险 |
|---|---|---|---|---|
| **A1** sandbox iframe + snapshot + runtime | **真播放/暂停/seek 已验证** | ready ~1.44s（含 53MB 本地字体）；seek ~0.41s | 内容/时间点对齐；像素非逐字节（§4） | 中：需 engine snapshot + Host snapshot route + CSP/iframe 资产打包；需验证 DSH CSP/规模 |
| **A2** 复用 Player/Studio | Studio CLI 有 preview/播放，但未找到独立只读 player 入口；source-only | 未测（Studio 6.1MB assets + server 672KB） | 未测 | 高：Studio 是编辑器/server，player asset 仍 import Studio bundle 且默认 CDN runtime；版本/许可/隔离耦合大 |
| **A3** 抽帧升级 | 无真播放；只能离散时间点换 PNG | 每帧约 5.0–5.5s（`worker-frames.json`） | 与 worker frame 完全同源 | 低，但体验不满足“播放” |

### A2 的具体观察（source-only）

- `hyperframes preview` CLI 的帮助显示它启动 **Studio server**（默认 `localhost:3002`，支持 background/stop/selection/context、打开浏览器等），不是只读 embed API。
- `hyperframes/dist/studio/index.html` 加载完整 Studio bundle；`studio/assets/hyperframes-player-*.js` 仍 import `index-*.js`，并含 `cdn.jsdelivr.net/npm/@hyperframes/core@.../hyperframe.runtime.iife.js` 默认 CDN 分支；离线和隔离都需要替换 runtime URL/重打包。
- 结论：A2 可研究，但不应直接嵌入生产；需要官方稳定 player API 或明确的只读打包/许可边界。

## 3. 工程快照如何只读提供（提案）

当前 **没有** Host/worker 的 snapshot/preview 方法；现有 `inspect.files` 只有相对路径/bytes/hash 清单，`frame/render` 使用 worker 私有快照，Host 不能直接读取工程内容。建议分两步：

1. **engine 新方法（只提案，不改本轮代码）**：`snapshot {projectId, revision}`（或 `preview.snapshot`）
   - worker 校验 projectId 已注册、revision 当前/固定快照一致；把 entry+声明资产复制到 worker 私有 `outputRoot/previews/<snapshotId>/`；
   - 返回 `{snapshotId, projectId, revision, entry:"index.html", assets:[{path,bytes,sha256}], expiresAt}`（只相对声明名，不含绝对路径/URL）；
   - preview snapshot 只读、不可编辑；worker 是唯一快照写入者；过期/close/worker 退出清理；大小/数量上限；
   - 这样保持“worker 唯一内容写者”，Host 不复制工程内容。
2. **Host 精确路由**：`GET /api/dsh-video/preview/<snapshotId>/<assetName>` 或 query `snapshotId`+`asset`
   - 只接受 Host 已登记（projectId+revision）的 snapshotId 和 manifest 内 assetName；拒绝任意 path/URL/`..`；
   - realpath 在 worker 私有 preview 根内、普通文件、大小/hash 校验；Content-Type/Length/no-store；
   - Host 注入 runtime/预览文档时也只指向该 manifest；不把 Host/DSH session/cookie/凭据传给 iframe；CSP `frame-ancestors` 限定插件页面；
   - snapshotId 不持久化，Host 重启/worker 重启后旧预览拒绝（同现有 job 语义）。
3. 不建议：Host 直接读 `registry.projects[projectId]` 静态目录。它绕过 worker revision/单写者，也无法自然处理 assets/快照清理。

## 4. 一致性与边界

- 同一 revision：原型从 clean demo 读取；worker frame 由同一 `da8a22b` staging Host/worker 在同一 revision `135a529…` 生成。
- worker frame（1280×720）与 iframe 截图（1280×720）在 0.5/2.5/4.5s：
  - worker PNG SHA：`0240f557…` / `efca929…` / `e08dd62b…`；iframe 截图 SHA：`2e25d12b…` / `4b3d0577…` / `068cb70d…`；
  - 像素比较：MAE ≈ **0.78/255**，约 **95.5% 像素完全相同**，最大单通道差 202；差异集中在字形边缘/抗锯齿（截图/合成路径不同），不是时间点或内容错位。
  - 结论：**内容与时间基准一致，但不是像素级 parity**；若产品需要逐字节一致，应比较同一渲染/截图路径，不能以 A1 单独证明。
- A3 的 worker frame 实际耗时：0.5s → 5,537ms；2.5s → 5,108ms；4.5s → 4,951ms（当前本机 staging、含 SDK/Chrome 路径），不能作为连续播放。

## 5. 隔离、CSP 与资源结论

- **已实测**：`allow-scripts`（无 `allow-same-origin`）→ 父页面不能读取 iframe `contentDocument`（`blocked`）；iframe origin 为 opaque；断网后播放/seek 仍工作；外部请求计数 0；本地字体/GSAP/runtime 均从本地 server 加载。
- **CSP prototype**：`default-src 'none'; script-src 'unsafe-inline' http://127.0.0.1:<port>; style-src 'unsafe-inline' ...; font-src http://127.0.0.1:<port>; img-src ... data: blob:; media-src ...; connect-src 'none'; frame-ancestors 'self'`。生产需按 DSH 页面实际 CSP/挂载路径调整；不能假设 `'self'` 在 opaque iframe 中有效。
- **不是安全边界**：同浏览器进程执行不可信 HTML/JS，仍可有 CPU/GPU/渲染 DoS、浏览器/渲染器漏洞面；sandbox 只限制 DOM/导航/存储/网络权限。对任意 Agent 生成代码仍应保持“不可信”，需要额外隔离/审核/大小限制；当前只承诺受控 fixture。
- **资源**：A1 原型加载 runtime **528,966 B**、GSAP 71K、MotionPath 21K、fixture 字体 **53 MB**；无 CDN。字体可改由受控 snapshot manifest 提供，但大小/许可/缓存要算入首帧；Player runtime 固定 0.8.167，升级需与 worker 版本一致。首帧约 1.44s 是本机本地 server + 53MB 字体输入，未代表生产缓存/网络。
- **iframe/宿主要求**：父页面只保留窄 postMessage 控制协议；不注入宿主 API、cookie、DSH 凭据；预览面不访问 `window.parent` 之外；不导航/弹窗/下载/表单；`connect-src 'none'`；子帧不可读宿主 DOM；Host 只允许受控 snapshotId/assetName。生产还需验证 DSH 页面 CSP 是否允许 iframe/worker、CSP frame-ancestors、焦点/键盘、主题与窄窗。

## 6. 推荐实现拆分与风险

建议新任务（不由本 spike 自动实现）：

1. **引擎任务**：worker snapshot/preview 方法、私有快照目录、manifest/hash/过期/大小上限/清理；协议测试与真实链。
2. **Host 任务**：登记 snapshotId→project/revision；精确 preview asset 路由；realpath/manifest/hash/大小校验；CSP/iframe 文档；权限/清理；拒绝任意 path/URL。
3. **Client 任务**：sandbox iframe + 窄 postMessage 控制（play/pause/seek/状态），play 按钮必须有用户手势；失败/加载中回退到 B 的单帧预览；保持 worker/project 状态不被 iframe 重载破坏；主题/焦点/窄窗验收。
4. **A2 调研任务**：仅当官方提供稳定只读 Player API/离线 runtime 打包时；否则不引入 Studio server。
5. **A3 保留**：B 的画面时间输入作为无 snapshot/失败时 fallback；不把连续抽帧包装成播放。

**主要风险**：任意不可信工程 HTML/JS 仍可能消耗/攻击预览进程；53MB 字体/大资产首帧与内存；runtime 版本升级与渲染一致性；iframe 焦点/键盘/主题在 DSH 中未验证；CSP/端口/权限可能阻止 iframe；快照存储清理；像素非逐字节一致；许可/分发（字体、GSAP、Player runtime）。

## 7. 未验证项

- A1 在真实 DSH 页面/真实插件 CSP、沙箱 permissions、焦点/键盘、明暗/窄窗、HMR/卸载中的表现；
- A2 Studio/Player 的实际嵌入（本 spike 未运行 Studio）；
- A3 在用户工程/多 Scene/长片上的 seek 延迟与内存；
- 不可信 HTML/JS 的隔离强度、网络/DNS/IP 泄漏、OS 退出后的资源清理；
- 任意用户素材、音轨、字体许可、跨平台（Windows/Linux）与真实出口；A1 当前只证明受控 fixture。

## 8. 原型文件与命令

```text
experiments/preview/
  package.json / package-lock.json   # fixed core 0.8.167 + puppeteer-core 25.14.0
  server.mjs                         # loopback fixed fixture+asset allowlist + runtime; host page/iframe CSP
  run.mjs                            # real Chrome, offline seek/play evidence
  worker-frames.mjs                  # same-revision worker frames for consistency
  compare-frames.mjs                 # sharp pixel MAE comparison
  evidence/offline-seek.json         # A1 evidence
  evidence/seek-*.png / playback-paused.png
  evidence/worker-frames.json        # worker frame latency/hash
  evidence/consistency.json          # pixel comparison
```

全部为 dev-only；`node_modules` 被根 `.gitignore` 忽略，未改生产 Host/Client/worker 协议。
