# ADR-0002：受控工程的 Host 桥、运行时与访问边界

状态：Accepted（实施决策，尚未在真实 Host 验证）。日期：2026-10-17。决策者：主会话；依据程序员 2 的 `afcf57d` 调查与程序员 1 已验收的 `5b9032b`。

## 背景

Desktop 当前为 0.2.1-rc.1，Host 自身采用 Electron-as-Node，环境携带 Electron/IPC 变量。独立 WorkerClient 已通过本机 Node 22.15/24.14 的受控链，但尚无 Host 启动和依赖分发证据。UI/Tool 必须共用业务入口，后续不能各自写一份工程或管理第二份 revision。

## 决定

1. **真实 Node + 显式环境**：本轮不采用 Electron-as-Node。可信部署 Config 提供 workerNode，通过 ctx.subprocess.resolveExecutable 验证；本机 bundled primary-runtime Node 24.21.0 可作为安装配置值，不写入产品代码默认路径。WorkerClient 增加可选 env/cwd 通用参数，Host 必须传入构造的完整环境与绝对 cwd，不能修改 process.env。移除 ELECTRON_RUN_AS_NODE、NODE_CHANNEL_*、NODE_OPTIONS、NODE_PATH 等会影响 Node 启动/注入的继承项；只传渲染所需受控环境。不把环境清理宣称为安全沙箱。
2. **包解析**：worker 导出 ./worker 与 ./package.json；client 保留根导出，可增加 ./package.json。Host 使用包解析，不拼接其它工作树、node_modules 内部布局或把源码路径硬编码为部署默认。程序员 1 负责这两包与局部锁/包文件白名单，程序员 2 负责 Host。
3. **单一业务对象**：每个插件 fiber 一个 VideoBridge，POST /api/dsh-video/request 和一个 video_engine action Tool 共用相同 typed dispatcher。业务参数/错误只有一份实现，Host 不复制 worker 的 operationId journal 或 revision 缓存。首次明确的引擎业务请求惰性启动，start 需单飞合并；切换/卸载 UI 不销毁 worker，插件 dispose 才停止准入并 await client.dispose。单个 HTTP/Tool 取消不销毁共享 worker，也不代表已提交编辑回滚。
4. **访问控制**：依托原生 connection 已鉴权 peer + 必需的非空受控 projectId allowlist。status/cancel/artifact 必须查 Host 实例已登记的 jobId→projectId/revision，不能绕开 allowlist；close 后仍可读保留的成功产物，插件重启后未知旧 job 拒绝。本轮不增 per-session ACL，不绑定/更改 DSH Session；正式用户工程/多用户访问另立权限任务。
5. **真实字节发布**：GET/HEAD /api/dsh-video/artifact?jobId=... 只发布 succeeded 的真实 PNG/MP4；从登记 job 的 artifact 元数据取文件，不接受请求路径/name。校验文件名、realpath 根、普通文件、大小与 SHA-256，限定可服务大小；Content-Type/Length、no-store，未知或未完成拒绝。不返回绝对路径、源码、stderr 或私有临时目录。不做目录列表、任意 URL 代理；短 fixture 阶段可以不支持 Range，明确不是连续预览协议。
6. **Tool 呈现**：先返回有界结构化数据/任务/产物引用，不把 frame 自动变成附件，不发模型请求凑体验证据。所有不确定性标记原样保留；Host 不重试写入、渲染或在新 revision 上自动重放。
7. **开发包**：用固定提交的 client/worker 快照，在 ignored staging 中准备独立依赖闭包；可生成供 Plugin Manager link 安装的完整开发目录。只含可信路径配置，不引入未提交树或指向另一个开发者 node_modules。stage 的相对本地依赖只对该不可变开发快照有效，不宣称为可移植发行 tarball。依赖安装 ignore-scripts，缺二进制/pendingBuilds 则如实失败，不运行未知构建脚本、不调用 approvedBuilds。正式发行策略另立任务。
8. **UI 范围**：原生侧栏保留，最小真实闭环为打开受控示例→真实标题/typed 编辑→revision 对应 PNG→异步 MP4/取消。先做静态帧编辑，连续播放预览、时间线、多 Scene 和 AI 生成不在本轮。材质/文字克制，不常驻版本号、revision 哈希、路径或开发阶段说明；必要错误与过期预览状态不能隐藏。

## 代价与替代

真实 Node 配置增加部署步骤，但与 Electron 的私有启动协议解耦；支持 Electron-as-Node 留到有明确分发需求时再验证。client 的 env/cwd 是小型通用 seam，不引入 Host API 依赖。开发 staging 需要完整性清单与依赖验证，不能把旧单一 9 文件 bundle 的安装模型硬套到引擎依赖。

暂不提供持久化 Host job registry、跨 worker 重启幂等恢复、任意生成代码执行、系统级孤儿进程监督或正式 session ACL。这些限制保留，不以独立进程、allowlist 或 iframe 替代。

## 验收与来源

实施拆分为 P2-003（程序员 1：启动参数/包出口）与 P2-002-B（程序员 2：Host/Client/Tool/staging）。两人并行开发；最终 stage 必须使用主会话复审通过的 P2-003 精确提交，再交整体代码/包复审；未授权前保持已安装 0.1.3，不安装/启停/重启。

来源：程序员 2 `docs/research/P2-002-host-bridge-contract.md`@afcf57d；ADR-0001；P2-001-review-04；P2-002-review-01。
