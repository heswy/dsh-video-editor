# P2-002-B：原生 Host 桥与受控示例编辑闭环

> Git 授权更新（2026-10-17）：用户已同意正常 feature 分支 push 与草稿 PR 流程；本指南旧“不 push”表述由该授权替代。见 DEVELOPMENT。安装/启停/重启、合并/发布边界不变。

执行：**程序员 2**，原 p0-mode-shell tree/分支；调查基线 `afcf57d`，保持已安装 0.1.3。先读最新 DEVELOPMENT、ADR-0002、P2-002-review-01 与设计 v0.2。记录收到指南的提交及实际 HEAD。

本轮放行**实现、本地验证、准备固定开发 staging**；不安装/替换/启停、不重启、不改 profile、不 push/merge。程序员 1 并行 P2-003，根插件由你独占；packages/video-engine-* 与 spikes 不改。最终 staging 等主会话复审确定 P2-003 提交后再固定；不必等待即可实现 Host/Client 与契约测试。

## 1. 文件范围与架构

允许根 index.js、client.js、package.json、cordis.patch.yml（只涉及自身配置/依赖）、locale/icon、README、host/** 新模块、scripts/**、相关本地测试、`docs/research/P2-002B-*.md`、本任务记录。不要改全局规则/决策、历史证据或引擎/client/根以外锁文件。

- 一个 plugin-local VideoBridge，HTTP 与 Tool 同一个 typed dispatcher、校验和错误映射。worker 唯一写内容；不加 Host revision/幂等结果缓存。
- 保留原生侧栏 id/order/label 和 main panel；保持 UI 卸载不影响工程与 worker。apply/导入不启动 worker；第一次明确的引擎业务请求单飞 start，插件停止先拒绝新工作再 await dispose。停一个面板或请求取消不杀共享 worker。
- 使用真实 Node 部署 Config，经 ctx.subprocess.resolveExecutable 验证；不采用 process.execPath 的 Electron 路线。P2-003 将提供 `env?: Record<string,string>`（完整 env，不隐式 merge）、`cwd?: absolute path`。Host 必须显式传清理后的环境/cwd，去掉 Electron/IPC/Node 注入变量，不修改 process.env。
- Config 由可信安装提供 workerNode、registryPath、artifactRoot/私有 cwd 与非空允许工程集合；workerEntry 优先解析 `dsh-video-engine-worker/worker`。避免相互矛盾的 registry.outputRoot/artifactRoot，启动前只读核对。缺配置时保持壳可用，不在 apply 阶段失败移除 UI；具体业务请求返回清楚的 E_CONFIGURATION，不静默猜其它路径或 Node。

## 2. 请求、Tool 与产物

- `POST /api/dsh-video/request`：JSON `{method,params}`，限 doctor/open/inspect/edit/frame/render/status/cancel/close；正文限额建议 64KiB，typed 字段、范围、revision 与 operationId 对齐 worker。拒绝额外字段、path/URL。客户端文档相对 fetch，保留原生 peer 鉴权。
- `video_engine` Tool：相同动作/typed params，经同一 dispatcher；保持 `uncertain`/`jobUnknown` 原意，不能自动重试编辑/任务或吞冲突。不增加 frame 附件/模型调用/自定义 Session 写入。先返回有界结构化结果，避免 inspect 全量正文超出 Tool/Host 结果上限；超限应明确错误，不截断后伪装完整成功。
- 所有 project 请求受可信 allowlist 限制；启动任务登记 job→project/revision，status/cancel/artifact 也先检查登记归属。未知旧 worker/其它项目 job 拒绝；没有新增 per-session ACL，不宣传多用户私有工程权限已完成。
- `GET/HEAD /api/dsh-video/artifact?jobId=...`：只读本桥已登记 succeeded 产物。校验 UUID 扩展名、realpath 在输出根、普通文件/大小/SHA 一致后才发布 PNG/MP4，合理大小上限（短 fixture 可 64MiB），不接受请求文件名/路径。no-store + 正确 Content-Type/Length；不列目录、不代理 URL、不暴露绝对路径/源码/stderr。短片可只支持完整 GET/HEAD，Range/连续预览另做。
- 错误统一 code/message/stage/uncertain/jobUnknown；不把 errno 路径原文或 stdout/stderr塞进 UI/Tool。client.debug() 只含状态计数，不假设存在 stderr 详情字段。

## 3. 最小真实界面（继续克制）

- 保留 Vedio Editor 入口、返回对话和显示选项。无工程一行状态，提供**可工作的「打开示例」**动作（只访问配置中的受控 demo projectId），不自动伪造工程或进度。
- 打开后主体是 revision 对应的真实 PNG；已接通才显示标题编辑、基础 timing 编辑、更新画面、导出/取消与实际作业状态。目标 stableId/capabilities/timing 从 inspect 读取；字段错误与 revision 冲突就近提示，不覆盖新内容。
- 代码里的固定示例 ID/初始选中目标可以作为受控 fixture 配置，显示标题/时长必须来自真实 inspect，不用演示数据假装当前工程。没有预览时保持诚实空状态，编辑后旧帧不得冒充新 revision。
- 单个主画面、轻量工具，详细元数据放按需展开的属性区，不常驻 path/revision哈希/版本/接入阶段说明。不加时间线、假轨道、连续播放或 AI 生成按钮；不把像素截图当可 seek 的实时预览。UI 状态可保留，内容权威仍在 worker。
- 定向 UI 通道不足时不退回全局输入。本轮主要交本地逻辑与真实引擎输出证据，真正 Host 视觉/键盘验收在安装授权后进行。

## 4. 固定 staging 与检查

- 根版本目标 **0.2.0**。准备 ignored staging：根 bundle、两引擎包均来自固定提交快照，各自依赖闭包按锁准备且 ignore-scripts。不能依赖另一个 tree 的 node_modules，也不硬编码其绝对源码路径。不要为凑固定 tarball 写不可移植相对 file: 依赖后声称任意安装可用。
- 开发期可交可被 Plugin Manager link 消费的完整**不可变目录快照**：manifest 的本地依赖必须在该快照内可解析，记录文件清单/摘要/锁/源提交；后续不在原 staging 目录边装边改。未来通用发行 tarball 另定义，不承诺本次已解决所有平台分发。
- 出现 esbuild 缺二进制或 pnpm pendingBuilds 时记录，不运行 postinstall/approvedBuilds，不升级依赖。纯 staging 的受控本地包准备可以做；真实 profile 包管理只能安装授权后通过 Plugin Manager。
- 程序员 1 的新版本在复审前可用 agreed options 写 adapter 与 fake client 契约测试，但最终 stage/真实子进程验证必须固定到主会话接受的 P2-003 提交；不能把5b9032b没有env seam的旧包当已接清理环境。

## 5. 验收与交付

本地：路由/Tool 共用、额外字段/越权 project/job 拒绝、错误标记保留、启动单飞、停止准入/dispose、不覆盖 revision、artifact 目录越界/未成功/字节 hash/大小拒绝；原侧栏生命周期检查保留。测试实际风险，减少实现字符串匹配。

真实受控子进程：通过 Host 业务对象跑 doctor→open→inspect→text/timing edit→revision/frame/status/字节→render/status/cancel（有一条成功 H.264 输出），证明业务链可用；该 Node 测试不等于真实 DSH 激活。Host 真实安装后的路由/Tool可用性、加载和卸载/重启用、界面焦点/草稿保持/明暗窄窗均按实际记录，授权前不执行。

交回提交、依赖固定 SHA、公共 Config/schema/路由样例、staging 路径与完整性清单/摘要、本地和真实引擎结果、未测项与 0.1.3 回滚步骤。先交主会话复审，不更新现有安装。

开发记录：待填写。
