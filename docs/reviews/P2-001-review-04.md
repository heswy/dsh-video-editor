# P2-001 最终收口：R4-b 复审

日期：2026-10-17。提交 `5b9032b`，父提交 `6c4b2e9`。执行者：程序员 1（新 DeepSeek 会话接手原 Codex 引擎工作树）。结论：**R4-b 关闭；P2-001 在受控本机工程范围内验收通过。** 无新增阻塞项。

## 独立证据

主会话阅读 6 文件差异，确认只改 fixture/测试/README/任务及研究记录；`packages/video-engine-client/src` 无变化，DSH 根代码、worker/spike 未变。开发树检查前后跟踪文件干净。

- `/usr/local/bin/node --test --test-concurrency=1 packages/video-engine-client/test/*.test.mjs`：Node 22.15.0，10/10，通过，约 5.68 秒。
- `/opt/homebrew/opt/node@24/bin/node --test --test-concurrency=1 packages/video-engine-client/test/*.test.mjs`：Node 24.14.0，10/10，通过，约 6.37 秒。

两组均包括真实 worker doctor/open、SDK 编辑冲突、PNG 抽帧及异步 render/cancel；这里不是通过 client 完整导出一个新 MP4 的验收，完整 H.264 成功产物在此前 worker 阶段已验过。程序员 1 额外报告的各版本连续 10 次与删除 error 监听的反向变异结果属于开发证据，本轮主会话不重复或冒称独立执行。

## 修复评估

子进程持有 edit/frame/render 请求不应答，收到有序 sync 后确认三项已收到，再释放 stdin handle/关闭 fd 0 并 ack。父进程等 ack 后用 inspect 写入触发 EPIPE，不再用固定 sleep 猜测故障时间。正式断言分别覆盖：

1. 已发送、未响应的 pending 以 E_TRANSPORT 结算，edit uncertain=true，frame/render jobUnknown=true，inspect 不带写标记。
2. 故障后新请求在准入前以 E_CLIENT_STATE 拒绝，不进 pending、不伪造不确定性、不重放。
3. pending 清零、直属 worker 已退出、隔离父进程正常退出、无未处理事件、无关 sentinel 存活；journal 为 doctor/edit/frame/render/sync 各一次，证明探测及被拒请求未重复送达。

程序员 1 进一步定位旧 Node 22 fixture 直接 closeSync(0) 会触发 libuv 的 SIGABRT，这补充了 review-03 中仅确认的时序差异：旧失败路径是 fixture 先退出后拒绝准入，并非真实 EPIPE。新 fixture 先销毁 stdin 流后关闭描述符；两个运行时的独立测试均通过。该旧 SIGABRT 根因取自程序员 1 调查记录，主会话未再次诱发崩溃取证。

## 接入边界

通过范围为 macOS 本机显式 Node 小版本与可信 fixture 的父进程通信库；未在 DSH Host 内启动、未验证依赖分发或任意生成代码隔离。强制退出只针对 client 的直属 worker，不据此宣称 detached Chromium/FFmpeg 的异常清理已解决。生产文件固定到 6c4b2e9，包含测试与记录的交付固定到 5b9032b。

程序员 2 继续 P2-002-A，交回当前 0.2.1 Host 契约后，由主会话决定接线 API 与 P2-002-B 实现边界。此时无需程序员 1 再改通信生产代码，也不自动合并功能分支、安装或 push。
