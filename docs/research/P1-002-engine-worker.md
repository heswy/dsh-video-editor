# P1-002 独立视频引擎 worker：开发交付

2026-10-17。基于用户确认的 P1-001 验收继续实现，当前为开发会话证据，待主会话独立复审。

## 基线和边界

当前树 `/Users/orange/.codex/worktrees/b4bf/dsh-video-editor`、分支 `codex/p1-engine-spike-b4bf`，开工 HEAD `e88615f`。使用 git show 从 `codex/project-foundation` 只导入 P1-002 任务指南和 ADR-0001，没有 merge/rebase/cherry-pick 协调分支。未切换目录、未再建 worktree。

实现仅在 `packages/video-engine-worker/**`，另外新增本文、导入两份指南并填写本任务开发记录。原 spike、DSH 根 Client/Host/manifest/package/锁、P0、STATUS、DEVELOPMENT 均未改；不安装或改 DSH profile，不 push/merge 或发送跨会话消息。

## 实现

独立 Node/ESM 进程，stdio JSON Lines v1；协议 schema、方法表、限制和父进程启动命令见包 README 和 protocol.schema.json。doctor/open/inspect/edit/frame/render/status/cancel/close/shutdown 均有真实后端。无 worker sessionId；请求使用 projectId，作业使用 jobId。stdout 只输出带 id 的协议帧，错误为 code/message/stage；原始 CLI 输出不转发，内部捕获尾部64KiB，worker stderr 总计16KiB且仅写固定阶段说明。

- 注册：可信父进程启动 registry 指定 root/projects/outputRoot；请求不能传 path/URL。manifest 只接受 index.html 和明确声明的相对本地资产，真实路径检查防止符号链接越界。这里只运行 P1 自有 fixture，不接受任意代码。
- 修订：入口和声明资产的排序路径/字节数/SHA 清单，再 SHA-256；排除历史/缓存/产物。SDK duration=null 的差异用真实 data-duration 适配。inspect 返回当前真实内容和 capabilities。
- 编辑：工程级队列；expectedRevision、operationId 必需。重新读取当前文件比较 revision，并在持久化前再次比较；SDK batch typed text/timing，监听 persist:error、flush、磁盘 readback，全部成功才返回新 revision。批次 timing 顺序累计校验。成功 operationId 的规范化请求在本 worker 内幂等，不同内容拒绝；JSON 对象键顺序无关，ops 数组顺序有意义。
- 作业：frame/render 立即返回 queued job，后台在工程队列中取得与 revision 对应的字节快照。读请求和 cancel 不等渲染完成。官方 HyperFrames CLI 运行在私有快照；真实 ffprobe 校验也是可取消的独立子进程。成功 MP4 必须通过 H.264/尺寸/帧率/实际帧数/时长验证，PNG 校验签名和尺寸，返回带 projectId/revision/jobId/hash/工具版本的 artifact。
- 清理：取消先 ack cancelling，确认自身进程退出和私有目录移除后 cancelled；有 timed_out。跟踪 detached Chromium/helper、CLI、FFmpeg/ffprobe，核对 PID/启动时间/命令，只发信号给本任务拥有进程，不按全局进程名 kill。close、shutdown、stdin EOF 和 SIGINT/SIGTERM 排空任务/写队列。成功产物用独立 UUID 名；在最终清理期间收到取消会撤回该作业唯一的产物，状态接口在 succeeded 前不公开 artifact，失败/取消不替换已有成功文件。

## 安装与工具

复用 P1-001 固定依赖，不追新：hyperframes、SDK/core/parsers 0.8.167，GSAP 3.15.0，puppeteer-core 25.14.0；独立 package-lock 完整锁定传递依赖。沿用已审查的安装脚本清单（仅 esbuild 0.25.12 有 install）；本包 npm ci 始终 --ignore-scripts、cache 指向本树包 .cache/npm，未运行 postinstall，无全局安装。

