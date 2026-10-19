# P2-005 复审：画面时间点预览（B）与隔离预览 spike（A）

日期：2026-10-17。总调度独立复审。结论：**B 功能与打包/真实链通过，但缺 R1 深色对比修复，需补丁后随 0.2.1 一次重装；A spike 验收通过**（A1 可行但需 engine snapshot，实现暂不排，P3 优先）。

评审对象：`afd2a29` 之后两个提交——`da8a22b`（B 生产改动）、`2539b8e`（A spike 文档/原型），分支 `dsh/p0-mode-shell`，PR #3 head `2539b8e0ed590ad9d37d88a14c2e0cce5c50f20a`。

## 独立核对

- **范围**：25 个文件；根插件 `client.js`、`locale`、`package.json`、`README`、`scripts`，`docs/**`，`experiments/preview/**`。未改 `packages/video-engine-*`、`spikes/**`、Host 协议语义；根包依赖未新增（`package.json` 仅版本/描述变化）；工作树干净，远程一致。
- **检查**：独立复跑 `npm run check` 通过——静态 34/34、Client smoke 42/42、Host 契约 20/20，合计 **96/96**。
- **固定包**：`artifacts/p2-b/da8a22b/dsh-video-0.2.1.tgz`，39,678 B / 17 files，SHA-256 `bb8e56339d4a633a82605c7f2f665392042905e0a10d53e3f9cbf64feccf9f3a`；解包后 **17/17 与 `da8a22b` 逐字节一致**；旧 0.2.0 包未覆盖。
- **B staging**：`staging-54f4671-da8a22b`；`INTEGRITY.json` SHA-256 `8d6eea45…`，root `da8a22b…`、engine `54f4671…`、版本 `0.2.1/0.1.1/0.1.1`、staged Host `07442c86…`、config `856ea63a…`、patch `5754edd8…`、`rootDirty:false`、bundle 16/client 12/worker 15、`esbuildAvailable:true`；受控 demo 标题已恢复 `让创意成为影像`。
- **真实链证据**：`engine-run-2026-10-17T09-23-47-072Z.json` 通过——执行 staging 内 Host；edit `hf-title`；revision `135a529…`→`f714e71…`；PNG 279,463 B/`875b48c6…`；MP4 135,855 B/`fae2687e…`；第二次 render cancel→cancelled；close/dispose 正常、无 warning。
- **安装状态**：profile 仍为 `dsh-video 0.2.0`（link clean staging），本轮未安装/未改 profile。

## B 功能审查

- 「画面时间」输入 `0..duration`、step 0.1；`parseFrameTime` 拒绝空值/非有限/越界并就近报错，不静默换时刻、旧帧保留；打开默认 2.5s 或恢复上次；`frame` 请求携带所选 `time`；view memory 恢复时间点/帧/job/target/draft。
- 未新增 Host/worker 方法，无假播放/时间线/自动轮播；静态检查会拦截「播放/时间线/暂停/seek」等未支持文案。
- 已知代价：单帧约 5 秒（A3 实测），点「更新画面」会明显等待；这是引擎侧抽帧开销，不是 B 的缺陷。

## A spike 审查

- 证据充分且内部自洽：真实 Chrome 155、`sandbox="allow-scripts"`（opaque origin，父页面读 `contentDocument` 被拒绝）、断网 `online:false`、外部请求 **0**、ready 1,438 ms、seek 0.5/2.5/4.5 s 实际落点一致、每次 406–440 ms、play 推进后 pause 生效、错误为空。
- 一致性：同 revision 与 worker frame 比较 MAE ≈ 0.78/255、≈95.5% 像素相同、最大通道差 202（集中在字形/抗锯齿）；**内容与时间基准一致，但非像素级 parity**，结论表述准确。
- A2 不推荐第一版（Studio 6.1MB + server 672KB、player asset 依赖 CDN runtime、无稳定独立只读入口）；A3 抽帧约 5.0–5.5 s/帧，只能当 fallback。
- 生产化前置（engine snapshot + Host 精确 asset 路由 + Client sandbox iframe）与 worker 单写者/revision 权威一致，拆分建议可用；风险与未验证项已如实列出（真实 DSH CSP/焦点/主题、53MB 字体首帧、sandbox 非完整安全边界、runtime 版本耦合、许可）。
- `experiments/preview/**` 为 dev-only，锁文件入库、node_modules 未入库；证据约 1.6 MB，可接受。

## 缺口与判定

1. **R1 深色按钮对比未修**（必须补）：`client.js:433` 仍是 `color:var(--dsw-alias-label-on-brand, #fff)`，宿主不存在该 token，深色主题 `--dsw-alias-brand-primary` 近白 → 白底白字。**0.2.1 当前包不得直接用于重装**，补丁后需重打包/重 staging。
2. A 实现不排进本轮：P3（AI 生成视频）主线优先；A1 生产化拆为后续独立任务（engine snapshot → Host route → Client iframe），届时单独验收。
3. 未验证：B 的 0.2.1 真机 UI/主题/窄窗/卸载重启；A1 在真实 DSH CSP/iframe 下表现；均待重装/后续任务。
4. 非阻塞观察：`experiments/preview` 提交了约 1.6MB 证据与锁文件（合理）；`stage-dev.mjs` 硬编码期望版本 0.2.1（每次发版需同步，可接受）；A fixture 字体 53MB 对首次预览是主要成本。

## 下一步

1. 程序员 2 补 R1：改用宿主真实配对 token（如 `--dsw-alias-label-primary-inverted`/`--dsw-alias-brand-primary-invert`，以 inspection 为准），检查其它不存在 token 用法，加静态断言；重跑检查、重出 0.2.1 固定包与新 staging、真实链；commit/push PR #3。
2. 总调度复审后，用户在 Plugins 卸载 0.2.0、安装新 0.2.1，复核深色/浅色按钮与画面时间点预览。
3. P3 主线不受影响：程序员 1 的 P3-001 继续进行。
