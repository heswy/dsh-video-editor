# P2-001 父进程通信包首审

日期：2026-10-17。提交 `1f45f15`。结论：**需修复 R1–R3 后复审**，暂不进入 DSH Host 接入。主会话只读并验证，未改引擎工作树跟踪文件。

## 已验证

独立 `npm test --prefix packages/video-engine-client`：6/6，通过，约 20.24 秒；包含真实 worker PNG、revision 冲突与异步取消链。显式 spawn、纯 Node 包、内容写入仍由 worker 唯一负责，符合 P2-001 的架构与文件边界。定向故障复现使用主会话自建 /tmp 受控子进程，结束后已清理，未操作 DSH 或用户工程。

## R1 [P2，阻塞接入] 按数据块直接 UTF-8 解码破坏中文

`packages/video-engine-client/src/index.mjs:92–93` 每个 data chunk 单独 `toString('utf8')`。stdio 的字节边界可以落在一个中文字符内部；累积已损坏的字符串不能恢复原字节。

真实 pipe 复现：子进程响应 result.text='你好'，在「你」的第一个 UTF-8 字节之后分两次 write，相隔 40ms。client.start() 正常返回，但 text 为 **「���好」**。协议仍能解析，内容被静默损坏。这会破坏 inspect 的中文和结构化错误。

要求按字节组行后解码，或使用正确的增量 UTF-8 解码；行长限制按原始字节执行，处理 EOF 未完成字符/半行。补中文、emoji 跨字节拆分与粘包/多行的精确字符串回归。stderr 同样注意多字节尾截断和原始字节上限，不能引入超过配置上限的 replacement bytes。

## R2 [P2，阻塞接入] 进程退出/协议失败丢失编辑结果不确定性

`src/index.mjs:169–189`：protocolFailure/onExit 广播错误时没有请求方法信息，WorkerClientError 默认 uncertain=false。仅 timeout/write callback 分支标记 edit 不足以涵盖“已经保存但响应没到”的情形。

真实 pipe 复现：doctor 正常应答，收到 edit 后子进程不发响应并退出。调用方收到 `{code:'E_PROCESS_EXIT',uncertain:false}`。此时父层无法证明 edit 尚未执行；同理，编辑落盘后坏响应/断管也不能被判断为确定未写入。

要求 pending 保存方法/必要发送阶段，所有未收到可靠响应的 edit 传输失败均保留 uncertain=true，包含退出、协议异常和主动 teardown 导致的 pending 失败；尚未准入/发送的失败可明确区分。不自动重试、不重放。对 render/frame 等可能已创建作业但 jobId 丢失的情况明确语义和恢复限制，不假称任务未开始。补“先写可观察标记，再退出/返回坏帧”的正式故障回归，并验证 pending 清零与无未处理拒绝。

## R3 [P2] dispose 的退出等待定时器未释放

`src/index.mjs:289–293` 每次 Promise.race 创建 setTimeout，但 worker 先退出时没有 clearTimeout，仍有引用的 timer 会拖住父进程退出，违背本任务 dispose 后清理监听/定时器的约束。

独立父进程复现：响应 shutdown 后立即退出的受控 worker，shutdownTimeoutMs=1500。父层 **58ms 已完成 dispose**，但自身进程直到 **1568ms 才退出**。现有真实测试两项各自配置 10 秒等待，也产生不必要的事件循环驻留。

要求 settle 后无论哪条分支胜出都清理对应 timer；统一核查 dispose/退出的 pending、监听与 timer 清理，不要只把所有 timer unref 来掩盖未落定请求。增加独立父进程自然退出回归：正常 shutdown 不应等待配置的整个退出期限；保留无响应 worker 的有界 TERM/KILL 行为。

## 交接

沿用 P2-001 白名单，原会话实现修复，追加逐项回应与正式测试，不修改本评审原文。不改 worker、DSH 根代码、全局规范；不安装、不 push。已有成功测试不能当作上述边界覆盖证据。真实 DSH 启动/安装、任意代码隔离仍未验证。