实际环境 Node 24.14.0、npm 11.9.0、Chrome 155.0.8059.79、FFmpeg/ffprobe 8.0.1，macOS arm64。doctor 从实际包元数据和可执行文件读取版本，作业沿用这些元数据。父进程选择 Node executable，worker 子进程沿用 process.execPath；Chrome 可通过 registry 显式指定。默认本机路径不是所有机器的分发契约。系统 STHeiti Medium.ttc 仅复制到忽略的 artifacts 目录，不入 Git；字体 SHA 沿用 P1 检查结果。

```sh
npm ci --prefix packages/video-engine-worker --ignore-scripts --no-audit --no-fund --cache "$PWD/packages/video-engine-worker/.cache/npm"
npm run prepare-fixture --prefix packages/video-engine-worker
node packages/video-engine-worker/src/worker.mjs --registry packages/video-engine-worker/artifacts/registry.json
npm test --prefix packages/video-engine-worker
npm run test:real --prefix packages/video-engine-worker
```

## 验证事实

测试实际启动独立 worker，通过 stdio 请求真实 SDK/CLI，没有用内存 mock 替代后端。

- 7 项协议/内容行为测试：竞争 edits 只能一个成功；外部入口修改和资产变化使旧 expectedRevision 冲突且不覆盖；SDK 写回后 close/open 内容仍在；相同 operationId 返回原结果、不同内容拒绝、对象键序变化不影响幂等；真实目录无写权限产生 E_PERSIST 且入口未改；参数/时间上下界、超长输入、超大输出、坏 JSON、版本、未知方法、重复 id；项目资产/入口符号链接逃逸拒绝且响应不暴露目标路径。另验证非 index 入口拒绝、组合 timing 越界拒绝且不写入。
- 真实作业组1：frame PNG 和 H.264 render 成功；render 达 running 后经 SDK 改标题，再破坏 live GSAP 文件，旧 revision 的私有快照仍导出正确视频。成功结果保持源 revision；真实 ffprobe 返回1280×720、30/1、150实际帧、5秒。输出 stdout 每行均能解析为 v1 协议，stderr 有界。额外 queued cancel 与失败 frame 不覆盖已有成功 MP4。
- 真实作业组2：进入 streaming capture 后取消；CLI 超时；capture 期间关闭父进程 stdin、shutdown、SIGTERM。cancel ack 单独设1500ms响应上限；取消幂等，终态须 cleaned=true/survivors=[]，临时目录消失，外部 sentinel 进程存活。
- 所有帧/视频来自官方引擎。本 worker 的 CLI 实测仍为 screenshot/software GPU 路径，不把文档中的 BeginFrame 误当本轮实测捕获模式。

最终完整复跑为 `npm test` 7/7（3.34s）和 `npm run test:real` 2/2（36.75s）。后者产出
MP4 SHA-256 `86a8ed261e76283da602de17e1e2aec8f61a7398d816c8bd160bef73d658a863`，PNG SHA-256
`efca929677830434624a262bc13b2f6e1dd39af70619e3455c6753ac079441db`；独立 ffprobe 再核对为
H.264、1280×720、30/1、150 帧、5.000 秒。由 MP4 解码的 2.5 秒预览也已目视核对。

测试先红后绿：最初缺 worker 导致行为失败；后续专门复现非 index 采样分歧、组合 timing 越界、对象键序幂等失败，再修正。最新完整测试输出及真实作业 JSON 复制到包 evidence；不是仅用静态字符串或源码镜像测试通过。

## R1 首审回应：关闭工程的准入与排空

首审提交 `f7470b7` 的 R1 已在本工作树按其真实 worker 场景复现：此前 `close` 在首次等待 `jobs.drain()` 前没有工程关闭状态，新 render 可以在 handle 删除前进入 jobs map，进而在 close 返回后继续发布。根因是生命周期准入没有与 close 的同步前段绑定，而不是 CLI 或进程清理失败。

