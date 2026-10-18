# P2-001 独立 worker 父进程通信包

2026-10-17。基线 `3b5f6de`；本次仅新增 `packages/video-engine-client/**`，并通过 git show 导入 P2-001 指南与 P1-002 R1 复审。未修改 worker、DSH 根插件、P0、全局状态或配置；未安装/启用 DSH、push 或 merge。

`WorkerClient` 是零依赖 ESM 父进程库。构造/导入没有副作用，`start()` 使用调用方显式提供的 Node executable、worker entry、registry 以 argv spawn（`shell:false`）。API 转发 v1 的 doctor/open/inspect/edit/frame/render/status/cancel/close；worker 保持唯一工程内容写入口，客户端不复制 HTML 或 revision。

传输层生成唯一 id，持续读取 stdout，处理分段/粘包/乱序响应；严格校验 envelope 与行长，限制 pending 与 stderr 保留尾部。worker 错误原样结构化传播。超时/写入失败的 edit 以 `WorkerClientError.uncertain=true` 表达结果未知，不自动重试或重放；迟到响应被隔离。exit 向 pending 广播 `E_PROCESS_EXIT`。

dispose 立即阻止新请求，优先 shutdown；无响应时只终止本 client 的直接 worker PID 并有 TERM/KILL 期限。它不宣称能清理 detached 浏览器子树，不能取代 worker 自己的 POSIX 进程监督或未来 Host 的崩溃恢复。

测试包括真实 worker 的 doctor/open/edit 冲突/frame PNG/render 异步期间 inspect/cancel/close/repeated dispose，以及受控假 worker 的分段+粘包+乱序、畸形 envelope、超长行、edit 超时迟到响应、提前退出、stderr 上限、无响应 shutdown 与无效 executable。最终 `npm test --prefix packages/video-engine-client` 为 6/6（17.81 秒）。

## P2-001 首审 R1–R3 回应

评审 `f9d07e0` 的三项问题均以测试先行修复。stdout 现在保留 Buffer、按 LF 原始字节组行后才 UTF-8 解码；stderr 的尾部也按原始字节限制。新增中文和 emoji 在字符中间拆包的真实 pipe 回归，精确返回 `你好😀`。

每个 pending 保存 method。未收到可靠响应的 edit 在 worker exit、协议坏帧、超时和 stdin 写入失败均为 `uncertain:true`；frame/render 在相同传输失败中给出 `jobUnknown:true`，明确不代表作业没有启动也无法在没有 jobId 时恢复。新增“edit 后退出/坏帧”回归验证 pending 清零。

dispose 的 exit wait 改为在 exit 先到时 clearTimeout。独立父进程回归将 shutdown deadline 设为 1500ms，正常 shutdown 在 800ms 内自然退出；无响应 worker 的 TERM/KILL 有界回归保留。最终 `npm test --prefix packages/video-engine-client` 为 9/9（7.83 秒）。

## P2-001 第二轮 R4 回应

评审 `667e86e` 发现 ChildProcess 的 error 监听不覆盖其 stdin Socket 的 error：写入回调和 Socket 的 `EPIPE` 事件会并发抵达，若后者没有生命周期监听，父进程会以未处理事件退出。客户端现在为其拥有的 stdin/stdout/stderr 都注册传播故障的监听，并以 `takePending` 统一删除、清理 timer 和结算 pending，所以响应、超时、写入回调、流 error 与进程退出之间的竞态只会结算一次。

任何流故障都会停止接收请求，将现有 pending 以 `E_TRANSPORT`/`stage: "transport"` 结算：edit 保留 `uncertain:true`，未获得 jobId 的 frame/render 保留 `jobUnknown:true`，没有重试或重放。客户端发送 TERM 并启动既有的有界 dispose；它只作用于自己 spawn 的直接 worker。退出时会解除流与子进程监听。

新增纯 Node worker fixture 在正常 doctor 应答后关闭 fd 0、保持存活一秒；隔离父进程等待断管后并发发出 edit/frame/render。回归验证三项均捕获 `E_TRANSPORT`、标记正确、pending 为零、dispose 后正常退出且 stderr 无未处理 error；外层 sentinel 仍存活。`npm test --prefix packages/video-engine-client` 最终 10/10（6.79 秒）。

## P2-001 第三轮 R4-b 回应

