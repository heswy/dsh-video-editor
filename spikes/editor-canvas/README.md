# P3-005-B 受控画布与直接编辑试验（dev-only）

独立试验页 + 真实 Chrome 自动化，验证 **worker 预览快照 → 沙箱 iframe 播放/seek → 点击选中 → 原位文字修改 → 共享 worker 写回 → 新快照** 的最小真实链路，并给出位置/缩放/样式写回的确切能力缺口。

**这不是 DSH 插件，也不是 DSH 真机页面**：试验页由本目录自带的小型 Host 服务提供，只读取受控 worker 的预览快照；不安装、不改 profile、不改两引擎生产代码。P3-005-B 结论见 `docs/research/P3-005B-editor-canvas-spike.md`。

## 固定输入

| 项 | 值 |
|---|---|
| 引擎固定功能 | P3-005-B 历史证据：`df4b74f`（head `e364017`），两包 **0.2.1**；P3-006-B 新证据：两包 **0.3.0**（layout/style typed ops） |
| 运行 | Node **v24.14.0**、Chrome **155.0.8059.84**、puppeteer-core **25.14.0**（复用 `packages/video-engine-worker/node_modules`，本 spike 无独立依赖、无安装脚本） |
| SDK 探测 | `@hyperframes/sdk` **0.8.167**（同一 node_modules，仅用于 Host 自有副本的 API 探测） |
| 合约/运行版本 | message contract **v1**、preview runtime **p3-005b-runtime.1** |
| 受控工程 | `product-launch-v1` 3 Scene（5+4+2s，1280×720/30fps，含 logo/shot 图片），由真实 worker/client 创建 |

## 运行

### P3-006-B 持久化证据（0.3.0，当前引擎）

```sh
# worker/协议能力矩阵：layout/style 已持久化、scene 重生成保留、字段级合并冲突、SDK 旁路边界
node spikes/editor-canvas/scripts/capability-probe.mjs           # 输出 evidence/p3-006b/capability-evidence.json

# 真实帧/MP4：改位置/颜色/字号后视觉变化、两个动画时刻基座+transform 分离、H.264 元数据、undo/redo
node spikes/editor-canvas/scripts/persistence-evidence.mjs       # 输出 evidence/p3-006b/persistence-evidence.json + PNG
```

新证据目录为 `evidence/p3-006b/`，**不覆盖** 0.2.1 的历史证据（`evidence/*.json`、`evidence/*.png`）。旧的 `run-canvas.mjs` 与其 41 项证据是 P3-005-B（0.2.1）的历史交付：其中“layout 提交被 E_PARAMS 拒绝”的缺口断言正是当时要证明的状态，**不要用 0.3.0 重跑并覆盖**；新能力以 `persistence-evidence.mjs`/`capability-probe.mjs` 为准。

### P3-005-B 历史证据（0.2.1，勿覆盖）

在仓库根目录：

```sh
# 合约 + Host 服务的 Node 测试（无浏览器）
npm test --prefix spikes/editor-canvas

# 真实 Chrome：播放/seek/选中/原位编辑/写回/冲突/失败恢复/拖动缩放缺口
node spikes/editor-canvas/scripts/run-canvas.mjs \
  --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# worker vs SDK 写回能力矩阵（无浏览器）
node spikes/editor-canvas/scripts/capability-probe.mjs

# 全部
npm run all --prefix spikes/editor-canvas
```

`run-canvas.mjs` 可用 `--out <dir>` 改证据目录、`--headed` 打开可见窗口；`capability-probe.mjs --out <dir>` 同样可避免改写已提交证据。运行临时目录在 `artifacts/`（gitignored），结束时删除；默认证据写入 `evidence/`（提交）。

## 组成

```
public/
  index.html, styles.css   独立试验页（左侧画布 + 播放条 + 诊断侧栏，不是最终 UI）
  canvas.js                Host 层：实例生命周期、消息台账、letterbox/坐标映射、
                           选中覆盖层、原位文字编辑、拖动/缩放暂态与缺口探测
  contract.js              版本化消息/坐标/编辑守卫合约（浏览器与 Node 测试共用）
  preview-runtime.js       固定 runtime，由 Host 注入沙箱文档；只驱动文档自身
                           GSAP timeline（seek/play/pause/hit/getElements/destroy）
scripts/
  lib/host-server.mjs      试验 Host：session、快照 manifest 精确路由、逐文件
                           byte/sha256 校验、CSP+inline hash、runtime 注入、请求日志
  lib/worker-harness.mjs   真实 worker/client：受控工程、快照、edit、frame、重开/重启
  run-canvas.mjs           0.2.1 历史真实 Chrome 证据 runner（41 项断言）
  capability-probe.mjs     0.3.0 写入能力矩阵（layout/style 已持久化、合并/重生成/SDK 边界）
  persistence-evidence.mjs 0.3.0 真实帧/MP4 持久化与 undo/redo 证据
test/
  contract.test.mjs        消息严格性/违规序列/迟到响应/跨实例/坐标/编辑守卫
  host-server.test.mjs     快照路由、逐文件校验、篡改 409、撤销 404、CSP/hash
evidence/                  0.2.1 历史 JSON/截图 + 0.3.0 的 `p3-006b/` 新证据（均提交）
```

