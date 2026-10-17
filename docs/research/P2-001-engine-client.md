# P2-001 独立 worker 父进程通信包

2026-10-17。基线 `3b5f6de`；本次仅新增 `packages/video-engine-client/**`，并通过 git show 导入 P2-001 指南与 P1-002 R1 复审。未修改 worker、DSH 根插件、P0、全局状态或配置；未安装/启用 DSH、push 或 merge。

`WorkerClient` 是零依赖 ESM 父进程库。构造/导入没有副作用，`start()` 使用调用方显式提供的 Node executable、worker entry、registry 以 argv spawn（`shell:false`）。API 转发 v1 的 doctor/open/inspect/edit/frame/render/status/cancel/close；worker 保持唯一工程内容写入口，客户端不复制 HTML 或 revision。

传输层生成唯一 id，持续读取 stdout，处理分段/粘包/乱序响应；严格校验 envelope 与行长，限制 pending 与 stderr 保留尾部。worker 错误原样结构化传播。超时/写入失败的 edit 以 `WorkerClientError.uncertain=true` 表达结果未知，不自动重试或重放；迟到响应被隔离。exit 向 pending 广播 `E_PROCESS_EXIT`。

dispose 立即阻止新请求，优先 shutdown；无响应时只终止本 client 的直接 worker PID 并有 TERM/KILL 期限。它不宣称能清理 detached 浏览器子树，不能取代 worker 自己的 POSIX 进程监督或未来 Host 的崩溃恢复。

测试包括真实 worker 的 doctor/open/edit 冲突/frame PNG/render 异步期间 inspect/cancel/close/repeated dispose，以及受控假 worker 的分段+粘包+乱序、畸形 envelope、超长行、edit 超时迟到响应、提前退出、stderr 上限、无响应 shutdown 与无效 executable。最终 `npm test --prefix packages/video-engine-client` 为 6/6（17.81 秒）。
