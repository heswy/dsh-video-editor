# V1 M5 — 工程引用与 AI 协作

用户于 2026-10-22 指派当前会话继续完成 M5，并沿用既有自行判断合码授权。基线 main `45daeb1`（M4 PR #20）；独立树 `v1-m5-collaboration` / `codex/v1-m5-collaboration`。通用边界见 [DEVELOPMENT](../DEVELOPMENT.md)。M5 是最后一个功能里程碑，M6 发布硬化仍独立执行。

## 范围与契约

- 原生 `inputTriggers` 可选 source，仅为真实绑定工程的 Session 查询 Host；与官方 file/session source 共存，不接管 `@"` 或 drilled 查询。注册和移除归属 Cordis context；服务不可用时编辑器正常开放。
- 候选来自 `timeline.references`：片段 / AI 场景 / 已导入素材 / 时间区间；支持搜索、分页。Host `reference.list(sessionId)` 从可信映射取得工程，Tool 不能调用或借传入工程越权。
- chip 草稿保留 source/ref/label/appearance/clipboardText。发送及复制采用行内代码 `dshvideo:v1/PROJECT/KIND/ID/REVISION`，避免宿主 @file 规则吞掉名称；codec 是 total 函数，坏 token 退成显式 invalid，不因异常丢草稿。
- 插件「引用」入口、选中片段与素材详情提供可选中复制 token；自定义区间使用 30fps 整数帧。选择时先 resolve；用户删除/移动/改名后，发送前仍由 AI 对当前 revision 再 resolve。
- `timeline.resolve` 接受 token、稳定 ID、轨道内序号、名称或区间。跨工程、缺失、无效、过期区间与歧义均显式返回；不替换为邻近对象。稳定 clip/scene/asset 引用可跨位置变更；区间必须保持创建时 revision。split 保留左 ID，沿用 M3 lineage。
- 对话 system prompt 与 Tool 描述说明：每个 token / 序号 / 名称必须 resolve；没有指令时一句短问；坏引用一句提示重选；复杂操作可 dryRun；禁止长篇内部约束说明或不可交互的追问卡；冲突后重新 inspect/resolve，禁止盲重放。
- `timeline.inspect` 返回持久 `lastChange` 与 `historyCursor`。时间线展示真实 summary 和「撤销这次修改」；定向撤销同时校验 revision / history cursor / operation ID，防止撤掉后续用户修改。通用撤销/重做仍共享同一历史。
- UI 冲突保留原意图：加载当前内容 → 用户预演 → 查看真实 dryRun summary → 显式应用；预演不写入。响应丢失时保留完整原 request/operationId，仅重试同一请求，避免双写；未决意图可放弃，不自动重试。

## 验证与验收

开发验证使用临时数据根，不接触用户工程；源码、固定 staging、宿主实机/模型证据分层记录。

- `npm run test:collaboration`：引用/生命周期、真实 worker 状态/重启、真实 Host 归属、30 条中文操作契约场景。
- `M5_COLLAB=1 node scripts/test-v1-timeline-workspace.mjs <evidence> [--staging <candidate>]`：真实 Chrome + Host/worker，覆盖引用选择/复制文本、冲突预演/应用、定向撤销、已提交响应丢失后的幂等重试、340px 与 Escape；保留 M3 时间线手势回归。
- 完整 `npm run check`、worker/client 单测、版本门禁、固定候选 host-engine/canvas/conversation/preview，及 M4 音频工作区回归。
- **30 条中文场景是已明确目标和 ops 的契约夹具，不是模型一次成功率。** 原生 DSH @ 候选、chip 刷新/发送后展示、官方 @file/@session 共存、真实模型 3+ 轮混合 UI 编辑与 ≥95% 一次成功率仍需安装后联合验收；不能用 headless/组件通过替代。
- 本轮不安装/重启 DSH、不发起原生模型请求、不公开发布。M1–M5 联合验收和 M6 发布硬化按后续授权窗口执行；旧候选和作品保留。

## 固定候选与证据

- 固定 runtime `bed1f8db3416eacb9cd4f858069df9229dd546c3`，root=engine、rootDirty=false；bundle `1.0.0-alpha.6` / client+worker `0.8.0`。
- staging：同级 worktrees 下 `artifacts/p2-b/staging-v1.0.0-alpha.6-bed1f8d`；INTEGRITY SHA256 `07abdee2d82c165b80f105aa210492b8d459f8eb52bdc24d515196ce62ed90e5`。
- 证据：`artifacts/v1/evidence/m5-alpha6-bed1f8d-20261022/verification-summary.json`，同目录保留 gates/worker/client/version/collaboration、固定 workspace、conversation-chain、conversation-preview、host-engine/canvas-chain 原始记录。开发阶段红/绿与诊断保留 `artifacts/v1/evidence/m5-dev/` 和 `/tmp/dsh-m5-*.log`，不覆盖已审候选。
- 门禁：check 58、smoke 86、Host 71、worker 72、client 23（Node24 真 worker）、版本 10，零失败/无跳过。新增引用适配 13（含可选 source 异步注册失败降级/移除/重注册）、worker 协作 18（重启、过期区间、已删素材、重复区间合并、跨轨序号歧义、定向撤销）、Host 归属 7；30 条中文 ops 契约通过。
- 固定候选工作区 37：M3 手势 + M4 本地旁白生成/上轨/波形/声音/增益/淡化 + M5 Tool 作用域内引用解析/并发写入、UI 冲突预演、定向撤销、已提交丢响应后原请求重试、冲突后 inspect 暂时失败、引用复制/焦点/Escape/340px。此 Tool 调用由脚本驱动，不是真实模型。
- 同候选 22s / 660 帧有声导出成功：H264、AAC 48k 双声道、1 音源；预览 unmuted + playing，测得声音时间差约 10ms。没有重复云供应商收费调用；M4 千问 TTS/SFX 证据沿用 alpha.5 任务卡。
- 固定候选对话链 261/261、预览 164/164、真实引擎 frame/render/cancel、canvas-chain 均通过；源只读审计 91→91、same=true。
- macOS Chrome 155 后台 crashpad/updater 可继承 Puppeteer stderr，业务已释放但验证器进程延迟退出。验证器 `closeTestBrowser` 仅在自有 Chrome 已退出后关闭父侧 stdout/stderr 捕获流，不杀后台进程、不操作个人浏览器；运行时代码和固定 staging 未改。清理后复验记录另存 `*-clean-exit`。

宿主契约只读核对：本机 DSH Desktop `0.2.1-rc.2` 随包 `dsh-client-ui-reference/lib/client.js` 的 source/candidates/onPick/codec/registerSource；读取内容 SHA256 `3d179111c51381733c7d0ec13c60ee4d9444c1dfb474ef28a0127654b8ba28a3`。同时核对随包 cordis-plugin-development 的 practices/user-actions；未修改 app.asar/profile。可选服务异步出现后的注册异常也只降级，不影响编辑器。


## 宿主降级边界

随包 input-trigger 的 `serializeReference` 在 source/codec 缺失时拒绝提交，不会自动改用 clipboardText（实际源码 1249–1252 行）。插件停用后不能修改宿主草稿；若旧 chip 因此无法发送，用户删除该 chip，再粘贴从「引用」入口复制的普通 token。适配器自身异常与无原生服务都有降级测试；停用/重启草稿的实际行为列为真机待验，不承诺透明恢复。