评审 `P2-001-review-03` 指出断管回归用固定 100ms sleep 等待子进程关闭 stdin 后再并发发请求，不能保证故障何时被客户端观察：故障先完成时 client 已停止准入，未发送的请求应返回 `E_CLIENT_STATE`，只有先进入 pending 的请求才应得到 `E_TRANSPORT` 并保留写不确定性。旧断言只接受后一种时序，会把合理的提前拒绝当成生产失败；评审明确要求分开验证两种行为，禁止把所有准入失败硬改成 `E_TRANSPORT/uncertain`。

本轮先定位到旧测试版本差异的直接根因（此前未知）：Node 22.15.0 在 stdin 的 libuv handle 仍存活时调用 `closeSync(0)` 会触发 `Assertion failed: (fd > STDERR_FILENO), function uv__close, file core.c, line 644.`，fixture 子进程在 start 后约 29ms 以 SIGABRT 退出。隔离父进程 sleep 100ms 后 client 已因进程退出进入 failed，三个请求因此在准入前被拒绝，所以旧回归在 Node 22 上从未真正走到 stdin EPIPE；Node 24 允许 `closeSync(0)` 并保持存活，之后写 stdin 才得到 EPIPE，旧断言因此只在 Node 24 通过。这也解释了评审在 Node 22 看到的三个 `E_CLIENT_STATE`。

生产代码未改：`request()` 本来就在 pending 登记后才写 stdin，流故障统一以 `E_TRANSPORT` 结算 pending；故障后状态不是 running，新请求在准入阶段以 `E_CLIENT_STATE` 拒绝，不会进入 pending 或写 stdin。没有发现需要修的生产差异，也没有按评审禁令伪造传输错误。修复只涉及故障 fixture 与外层回归断言，并同步更新任务记录、研究记录和 README 一句行为说明。

新同步方式（可靠条件，不用 sleep）：

1. fixture worker 对 edit/frame/render 只记录、不应答；父进程随后发送 `sync`。管道有序，worker 处理 `sync` 时即确定三个目标请求已收到且尚未响应；它先 `process.stdin.destroy()` 再 `closeSync(0)`（规避 Node 22 的 libuv 断言），随后以 stdout ack `{held:3}` 回复 `sync`。父进程收到 ack 后写 inspect 探测：此时子进程 stdin 读端已关闭，该写入确定得到 EPIPE，pending 故障路径可确定验证。
2. 已发送路径（回归断言）：edit/frame/render/探测 inspect 四项都在 pending 中结算为 `E_TRANSPORT`；edit 保留 `uncertain:true`，未获得 jobId 的 frame/render 保留 `jobUnknown:true`，探测 inspect 无写标记；pending 归零，失败后状态为 failed 或 disposed。
3. 未准入路径（回归断言）：故障观察后新发 edit/frame/render/inspect 均在准入前以 `E_CLIENT_STATE`（stage `client`）拒绝，无 `uncertain`/`jobUnknown` 标记、不进入 pending、不重放；worker 交付日志为 doctor/edit/frame/render/sync 各一次，证明没有重复发送。
4. 隔离父进程退出码 0、client 直属 worker 已退出、外层 sentinel 存活、stderr 无 `Unhandled 'error' event`。

验证：显式 `/usr/local/bin/node`（v22.15.0）与 `/opt/homebrew/opt/node@24/bin/node`（v24.14.0）运行 `--test --test-concurrency=1 test/protocol.test.mjs test/real.test.mjs` 均 10/10（约 6.08 秒 / 6.40 秒，含真实 worker doctor/open、revision 冲突、PNG frame 与 MP4 render/cancel 链）；默认 `npm test --prefix packages/video-engine-client`（PATH 为 Node 24.14.0）10/10（约 6.54 秒）；隔离回归在 Node 22 与 24 各连续运行 10 次，全部通过。反向变异（/tmp 副本删除 stdin error 监听，不改正式源码）使新回归在两版本均以 `Unhandled 'error' event` 失败，确认它仍覆盖 R4 原缺陷而不只是"偶然通过"。

限制：Node 22 与 24 证据来自本机显式路径，不代表其它小版本；仍只在受控 fixture 范围验证，未接入 DSH、未安装、未 push/merge；强制退出仍只针对本 client 的直接 worker，不证明 detached Chrome/FFmpeg 已清理。
