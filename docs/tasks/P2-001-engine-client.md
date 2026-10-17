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

开发记录：待执行会话填写。

## 主会话最终验收（2026-10-17）

程序员 1 交付 `5b9032b`，R4-b 正式同步回归与 Node 22/24 独立完整包测试均 10/10。R1–R4-b 全部收口，受控本机范围验收通过；见 [最终评审](../reviews/P2-001-review-04.md)。实际 DSH Host 接入、分发与任意代码隔离仍未完成。
