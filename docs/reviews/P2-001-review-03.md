# P2-001 R4 复审：生产修复通过，回归时序需收敛

日期：2026-10-17。提交 `6c4b2e9`。主会话未改引擎工作树跟踪文件。

## 结论

R4 的未处理 Socket error 生产缺陷已修复：流 error 有独立处理，takePending 统一结算，失败停止准入、传播 E_TRANSPORT 与不确定性标记并执行有界 dispose。**Node 24 受控本机路径可接受；包声明 Node >=22 的测试验收尚有一项待收敛。** 不将测试不稳定等同于原未处理 EPIPE 仍存在，也不宣称默认 npm test 已全通过。

## 独立验证

- `/opt/homebrew/opt/node@24/bin/node --test --test-concurrency=1 packages/video-engine-client/test/*.test.mjs`：10/10，通过，约 8.64 秒，含真实 worker PNG、冲突和取消。
- 引擎目录的默认 `npm test --prefix packages/video-engine-client` 本轮使用 Node 22.15.0：9/10，新增断管隔离回归失败。
- 显式 `/usr/local/bin/node --test --test-name-pattern='isolated parent handles' .../protocol.test.mjs` 再次同样失败；Node 24 的相同单项通过。

## R4-b [P2] 测试把未准入请求也强制视为已发送

位置：`packages/video-engine-client/test/fixtures/epipe-parent.mjs:20–33`、`stdin-close-worker.mjs` 及外层协议测试。

通过 /tmp 只读派生的诊断父进程打印 Promise.allSettled，未改正式文件。Node 22 三个结果都是 `{code:'E_CLIENT_STATE',uncertain:false,jobUnknown:false}`；Node 24 则是三个 E_TRANSPORT，已发 edit 的 uncertain=true、frame/render 的 jobUnknown=true。两条路径均不是未处理 Socket error，错误可捕获。

原因：用固定 100ms sleep 等待子进程关 stdin，再并发发请求，不能保证故障何时被客户端观察。故障先完成则 client 已停止准入，之后未发送的请求应返回 E_CLIENT_STATE，无须标记写入未知；请求先进入 pending 才应 E_TRANSPORT 并保留标记。现有测试只允许后一种时序，因此会把合理的提前拒绝当成生产失败。

请修复正式回归的同步方式，**不要把所有准入失败硬改成 E_TRANSPORT/uncertain=true 来讨好断言**。建议将两个行为分开：

1. 子进程以可靠同步条件确认目标 edit/frame/render 已进入处理但尚未响应，再触发断管，使 pending 故障路径可确定验证；隔离父进程正常退出，标记正确、pending=0、自有子进程退出、sentinel 存活。
2. 故障已观察后再发新请求，应被拒绝准入，无重放，不伪造已发送；不要求这些请求都拿到传输中断码。

保持原 P2-001 白名单，优先只改故障 fixture/测试/研究回应；若发现生产差异，给出证据再修。显式 Node 22 与 24 跑协议相关回归；Node 24 仍须保留真实 worker 链通过证据，不需要重复整个引擎渲染矩阵。反复跑偶然通过不算修复，禁止仅延长 sleep。

## 后续

完成后再做 P2-001 最终测试收口。DSH 可独立做 P2-002-A 的 0.2.1 Host 接入契约调查；调查不执行/安装未最终收口的新功能。未接入 DSH、不 push/merge。
