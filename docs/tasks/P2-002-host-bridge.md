# P2-002-A：当前宿主的 Host 接入契约

执行：原 DSH 会话，继续原工作树/分支。当前资料基线 `98e2571`，插件已安装启用 0.1.3；先读 DEVELOPMENT、ADR-0001、P0-006-review-01 和本指南。**本轮只读调查 + 接入提案/记录，不修改或安装功能代码。** P2-002-B 的实现由主会话评审契约后另行放行。

## 为什么现在做

独立 worker（3b5f6de）受控工程验收通过，父进程 client（6c4b2e9）的 Node 24 核心路径通过，测试时序由引擎会话单独收敛。DSH 壳的侧栏/空状态核心 live 通过。下一步将真实 SDK 操作接入 Host；先避免猜测已升级的 Desktop 0.2.1-rc.1 API。

## 调查与提案

1. 记录实际运行版本、app.asar 摘要及官方内置 plugin-development skill 与归档差异；只读对照，不自动升级/替换参考包，也不把旧 0.2.0 证据抹掉。主要核实 Host 相关差异，不重做已通过的侧栏调查。
2. 明确 Host 插件加载机制、外部 ESM 包加载/路径解析、Node executable 的可信配置入口、启动/异步 dispose 的正式生命周期；UI 切换不应启动/销毁 worker，插件停用才收尾。不得用开发工作树绝对路径作为产品部署契约。
3. 核实受支持的 connection.fetch 注册/Client 调用与 tools.register 契约，提议一个 Host 业务服务供两者共用。先列 doctor/open/inspect/edit/frame/render/status/cancel/close 的方法、typed params、revision/operationId、结构化错误映射；private stdout/stderr 不直接送前端。不可用 API 标记，不补自定义猜测 namespace。
4. 提议受控 fixture 的注册与本地运行配置、静态 PNG/MP4 受支持发布方式和结果访问边界；请求只能引用 Host 注册的 projectId/jobId，不能传任意路径/URL。保持 worker 为唯一内容写入入口；本轮不承诺任意 Agent 生成 HTML/JS 已隔离。
5. 对独立 packages、依赖锁和浏览器/FFmpeg/Node 检测提出**开发期**加载方案与**将来分发**待办；不把 node_modules、系统字体、系统工具绝对路径悄悄打入 bundle，也不执行安装脚本。明确 Host 本身 Node/Electron runtime 与独立 worker 选择的 Node 是两层。
6. 输出最小纵向样例方案：在 DSH 中打开受控工程→读真实标题→typed edit→取得 revision 的真实抽帧→渲染任务/取消；视图只显示真实已接能力，错误就近提示，不增加阶段说明或成排无效按钮。先 PNG 与动作闭环，连续预览/时间线另行定义。

## 文件、边界与交付

仅允许新增/更新 `docs/research/P2-002-*.md`、本任务开发记录及必要的去标识只读契约证据。根插件、manifest、引擎/client/锁、全局规范和现有安装均不改。不启停/安装、不重启、不写 profile、不 push/merge，不为补截图操作面板内控件。

可通过 git show 只读参考独立 worker/client 源码与报告，不在其它会话 tree 执行安装或写入，不引入它们的未提交成果。记录依赖固定提交和未收口项，不自动合并分支。

交回：版本差异、精确运行时契约/出处、Host 服务与 UI/Tool 共用调用表、加载/打包提案、资源/进程生命周期、P2-B 文件范围与验收建议、无法验证事项。主会话保留架构和 API 最终决定。无需等待引擎侧测试收口，可并行调查。

## 开发 / 调查记录（DSH）

- 版本记录：任务指南声明基线 `98e2571`；收到指南的文档提交与开工 HEAD 均为 `7e3b8f4`。实际运行 Host 为 Desktop **0.2.1-rc.1**（app.asar SHA-256 `f15cc450…89ee`；旧基线 0.2.0-rc.2 为 `18d5036b…30f9e`）。当前已安装插件仍为 `dsh-video 0.1.3`；本轮**未安装/启停/重启、未改 profile、未修改功能代码、未 push**。
- 只读调查：内置官方 Skill 与归档对比（21 vs 16 文件，9 相同、7 变更、5 新增；变更集中于展示元数据/图标/验收说明与 packages 列表，Host 导出形式不变）；Host 加载/模块解析（`dsh-app-boot` 双锚点、profile 依赖闭包、Loader `EntryTree.import`、HMR/替换语义）；Host 插件 Config/apply/异步 dispose；`ctx.connection.fetch` 精确路由契约与 Client 文档相对 `fetch` 实例；`ctx.tools.register(defineTool(...))`；`ctx.subprocess.resolveExecutable`；Host/Electron Node 与独立 primary-runtime Node 两层（均为 v24.21.0）；引擎 worker/client 固定提交 `3b5f6de`/`6c4b2e9` 的 v1 协议、错误码、revision/operationId、job/artifact 语义。
- 提案：见 `docs/research/P2-002-host-bridge-contract.md`。核心为 plugin-local 单实例 `VideoBridge`；Host `POST /api/dsh-video/request` dispatcher + `GET /api/dsh-video/artifact`；Client 文档相对 `fetch`；Tool `video_engine` 与路由共用同一方法；请求只接受 Host 注册的 `projectId`/`jobId`，不接受 path/URL；worker 惰性启动、插件停用异步 dispose，UI 切换不启停；受控 fixture + 真实 PNG/MP4 访问边界；开发 staging 安装方案与将来分发待办；P2-B 文件范围/验收建议与未验证清单。
- 待主会话决策：Node executable 路线（部署真实 Node vs Electron-as-Node）；是否需要给 engine client 增加 `env`/`cwd` seam（跨 owner）；worker 包 `./worker`/`./package.json` exports；worker 依赖（esbuild 等）构建脚本/pnpm pendingBuilds 分发策略；per-project/session 鉴权；Tool 结果/图片呈现范围。
- 限制/未验证：路由/Tool/worker 启动/HMR/卸载/资源字节服务均未在真实 Host 运行；仅契约核对与只读探针；受控 fixture 不是安全沙箱；Chrome/FFmpeg 当前为系统可用（155.0.8059.79 / 8.0.1），不作为分发契约；Windows/Linux、模型体验、失败注入未验证。

## 主会话调查验收（2026-10-17）

`afcf57d` 调查验收通过，见 P2-002-review-01 与 ADR-0002。保留上述调查记录。程序员 2 下一任务 P2-002-B：Host/Client/Tool 与 staging；程序员 1 同时补 P2-003。只放行本地实现与交付，不改已安装 0.1.3，不 push/merge。
