# P1-002 R1 复审

日期：2026-10-17。提交：`3b5f6de`，相对 `b59dbbb`。结论：**R1 关闭；P1-002 按受控本机 fixture 范围验收通过。** 未合并、push 或安装进 DSH。

## 代码与验证

主会话实读差异：close 首次等待前同步设置工程 closing；共享关闭 Promise 合并重复 close；新 open/inspect/edit/frame/render 在准入时拒绝；Jobs.start 再检查状态。旧任务排空后在同一工程队列删除 handle、置 closed，之后允许 reopen。status/cancel 保持可用，未引入等待 render 完成才处理其它请求的全局队列。

主会话独立复跑：

- `npm test --prefix packages/video-engine-worker`：7/7，通过，约 2.76 秒。
- `node --test --test-name-pattern='close gates' packages/video-engine-worker/test/jobs.integration.mjs`：新增真实回归 1/1，通过，约 5.71 秒。

新增用例使用官方 CLI，覆盖运行中 render + close + 重复 close、并发 render/frame/edit/open 的拒绝，旧 render cancelled/cleaned/survivors=[]，仅保留关闭前成功 PNG、无关 sentinel 存活、同 revision reopen 后再次关闭。inspect 的 closing 拒绝已核对实现；新增用例未单列该请求，不能表述为全部方法均逐一实测。

本轮只复跑受影响新增真实回归；此前主会话已独立跑通的两组真实作业不重复。开发方报告最新完整真实作业 3/3（55.79 秒）；此数字为开发证据，与主会话本轮 7+1 区分。原首审报告保留不改。新生成 close-gate.json 属于忽略的复测证据，未改引擎跟踪文件。

## 下一步与限制

进入 P2 分工：原引擎会话先做独立父进程通信包 P2-001，准备可被 Host 调用的 API；不改根插件。DSH 继续 P0-005。真正的 Cordis Host 服务、UI/Tool接线、依赖分发与安装另行定义和验收，不以父进程包完成代替 DSH 集成。

受控 fixture 限制继续有效：不可信代码执行隔离、跨重启幂等/恢复、SIGKILL/断电后清理、音轨/多 Scene、跨平台分发仍未验证。
