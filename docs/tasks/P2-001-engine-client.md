# P2-001：供 Host 使用的独立 worker 通信包

执行：原 Codex 引擎会话，继续自行管理当前工作树/分支。功能基线 `3b5f6de`（P1-002 已验收）；先读 DEVELOPMENT、ADR-0001、P1-002-review-02 与 worker README。通过 git show 从协调分支读取本指南和评审，自行导入这两份文件；不合并协调分支或同步整个工作树。

## 范围

新增 `packages/video-engine-client/**`（独立 package、源码、测试、README）；可追加本任务记录与 `docs/research/P2-001-*.md`。不改根 Host/Client/manifest/锁、P0、worker/spike、全局规范与状态。确需修改 worker 协议时先记录问题交评审，不跨边界顺手调整。不安装/启用 DSH、不修改 profile、不 push/merge。主会话不接管功能实现。

## 目标

实现可从将来 DSH Host 调用的纯 Node 父进程库；以实际 worker 验证 doctor→open→inspect→edit→frame/render→status/cancel→close→dispose。独立包与 DSH 无依赖，导入不启动进程。沿用 v1 JSONL 与受控 fixture，不新增任意用户路径、外部 URL 或生成代码执行能力。

- 调用方显式提供 Node executable、worker entry、可信 registry 及启动/请求/关闭期限；参数数组 spawn，无 shell，不把本机默认路径变成分发契约。父层不复制工程内容或自行写 HTML，worker 仍为唯一内容写入口。
- 持续消费 stdout，按唯一 id 对应响应；支持乱序响应、分段与多行输入，限制单行和待处理请求数，stderr 有界。校验 v/id/ok/error 等 envelope，畸形、超长、无响应/启动失败与进程退出均有确定的结构化失败。任务状态来自 worker，父层不伪造成功或缓存第二份 revision 真相。
- 区分请求超时、作业 deadline、取消、close、整个 client dispose。请求超时不能被描述为编辑未执行；不自动重试 edit/render，也不自动重启后重放请求。丢失响应的写请求返回明确的结果不确定信息，调用方可重新 inspect 协调。
- render/frame 返回 jobId 后不阻塞其它调用。保留 expectedRevision/operationId 原语与 E_PROJECT_CLOSING，不因 UI 连点把旧错误变成成功。
- dispose 幂等：停止新请求，优先 shutdown 并等退出，既有 pending 全部落定，移除监听/定时器；无响应时使用有界退出策略，只针对本 client 拥有的进程。不能用全局进程名 kill 或把杀 worker PID 等同于 detached Chrome 已清零；强制退出/孤儿清理能力的实际边界须明确报告。不要求本轮发明 OS 沙箱/系统守护进程。
- 对进程异常退出不静默恢复；向全部 pending 传播失败并报告可诊断状态。不同 client 不串请求、取消/close 不影响其它工程。API 返回可供 Host/UI/Tool 统一消费的数据和错误，不引用 DSH session 或浏览器 DOM。

## 验证与交付

1. 真实 worker：正常往返、revision 冲突、异步作业期间其它调用响应、取消与关闭、重复 dispose 和退出后无悬挂请求；至少一个真实 PNG/MP4 验证已有引擎链通过本包可调用，无需重做全套视频兼容验收。
2. 可控协议子进程故障测试：拆包/粘包/乱序、畸形/超长、请求超时后迟到响应、提前退出、启动失败、stderr 上限与关闭期限。这些是协议故障测试，不能代替真实 worker 成功证据。
3. 明确取消或超时后的写入不确定性；无未处理 Promise rejection/事件监听泄漏，退出后 pending 清空，无关 sentinel 存活。
4. 无自动依赖升级或系统安装；测试/媒体局部忽略，不提交系统字体。返回提交、公共 API 与最小 Host 调用示例、测试命令与结果、进程清理边界和未验证项。

DSH 的 root Host 适配、connection.fetch/tools 与前端接入留后续任务；本轮不声称已经在 DSH 中运行。

## 开发记录

- 基线：`3b5f6de`；协调来源 `codex/project-foundation@17cf95716975e1f2d4ab7fcc5f721303295db91f`，只导入本指南和 P1-002-review-02。
- 实现：`packages/video-engine-client/**` 的纯 Node ESM `WorkerClient`/`WorkerClientError`，无 DSH 依赖或 import-time spawn。公共 API/最小 Host 示例见包 README。
- 验证：真实 worker 流程和受控协议故障测试均在本包 `npm test` 执行；R1–R3 修复后最终为 9/9（7.83 秒），限制见研究记录及交接。
- 限制：强制退出只针对本 client 的直接 worker，不能证明 detached Chrome/FFmpeg 已清理；DSH Host/UI/Tool 接线留后续任务。
- R1–R3：按字节处理 UTF-8，未确认 edit 保留 `uncertain:true`、丢失 frame/render jobId 标记 `jobUnknown:true`，dispose 清理 exit wait timer；新增跨字节、写后退出/坏帧和独立父进程自然退出回归。
- R4：为直属 worker 的 stdin/stdout/stderr 建立有生命周期的错误处理。断管以 `E_TRANSPORT` 只结算一次全部 pending，并对 edit 保留 `uncertain:true`、对 frame/render 保留 `jobUnknown:true`；随后以有界 dispose 仅清理直属 worker。新增纯 Node 隔离父进程回归：worker 在 doctor 后只关闭 stdin 但继续存活，并发 edit/frame/render 均可捕获传输错误、pending 清零、父进程正常退出且无关 sentinel 存活。最终 `npm test --prefix packages/video-engine-client` 为 10/10（本机约 6.8 秒）。
- R4-b：按评审 `P2-001-review-03` 修正断管回归同步，生产代码未改。定位到旧 fixture 的版本差异根因：Node 22.15.0 在 stdin libuv handle 存活时 `closeSync(0)` 触发 `uv__close` 断言并以 SIGABRT 退出，父进程固定 sleep 100ms 后已观察到进程退出，三个请求在准入前被 `E_CLIENT_STATE` 拒绝；Node 24 不崩，随后写 stdin 才得到 EPIPE，因此旧测试只在故障晚于请求的时序下通过，也从未在 Node 22 上真正覆盖 EPIPE。新同步方式：fixture worker 对 edit/frame/render 只记录不应答，父进程随后发送 `sync`（管道有序，确认三者已收到且未响应），worker 先 `process.stdin.destroy()` + `closeSync(0)` 再以 stdout ack `{held:3}`；父进程收到 ack 后写 inspect 探测，确定得到 EPIPE。回归分两段断言：已发送的 edit/frame/render/inspect 全部为 `E_TRANSPORT`（edit `uncertain:true`、frame/render `jobUnknown:true`、探测 inspect 无写标记），pending 归零；故障观察后新发 4 个请求以 `E_CLIENT_STATE`（stage `client`）拒绝准入、无标记、不进入 pending、不重放；worker 交付日志证明只收到 doctor/edit/frame/render/sync 各一次；隔离父进程退出码 0、直属 worker 已退出、sentinel 存活、无未处理 error。显式 Node 22.15.0 与 24.14.0 完整包测试均 10/10（约 6.08s / 6.40s，含真实 worker PNG/MP4 链），默认 `npm test`（Node 24.14.0）10/10（约 6.54s）；隔离回归两版本各连跑 10 次全过；删除 stdin error 监听的反向变异使新回归在两版本均以 `Unhandled 'error' event` 失败，仍覆盖 R4 原缺陷。