## 已证明的行为

- **沙箱隔离**：`sandbox="allow-scripts"`（无 `allow-same-origin`）、`referrerpolicy=no-referrer`；父页面读取 `contentDocument` 为 `null`、`contentWindow.document` 抛 `SecurityError`；runtime 消息 `event.origin === "null"`（因此 **origin 不能当认证**，绑定用 iframe WindowProxy 身份 + instanceId + nonce + 严格消息形状）。
- **资源与网络**：只请求试验 Host 路由（session / 快照 entry+资产 / runtime / 页面资源）；0 个外部请求；entry 响应 CSP：`default-src 'none'`、`connect-src 'none'`、`frame-ancestors 'self'`、`script-src <host> 'sha256-<inline timeline>'`（快照原始字节 hash 校验后才注入 Host 固定 runtime）。断网后 seek/play/选中仍工作（资源已载入，runtime 不联网）。
- **播放/seek**：9 个时间点（含 4.99/5.0/9.0/10.99s）请求与落点一致；播放 800ms 推进约 0.72s；暂停后时间保持。预览与 worker `frame` 抽帧在 1.5/5.5/9.0s：**99.3%/99.1%/99.9% 像素一致，MAE 0.36/0.30/0.04**（差异集中在字形抗锯齿）。
- **选中/坐标**：真实鼠标点击命中精确 `stableId`；选中描边/手柄只在 Host 编辑层，沙箱 DOM 不变；letterbox 1100×700 与 760×640 下坐标往返一致，留白区不命中；Scene 边界、隐藏对象（`data-start` 时间窗）、重叠对象（topmost + stack）行为明确；结构容器不在可编辑选择范围。
- **原位文字编辑写回**：双击打开覆盖层、Esc 不写回；Enter 经 worker `edit` + `expectedRevision` + `operationId` 提交，revision 变化并加载新快照；close/reopen 与整 worker 重启后文字仍在。旧 revision 提交返回 `E_REVISION_CONFLICT` 且不覆盖外部/AI 文本；刷新后可重试成功。项目目录只读注入 `E_PERSIST`，草稿保留、恢复权限后重试成功。
- **位置/缩放/样式缺口**：拖动/缩放只移动 Host 编辑层，快照 DOM 不动；提交 `layout` typed op 被 worker 以 `E_PARAMS` 拒绝，revision 不变。播放中拖动被阻止。
- **写回能力矩阵**（`capability-evidence.json`）：文字、显式 timing、Scene 级颜色/强调色/Logo/截图/时长可由现有协议持久化；元素位置/尺寸/颜色字体等样式、层级/旋转、拖动/缩放均无协议写路径。SDK `setStyle` 可在 Host 自有副本持久化，但随后 `scene.update` 的整 Scene 重生成会把元素级样式覆盖回模板值——正式实现必须把 typed layout/style op 接进生成器、历史与合并路径。
- **快照生命周期**：旧 revision 快照请求返回 `E_REVISION_CONFLICT`；切换新快照后旧 snapshotId 的 Host 路由 404、worker 释放返回 `E_SNAPSHOT_NOT_FOUND`；worker 退出后 `previews/` 为空。
- **清理**：销毁实例后无 frame、无新命令/事件；worker 快照释放后 Host 路由 404；`previews/` 为空；运行目录删除；浏览器/服务关闭。

## 边界（不要外推）

- 只证明**受控模板**可行，不证明任意工程 HTML/JS 安全；sandbox/CSP 不是完整浏览器/渲染器安全边界，也不是 OS 沙箱。
- runtime 由 Host 注入并注入固定脚本标签；原始快照字节先做 manifest hash 校验，文档内联脚本以 hash 进入 CSP。该“文档组合”是提案，正式 Host 需冻结版本与方式。
- 未测真实 DSH 页面/CSP/主题/焦点、Host 精确资产路由的真实插件实现、Safari/Firefox/Windows、音频/视频素材、任意代码工程。
- 拖拽对齐线、缩放比例约束、浮动工具条完整交互不在本 spike 范围；只验证坐标/选择/写回缺口与最小合约。
