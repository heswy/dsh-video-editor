# ADR-0001：视频引擎运行于独立 Node worker

状态：Accepted（实施路线；尚未通过 DSH 接入验收）。日期：2026-10-17。决定者：主会话，依据 P1-001 实测。

## 背景

目标宿主 Desktop 0.2.0-rc.2 的 Slot/Host 插件与 HyperFrames 的 Node/ESM、SDK、浏览器、FFmpeg 依赖和长任务生命周期不同。P1 已证明固定 HyperFrames 0.8.167 能在独立 Node 24 进程完成受控 Scene 编辑和导出，未证明依赖可直接放入 DSH Host 图，也未证明任何不可信代码隔离。

## 决定

采用独立 Node worker，由未来 DSH Host 适配器拥有并启动；UI 与 Tool 调用同一个 Host 业务入口，Host 再经有版本的 JSON Lines stdio 契约调用 worker。

- Host 拥有工程注册/权限、可见任务、生命周期及将来的 UI/Tool 共享入口；worker 拥有引擎依赖、原生工程编辑、读回与渲染。每个工程只有一个写入序列，不能 Host 与 worker 各自落一份内容真相。
- 先实现受控本地 fixture，不接任意用户路径、HTML/JS 或外部 URL。任意生成代码执行的隔离另立任务；独立进程不是安全沙箱。
- stdout 仅传有 requestId 的协议帧，日志走 stderr 且有上限；render 异步返回 jobId，取消独立可处理。
- 内容 revision 包括入口与声明本地资产清单的路径/字节，排除历史/缓存/输出；渲染绑定同一 revision 快照，未验证成功不发布结果。
- P1-002 定义并实测 worker；P2 才验证真实 DSH 启动/通信/卸载。不得将系统 Node 路径写死成所有用户的安装契约。

## 替代与代价

直接在 Host import HyperFrames 减少 IPC，但耦合宿主依赖与故障；本轮不采用。只启动任意 CLI 字符串容易快速演示，却缺少共享修订、取消与结构化错误，因此仅留在 spike。

独立 worker 增加协议、分发及 Node/浏览器定位成本；会增加启动与进程恢复问题，需要真宿主测试。优点是引擎版本和长任务可独立验证，DSH 与引擎团队能并行，避免根 Client 与 SDK 依赖混合。

## 证据

P1 分支提交 `c779b94` / `e88615f` 的 `docs/research/P1-001-engine-spike.md`；联合评审 `../reviews/P0-P1-2026-10-17-joint-review.md`；实施任务 `../tasks/P1-002-engine-worker.md`。引用分支提交，不依赖临时目录作为唯一依据。