修复新增每个 projectId 的 `open` / `closing` / `closed` 生命周期。`close` 在第一次 await 前同步设为 closing；新的 open、inspect、edit、frame、render 立即得到 `E_PROJECT_CLOSING`，status/cancel 仍能观察和管理旧 job。首次 close 创建本次排空承诺，重复 close 共用它；旧编辑按既有工程队列完成，旧 frame/render 由 drain 取消，随后才删除 handle 并置 closed。只有 close 成功后 open 才能开启新的生命周期。作业入口也再次检查工程状态，防止未来调用方绕过 worker 路由。

正式真实回归 `close gates a project lifecycle before draining and permits reopen only after completion` 先在修复前稳定失败：第二个 render 返回 `ok:true` / `queued`。修复后完整复跑通过，测试先等待官方 CLI render 进入 running，再在同一 stdin turn 发 close、重复 close、render/frame/edit/open；四个新请求都为 `E_PROJECT_CLOSING`。close 返回后原 render 是 `cancelled`、`cleaned:true`、`survivors:[]`，输出目录仅保留 close 前成功的真实 PNG，无关 Node sentinel 仍存活；reopen 读取相同 revision 后可再次 close。最终格式化后完整复跑为协议 7/7（7.35 秒）与真实作业 3/3（55.79 秒）。

## 产物与复审

根目录 `/Users/orange/.codex/worktrees/b4bf/dsh-video-editor/packages/video-engine-worker/artifacts/`：

- worker.mp4：真实成功作业复制出的5秒 H.264；worker.png：同一初始 revision 的2.5秒 PNG。
- worker-mp4-at-2.5s.png：由真实 MP4 解码的目视核对帧。
- evidence/real-success.json：doctor、frame/render状态、revision、metadata、hash、编辑后 revision；cancel.json / timeout.json：真实终态与拥有进程清理信息。
- unit-tests.txt / real-tests.txt：最新父进程测试输出。
- registry.json、projects/demo/：prepare-fixture 建立的独立受控复审工程。

媒体、缓存、字体和 node_modules 均被局部忽略。可提交元数据、测试摘要、产物哈希在包 evidence；结果 commits 通过任务开发记录及交接消息给出。

## 实际限制与后续

这是受控 fixture worker，不是安全沙箱；真实路径检查不能对抗恶意 JS/符号链接竞态/逃逸进程。采样式进程跟踪不能替代 OS 隔离，SIGKILL/断电无法执行用户态 cleanup。仅本机 POSIX/macOS arm64 实测，Windows、跨平台字体/GPU一致性、音轨、多 Scene、长片、任意用户素材均未验证。

revision 覆盖声明资产，不能自动发现任意动态依赖。源码不配合的外部写者仍有最后检查到写入间的 TOCTOU 窗口，正式 Host 必须执行单一写入入口；本 worker 队列只保证自身请求串行。operationId 仅本进程内存记录；跨 worker 重启持久化幂等、故障恢复、OS 级父子进程监督和耐久工程注册留给后续。

SDK 保存失败的真实用例是目录不可写；若存储在入口写入后、历史追加时失败，当前会报 E_PERSIST，不承诺跨文件回滚。产物经过验证才发布，清理失败会转 failed；更全面的磁盘满/断电恢复尚未故障注入。CLI deadline 不含快照/文件哈希，后者通过文件和项目大小上限约束，不能当作任意大型工程 SLA。

协议父进程需持续消费 stdout；v1 有单条大小和总请求/作业数量上限，不提供持久队列、断点续传或不读管道时的无限缓冲保证。原始 CLI 诊断没有进入协议，当前对外错误只保留结构化 stage，后续可增加受权限控制的脱敏诊断包。

DSH Desktop 0.2.0-rc.2 的 worker 启动、Node/浏览器分发、Host 业务服务、UI/Tool共享调用、安装与卸载生命周期仍留给 P2，本次未在 DSH 中激活或安装。
