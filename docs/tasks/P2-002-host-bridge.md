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

开发记录：待 DSH 填写。
