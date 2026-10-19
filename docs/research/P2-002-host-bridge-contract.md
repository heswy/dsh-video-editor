# P2-002-A：当前宿主的 Host 接入契约与接入提案

日期：2026-10-17（Asia/Shanghai）。
执行：原 DSH 会话，原 `dsh/p0-mode-shell` worktree。
资料基线：任务指南声明基线 `98e2571`；收到指南的文档提交与开工 HEAD 均为 `7e3b8f4`；实际运行 Host **Desktop `0.2.1-rc.1`**；当前已安装插件仍为 `0.1.3`（本轮未安装/启停/重启、未改 profile、未写功能代码、未 push）。
调查方式：只读 inspection（Host/Client Service、P0-006 已安装 0.1.3 的 live 页面未再操作）、只读解包 `app.asar` 源码/README、只读 `git show` 引擎提交、只读启动探针（不启动 GUI、不安装依赖）。遵守真机操作边界，无全局输入/个人剪贴板/系统设置修改。

结论（供主会话决策，不是已实现）：

1. **P2-B 建议的 Host 接入面已经存在且可落地**：Host 插件可以 `import` 已安装的独立引擎 client 包；用 `ctx.connection.fetch.register` 注册 `/api/dsh-video/...` 精确 Fetch 路由供 Client 相对 `fetch` 调用；用 `ctx.tools.register(defineTool(...))` 注册同一业务操作；二者调用同一个 Host 业务对象，worker 在插件生命周期内按需启动，插件停用才异步收尾。
2. **两个必须先由主会话确认的前置**：(a) Node executable 采用部署配置的 **真实 Node 路径**（不再用系统 Node 或开发工作树路径）；(b) 若想直接使用 Electron 自带 Node（`process.execPath + ELECTRON_RUN_AS_NODE=1`），需要给独立引擎 client 增加 `env`/`cwd` 启动 seam（引擎侧小改动，跨 owner），否则 Host 继承的 `NODE_CHANNEL_FD` 等环境可能影响 worker。
3. **本轮没有安装/激活任何 P2 功能**；路由、工具、worker 启动、HMR/卸载、资源访问均为提案/契约核对，不是真机通过。

## 1. 版本、`app.asar` 与官方 Skill 差异

| 项 | 本轮实测/记录 |
|---|---|
| Desktop 版本 | `0.2.1-rc.1`（`/Applications/DeepSeek Harness.app/Contents/Info.plist`） |
| 运行中 app.asar SHA-256 | `f15cc450cf70f70d6d2de4d27f8919980ec88769f899901279e8ed4bb69589ee` |
| 对照旧版本（P0-001/P0-002 记录） | `0.2.0-rc.2`，app.asar SHA-256 `18d5036bbb58eaff41d351ede99314b8d06505aec06fb2e164c49874ada30f9e` |
| 应用内 `dsh/package.json` | `@deepseek-ai/dsh-desktop-runtime` `0.2.1-rc.1` |
| 当前已安装插件 | `dsh-video 0.1.3`（profile 依赖指向 `…/51c82a9/dsh-video-0.1.3.tgz`；本轮未变更） |

**官方内置 `cordis-plugin-development` Skill 与归档差异**（归档 `docs/reference/dsh-plugin-dev-kit-20261017`，PROVENANCE 记录 targetHost 0.2.0-rc.2、zip SHA `84111b…`）：

- 当前内置 skill 目录共 **21** 个文件；归档 `skill/` 共 **16** 个。
- **逐字节相同 9 个**：`cordis-composition-reference/SKILL.md`、`cordis-plugin-development/references/{mcp-bundle,ui-plugin,user-actions}.md`、`templates/decoration/{client.js,cordis.patch.yml,index.js}`、`templates/mcp/cordis.patch.yml`、`editing-cordis-compositions/SKILL.md`。
- **内容变更 7 个**：`cordis-composition-reference/references/packages.md`；`cordis-plugin-development/SKILL.md`；`references/host-plugin.md`；`references/practices.md`；`references/verification.md`；`templates/decoration/package.json`；`templates/mcp/package.json`。
- **当前新增 5 个**：`agent-experience/SKILL.md`；`templates/decoration/{icon.svg,locale/en.json}`；`templates/mcp/{icon.svg,locale/en.json}`。
- 与 Host 接入相关的差异：
  - `host-plugin.md` 与 `SKILL.md` 新增/强化**展示元数据与图标清单**：`meta.title`/`meta.description` 在 locale JSON、图标通过 `./locale/*.json` / `./icon` 导出（或 package root `icon`），安装后需核对渲染；这是 0.2.1 的 Plugin Manager/Settings 行为，不改变 Host 导出形式（`apply`/`Service`/`inject`/`Config`）。
  - `verification.md` 增加“页面样式只用主题 token、插件不得 import Harness Client 包、console 无 Slot crash、明暗主题对照”等验收要求。
  - `practices.md` 新增 `appendPluginRecord()` 说明（保留给 DSH experimental 包，不用于我们的工程内容）。
  - `packages.md` 新增 `dsh-api-remote-access`、`dsh-plugin-market`、`dsh-client-ui-plugin-market`、`dsh-client-ui-secret-mask`、`dsh-harness-dev-context` 等包；本提案不使用 Remote 命名空间，继续使用精确 Fetch 路由。
  - `user-actions.md`/`ui-plugin.md`/`mcp-bundle.md` 与归档逐字节相同；此前 P0 系列依据的 Slot/Sidebar 契约未变（本轮只需核对 Host 差异，不重做侧栏调查）。

> 结论：0.2.1 的 Host 插件加载/导出形式与归档基本一致；差异集中在展示资源/验收要求与新增包，不影响 P2 用 `apply + ctx.connection.fetch + ctx.tools` 的接入路线。

## 2. Host 插件加载、模块解析与生命周期（0.2.1 实测/源码）

### 2.1 Profile / bundle 加载

- Profile：`$DSH_HOME/profiles/<name>/`，其中 `package.json` 声明外部依赖与 `dsh.profile.bundles`，`cordis.patch.yml` 是用户 patch 层；bundle 是带 `dsh.bundle.patch` 的 npm 包，patch 以 `insert/override` 组合 Loader 条目（`dsh-app-boot/lib/index.js` profile 模块注释）。
- Loader 的 `EntryTree.import(name)` 以模块 specifier 导入插件：`cordis:` 内置名，或通过 `loader.internal.import(name, baseUrl)` / `import(new URL(name, baseUrl))` / `import(name)`（`@deepseek-ai/cordis-plugin-loader/src/config/tree.ts`）。
- **模块解析是“双锚点”**：bundle 名先从 DSH 安装解析，再从 profile 解析；pnpm 管理的 profile `node_modules` 优先；运行时解析把“安装携带的包 + 选中 bundle 的依赖闭包”供给 Node 的 ESM/CommonJS resolver（`dsh-app-boot/lib/index.js` profile 注释、`collectInstallationScopePackages`/`collectProfileScopePackages`/`dependencyClosure`）。
- 因此 **Host 插件可以 import 自己的 npm 依赖**（例如独立引擎 client/worker 包），只要 bundle 的 `package.json` 声明依赖并由 profile pnpm 安装；无需、也不应把开发工作树绝对路径写进代码。
- 替换/升级：无 HMR 时替换运行中的包报告 `restart-required`；有 HMR 时停止旧插件、驱逐模块、按当前解析重新导入，失败会报 `failed` 并停止旧代码（`dsh-plugin-manager/README.md` §Understand the implementation）。**这也意味着开发期替换 Host/client/引擎依赖版本可能需要/触发插件重启**，不能假设“重新安装包 = 热更新一切”。

### 2.2 Host plugin 导出与生命周期

- 导出形式（官方 Skill `host-plugin.md`）：`export function apply(ctx, config)`（可选 `export const inject = [...]`、`export const Config`），或默认导出 Service class；不要混用。所有资源在 `apply` 内用 `ctx.effect`/`ctx.on` 注册并返回 cleanup。
- `ctx.effect` 支持**异步 cleanup**：应用内实例 `dsh-client-ui-deliverables` 使用 `ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled(pending); })`（只读源码）；Plugin Manager 会等待被移除插件的资源停止（`await ... 移除的插件资源`），HMR 替换会先停止受影响插件。
- 因此 P2-B 的生命周期模型可以是：`apply` 只注册路由/tool/清尾 effect（不启动 worker）；首次请求惰性 `start()` worker；插件 fiber dispose（停用/移除/HMR 替换）时 effect 异步 `await workerClient.dispose()`，禁止在 UI 面板打开/关闭/切换时销毁或重启 worker。
- 导入时无副作用是契约要求（Skill：factories/import 保持纯净，资源放 `apply`）；引擎 client 的 `WorkerClient` 构造/导入也无副作用（P2-001 README 明确），这正好匹配惰性启动。

### 2.3 Config（可信配置入口）

- Host 插件可用 `export const Config`（官方 Skill）；应用内实例以 `@deepseek-ai/schemastery` 的 `z` 声明，例如 `dsh-plugin-manager` 的 `static Config = z.object(...)`、`dsh-cordis-host-runner` 顶层 import `z`。
- 安装包可由 `Config.listConfigs` 查询 schema，`plugin_manager` 安装/配置时按 schema 校验；这是唯一应承载“部署相关绝对路径/Node 可执行文件/受控 fixture 根”的入口，**不能写死开发工作树路径**。
- P2-B 建议 Config（见 §4.1）：`workerNode`、`workerEntry`（可选）、`dataDir`、`registryPath`、`artifactRoot`、`allowedProjects`、启动/请求/关闭期限与上限；全部为部署/本地安装时提供，不提交开发路径。

### 2.4 `ctx.subprocess` 的可执行文件解析

Host Service `subprocess`（inspection 精确契约）提供：

```
resolveExecutable(command: string, env?: Record<string,string>, signal?: AbortSignal): Promise<string>
spawn(spec: SubprocessSpawnSpec): SubprocessHandle
```

- `resolveExecutable`：绝对路径会被验证；裸名用 provider 的 **scrubbed PATH + 显式 env 覆盖**解析；带分隔符的相对路径被拒绝（“resolution base is undefined, fail loud”）。
- `spawn`：完全指定的 argv/cwd/stdio/期限/signal；service dispose 会终止并等待其管理的所有进程。它是 Host 启动子进程的受支持 seam，但**不负责替我们找 Node**；P2-B 应先用 `resolveExecutable` 验证 Config 的 `workerNode`，再把规范路径交给引擎 client。
- 独立引擎 client 目前用 `node:child_process.spawn(nodeExecutable, [workerEntry,'--registry',registry])`，没有 `env`/`cwd` 透传（P2-001 源码）；见 §4.3 的前置。

### 2.5 Node 运行时两层（实测探针）

- Host 进程本身是 **Electron 以 Node 模式**运行：当前 Host 子进程 PID 62013 的环境含 `ELECTRON_RUN_AS_NODE=1`，`ps` command 为 `/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness`。
- 只读探针：`ELECTRON_RUN_AS_NODE=1 '<app>/Contents/MacOS/DeepSeek Harness' -e …` 输出 **Node v24.21.0**，`process.execPath` 为应用二进制、`process.resourcesPath=/Applications/DeepSeek Harness.app/Contents/Resources`。
- 安装包还带一个**独立 Node**：`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node`，探针同为 **v24.21.0**；`Contents/Resources/runtime/bin/node` 是一个 shell launcher，`export ELECTRON_RUN_AS_NODE=1; exec "$DSH_DESKTOP_NODE_EXECUTABLE" --expose-internals "$@"`（Desktop 自己的 pnpm/CLI 用）。
- Desktop 内部用 `process.execPath + ELECTRON_RUN_AS_NODE=1` 启动自己的 Host/CLI（`dsh-desktop-host/lib/index.js` / `cli.js`，并注入 `DSH_DESKTOP_NODE_EXECUTABLE`、`PATH` primary-runtime/bin）。这些是 **Desktop 实现细节，不是 Host 插件可依赖的稳定 API**。
- 引擎测试基线 Node 24.14.0，worker `engines.node >=22`；当前宿主两层 Node 都是 v24.21.0。浏览器 Chrome **155.0.8059.79**、FFmpeg/ffprobe **8.0.1** 为本机现状（P1 已用过），但它们应由 worker `doctor` 动态报告而不是写死。
- **结论**：Host/Electron Node 与 worker 选择的 Node 是两层。P2-B 应让 Deployment Config 提供真实 Node 路径（或以后由 DSH 提供正式 runtime locator），通过 `resolveExecutable` 验证；若采用 `process.execPath` 的 Electron-as-Node 路线，必须显式设置/清理环境并用 worker `ELECTRON_RUN_AS_NODE`，不能假设继承环境安全。

## 3. 精确 Fetch 路由与 Tool 注册契约（0.2.1）

### 3.1 `ctx.connection.fetch`（Host → Client）

Host Service `connection` 的精确契约（inspection）：

```
readonly fetch: HostConnectionFetch
HostConnectionFetch.register(route: ConnectionFetchRoute): () => Promise<void>  // Context-owned effect
```

路由验证/行为（只读 app.asar `dsh-client-connection/lib/index.js`）：

- `assertFetchRoute`：`path` 必须能通过 `endpointFromPath('/api', path)`（即 `/api/<segment...>`，segment 仅 `[A-Za-z0-9_$.-]`，含多段）；`methods` 非空且不重复；`requestBody` 为 `buffered` 或 `streaming`；重复 path 注册抛错。
- 注册是 `owner.effect(...)` 持有的，插件卸载/HMR 会移除；路由挂在 Connection 的 **浏览器/API Peer 鉴权 fence** 内；未认领的请求 404。
- 真实包实例：`@deepseek-ai/dsh-session-log-export` 注册 `path:'/api/session.export', methods:['GET','HEAD'], requestBody:'buffered'`；`@deepseek-ai/dsh-client-file-upload` 注册 `/api/session/uploadFileBinary`（`streaming`）。
- Client 调用：内置 Client 用**文档相对路径**（`'/api/session.uploadFileBinary'.slice(1)`，即 `api/session/...`）调用 `fetch`，依赖同源 cookie；`dsh-client-connection` README/源码说明 `/api` 是 Web carrier 的唯一 bridge 路径，精确路由由 Host registry 分发。

**提案**：注册一条 `POST /api/dsh-video/request`（buffered，body 小）作为统一业务 dispatcher；再注册 `GET /api/dsh-video/artifact` 返回真实 PNG/MP4 字节。Client 用 `fetch('api/dsh-video/request', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({method,params})})`（strip 前导 `/`，与内置包一致）；不引入 Remote namespace、不猜新 API。

### 3.2 `ctx.tools.register`（Host → 模型）

Host Service `tools` 精确契约：

```
register(definition: ToolDefinition): () => void
```

- 官方 `dsh-tools` README 的 `defineTool` 用法：`import { defineTool } from '@deepseek-ai/dsh-tools'`，`ctx.tools.register(defineTool({name,description,parameters,output,execute}))`；schema 支持 string/number/integer/boolean/array/object/oneOf 等，`execute(args, exec)` 返回声明值，`exec.signal` 是调用方取消信号。
- 注册返回 disposer；Tool 对模型可见，schema 进入 system prompt；归属的 agent/preset 上下文通过 `inject`/`agent.ctx` 选择。P2-B 用 **Host plugin fiber** 注册一个全局工具即可；不要写 session 事件，不要把 worker stdout/stderr 直接作为 tool 结果。
- 提案：一个工具 `video_engine`（action 参数：`doctor|open|inspect|edit|frame|render|status|cancel|close`），参数只含 `projectId`/`jobId`/`revision`/`operationId`/`ops`/`time`/`timeoutMs`，**不接受任意 path/URL**；`execute` 与 §4 的 `VideoBridge` 同一对象方法，返回结构化 result；失败抛结构化错误（Tool 层统一转为工具错误，不新增自定义 session 内容）。

## 4. Host 业务服务（`VideoBridge`）提案

### 4.1 形态与 Config

- 在 Host `apply` 内创建一个 **plugin-local 单实例** `VideoBridge`（普通对象/Service 类实例均可）；路由 handler 与 Tool 的 `execute` 都持有它。这样满足“一个应用操作只实现一次”，暂不注册新的全局 Cordis 服务（若未来跨插件需要，再按 inspection 确认的 service 注册方式暴露）。
- 建议 `export const Config = z.object({ ... })`（Schemastery）：
  - `workerNode`（string，必填）：绝对路径或 PATH 名；首次使用时用 `ctx.subprocess.resolveExecutable` 验证，失败即配置错误，不猜测系统 Node。
  - `workerEntry`（可选）：默认从引擎包导出/包路径解析；部署可用绝对路径覆盖（受控配置）。
  - `dataDir`（string，必填）：Host 可写的私有目录（注册表副本/诊断），不得指向 git 工作树或用户素材目录。
  - `registryPath`（string，必填）：由受控 fixture 准备脚本生成的可信 worker registry（Host-owned，不由请求路径参数决定）。
  - `artifactRoot`（string，必填）：与 registry 的 outputRoot 一致；Host 仅从该根读取真实 job artifact。
  - `allowedProjects`（可选 record<string, true>）：额外 allowlist；请求只能引用已注册 `projectId`。
  - `startupTimeoutMs`、`requestTimeoutMs`、`shutdownTimeoutMs`、`maxPending`、`maxRequestBytes` 等有界默认值。
- 所有路径由部署/本地安装配置提供；包内**不写死**开发 worktree、系统字体、系统 Chrome/FFmpeg/Node 绝对路径。

### 4.2 方法表（UI 路由与 Tool 共用）

| Host 方法 | worker 调用 | typed params（JSON） | 成功 result（关键字段） | 主要错误 |
|---|---|---|---|---|
| `doctor` | doctor | `{}` | Host/worker Node、SDK/CLI/GSAP、Chrome、FFmpeg/ffprobe（unavailable 也如实返回） | E_WORKER_START/E_CAPABILITY |
| `open` | open | `{projectId}` | `{projectId,revision,width,height,duration,elements[]}` | E_PROJECT_NOT_FOUND/E_PROJECT/E_PATH |
| `inspect` | inspect | `{projectId}` | 同 open 的 inspect（revision、尺寸、时长、stableId/文本/timing/capabilities、文件 hash 清单） | E_PROJECT_NOT_FOUND/E_PROJECT |
| `edit` | edit | `{projectId,expectedRevision,operationId,ops:[{type:'text'|'timing',target,text?/start?/duration?}]}`（ops ≤32） | `{projectId,revision,...}`（保存+读回后的新 revision） | E_REVISION_CONFLICT/E_OPERATION_REUSED/E_PARAMS/E_PERSIST/E_UNSUPPORTED_EDIT |
| `frame` | frame | `{projectId,revision,time,timeoutMs?}` | 异步 job：`{jobId,projectId,revision,kind:'frame',state:'queued'...}` | E_REVISION_CONFLICT/E_PARAMS/E_LIMIT |
| `render` | render | `{projectId,revision,timeoutMs?}` | 异步 job：`{jobId,...,kind:'render',state:'queued'...}` | 同 frame |
| `status` | status | `{jobId}` | worker job view：state/stage/progress/error/cleaned/artifact（成功后 `{name,hash,bytes,metadata,tools}`） | E_JOB_NOT_FOUND/E_PROJECT_CLOSING（仅相关操作） |
| `cancel` | cancel | `{jobId}` | 取消 ack/终态（幂等） | E_JOB_NOT_FOUND |
| `close` | close | `{projectId}` | `{projectId,closed:true}`；同步关闭准入门后析构 | E_PROJECT_CLOSING/E_PROJECT |
| `artifact`（Host-only） | 无（读 Host worker 产物） | `jobId`（query） | PNG/MP4 bytes + headers | E_JOB_NOT_FOUND/E_NOT_SUCCEEDED/E_ARTIFACT |

- 请求层只接受上表方法；未知方法 `E_METHOD`；参数在 Host 层做类型/范围/长度校验（与 worker 对齐），不把 path/URL 传给 worker。
- `revision` 固定 64 位小写 hex；`operationId` 非空 ≤128 且由 UI/Tool 生成；Host 可记录最近 operationId 结果（内存）以支持安全重试，不伪造 worker 的幂等（worker 只保证本进程内存记录）。
- 错误统一：`{ ok:false, error:{ code, message, stage, details?, uncertain?, jobUnknown? } }`；worker `publicError` 已去掉磁盘路径/源码/原始引擎日志；Host 只透传结构化 `code/message/stage`、把 `uncertain`/`jobUnknown` 原样标记，**绝不返回 stderr 原文、Host 绝对路径或 worker 临时目录**。Host 自己的传输/启动失败用带前缀 code（如 `E_WORKER_START`、`E_WORKER_DISPOSED`、`E_TRANSPORT`、`E_TIMEOUT`），并在 Host 日志保留有界诊断。
- `operationId` 与 `expectedRevision`：Host 不自行改写 revision；冲突返回给调用方重新 inspect；超时/断管后的 edit 必须保留 `uncertain:true`，frame/render 无 jobId 时保留 `jobUnknown:true`（引擎 client 已有该语义），Host 不得自动重试写入或询问“最新 revision”后静默替换。

### 4.3 worker 配置/启动前置（必须由主会话决定）

- 引擎 `WorkerClient` 构造参数为 `nodeExecutable`、`workerEntry`、`registryPath` 和各期限/上限；`start()` 内 `spawn(..., {shell:false, stdio:['pipe','pipe','pipe']})`，**没有 env/cwd 选项**（P2-001 源码）。
- Host 进程环境含 `ELECTRON_RUN_AS_NODE=1`、`NODE_CHANNEL_FD=3`、`NODE_CHANNEL_SERIALIZATION_MODE=json`；若把 `process.execPath` 当 Node 直接交给 WorkerClient，worker 将继承这些变量。只读探针表明 Electron-as-Node 能运行 Node 24.21，但继承 IPC 变量会让子进程误以为有 channel；本轮未把它当作安全/稳定路线。
- **建议 A（推荐）**：Config 指定真实 Node 可执行文件（Desktop 可用 bundled primary-runtime Node；部署由安装配置提供），用 `ctx.subprocess.resolveExecutable` 验证；worker 由真实 Node 启动，环境仍应去掉 `ELECTRON_RUN_AS_NODE/NODE_CHANNEL_*`（需要 engine client 增加可选 `env`/`cwd`，或在 Host 侧用受控 launcher）。
- **建议 B**：若坚持 Electron-as-Node（无额外 Node 分发），必须给 engine client 增加 `env`/`cwd` seam，显式设置 `ELECTRON_RUN_AS_NODE=1` 并删除 IPC 变量；同时验证 worker 的 `process.execPath`/`process.versions.node` 与宿主兼容。
- 独立 worker 包当前无 `exports` 的 worker 子路径；Host 解析 worker entry 时应使用包解析（`import.meta.resolve`/`createRequire.resolve`）或 Config 覆盖，不拼接开发工作树；若采用包解析，建议引擎侧补 `./worker`、`./package.json` 导出（跨 owner，小改动）。
- worker 依赖（hyperframes/SDK/GSAP 等）由 worker 包自身 `package.json`/lock 固定；Host 不复制其 node_modules。

## 5. 受控 fixture、静态产物与访问边界

- **受控 fixture**：P2 只注册 P1/P2 自有样例。准备阶段由 **dev 脚本/部署脚本**（不是请求）在 Host 私有目录生成 `registry.json`（root/projects/outputRoot/browserPath），并复制/生成受控 fixture；Host Config 的 `registryPath` 指向它，`allowedProjects` 只允许登记的 projectId。Client/Tool 请求只能传 `projectId`/`jobId`，**不能传 path、URL、entry、outputRoot**。
- **写入唯一入口**：worker 仍是唯一工程内容写入口；Host 只读 registry/产物，不复制/修改工程 HTML/revision。Host 的 `edit` 只转发 typed ops 和 expectedRevision；Host 不缓存“最新 revision”作为第二份真相。
- **静态 PNG/MP4 发布**：`status` 的 artifact 只在 succeeded 后出现；Host 校验 `artifact.name` 匹配 UUID+`.png|.mp4`、`revision/jobId` 与记录一致、路径 realpath 在 `artifactRoot` 内；可选重算 SHA-256 与 artifact.hash 比对。`GET /api/dsh-video/artifact?jobId=...` 返回 `Content-Type: image/png` 或 `video/mp4`、`Content-Length`、`Cache-Control: no-store`；只允许已成功且有 artifact 的 job，未知/失败/取消 404/409；不提供目录列表、不返回 worker 临时目录/源码路径。
- **错误/诊断**：HTTP 响应只含结构化 error；Host 日志可用 worker client `debug()` 的 stderr 尾部，但要有界且不进入响应/模型。worker stdout 仅协议帧，Host 不把它直接转给前端。

## 6. 开发期加载与将来分发提案

### 6.1 开发期（P2-B，未授权安装前）

1. 保持独立 `packages/video-engine-client`、`packages/video-engine-worker` 为仓库内包；**不把绝对开发路径写进 root bundle 的 package.json**。
2. 生成一个 **gitignored staging 目录**（例如 `artifacts/p2/staging/`，不提交）：
   - `host-bundle/`：复制/生成根插件包（含 P2-B Host/Client、locale、icon、patch、README）；
   - staging `package.json` 声明 Host bundle 对 engine client/worker 包的本地依赖（`file:`/workspace 本地包）；在 staging 内用 pnpm/npm 安装并准备 worker 的 node_modules（`npm ci --ignore-scripts`，沿用 P1-002 的固定锁/cache 策略；不运行 postinstall）。
   - 由 staging 生成固定 tarball 或直接 `link:<绝对 staging 目录>` 安装；Plugin Manager 的 dev Desktop 支持 `link:<workspace package dir>`（README §Use this package），linked package 使用 checkout 的依赖/peer；不手改 profile。
3. 本地 Config（安装时或本地 profile 配置，不提交）提供 `workerNode`（真实 Node 路径，例如 Desktop primary-runtime Node）、`registryPath`/`artifactRoot`/`dataDir`（指向 gitignored 受控目录）；请求/Tool 仍只传 projectId/jobId。
4. worker entry 从已安装的 engine worker 包解析（或 Config 覆盖）；worker 的 Chrome/FFmpeg 通过 registry/doctor 显式指定/检测，不用系统默认路径作为产品契约。
5. 开发迭代：改动 engine/Host 后重新 stage/安装并观察 HMR/restart；替换已运行包可能报告 `restart-required` 或触发停止/重载；不把“重装后页面仍可用”当成未重启验证。

### 6.2 将来分发待办

- 把 Host bundle、engine client/worker 作为**可发布包**（私有 registry/固定 tarball）并锁定精确版本；root bundle 声明 engine 包依赖，profile pnpm 安装依赖闭包，worker 保留自己的 lock/依赖策略。
- 解决 worker 依赖的安装脚本问题：当前 worker 依赖链含 esbuild 安装脚本；P1-002 用 `npm ci --ignore-scripts` 并预置二进制。P2 分发前要决定：允许构建脚本需用户明确批准/预打包二进制/更换依赖，**不得静默执行安装脚本**。
- Chrome/FFmpeg/系统字体：不作为 bundle 内容分发；未来由部署提供或用户配置，worker `doctor` 报告可用性/版本；Host UI 仅在真实可用时显示相应能力。Windows/Linux 与其他字体/GPU 一致性另行验证。
- Node runtime：不把系统 Node 路径写死；P2-B 用部署 Config；未来推动 DSH 提供稳定的 runtime locator（未验证），或随产品分发独立 Node（需用户/部署授权）。
- 文档与元数据：按 0.2.1 官方检查 `meta.title/description`、`./locale/*.json`、`./icon` 导出、`files` 白名单、打包后实际文件清单；安装后核对 Plugin Manager/Settings 的标题、描述、图标与 fallback。
- 安全边界：本提案只接**受控 fixture**；worker 的路径校验不是安全沙箱，任意 Agent 生成 HTML/JS、用户素材、符号链接竞态、OS 级隔离均未解决，不能对外宣称隔离。

## 7. 最小纵向样例方案（P2-B 建议）

目标：DSH 中打开受控工程 → 读真实标题 → typed edit → 取得 revision 的真实抽帧 → render job/取消；UI 只显示真实已接能力。

1. 开发 staging 安装 Host bundle（真实安装需用户另行授权；P2-A 不做）。
2. 用户点侧栏 **Vedio Editor**；面板调用 `doctor`/`open`/`inspect('demo')`，显示真实的 project title、revision、尺寸/时长（来自 worker，不写死）。
3. 面板提供文本/timing 的最小 typed 编辑（目标 stableId 来自 inspect），提交 `edit({projectId,expectedRevision,operationId,ops})`；冲突/失败就地显示结构化错误，不静默重试或覆盖。
4. `frame({projectId,revision:savedRevision,time:2.5})` 得到 jobId；轮询 `status` 到 succeeded，再用 `artifact?jobId=` 取 PNG 显示（真实字节，非占位图）。
5. `render(...)` 得到 jobId；显示真实状态/进度；`cancel` 可取消；成功时 artifact 只在 succeeded 后出现，取 MP4 URL 提供下载/播放（仍只针对受控 fixture）。
6. Tool：同一个 `video_engine` action 调同一 `VideoBridge`，可在 Agent 中做 open/inspect/edit/frame/status/cancel/close；不返回 Host 路径/worker stderr，不传任意 path/URL；模型体验另行评审，不把 Tool 结果当 UI 验收。
7. 错误：就近显示 `code/message/stage`；worker 不可用/Chrome/FFmpeg 缺失时显示 doctor 的真实 unavailable 信息；无假进度、假成功、假导出。
8. 明确不做：连续预览/时间线/多 Scene/任意用户素材/生成代码隔离/任意路径/URL/创建导出按钮（在接入前不显示）。

## 8. P2-B 文件范围与验收建议（供主会话）

**建议文件范围（P2-B 实现前由主会话放行）：**

- `index.js`：Host `apply`（Config、`VideoBridge`、`connection.fetch` 路由、`tools.register`、异步 dispose、诊断）；`client.js`：在 0.1.3 侧栏/极简工作区基础上接入真实项目/编辑/帧/渲染最小视图；`package.json`（版本、dependencies/本地打包策略、`dsh.client` 依赖）、`locale/*.json`、`README.md`、`scripts/` 测试与检查、`docs/research/P2-B-*`、任务记录。
- 可能需要但**跨 owner**：`packages/video-engine-client/**`（新增可选 `env`/`cwd` 启动 seam；用于 Electron-as-Node 或受控环境）与 `packages/video-engine-worker/package.json` 的 `exports`/启动入口声明；这两项应由主会话协调引擎会话，不在 DSH 根插件里私改。
- 不修改：`packages/video-engine-worker` 协议语义、`spikes/**`、全局规范/决策、历史 P0 证据、现有已安装 0.1.3。

**建议验收（真实 Host，须另获安装授权）：**

1. 开发 staging 安装后：Host 插件 active；`connection.fetch` 精确路由只接受 allowlist 方法/参数；Client 相对 `fetch` 通过认证；Tool schema 对模型可见但无 path/URL。
2. 受控 fixture `open/inspect`：project title/revision/尺寸/时长来自真实 worker；未知 projectId 拒绝；无任意路径/URL 入口。
3. `edit`：typed text/timing 保存成功且 revision 变化；expectedRevision 冲突不写盘；重复 operationId 语义按 worker 实际返回；超时/断管保留 `uncertain`。
4. `frame`：真实 PNG job 成功后通过 Host 路由取得字节，hash/尺寸匹配；`render`：真实 MP4 job 可 status/cancel；失败/取消不发布假 artifact。
5. 生命周期：UI 打开/关闭/切换不启动/销毁 worker；插件停用/移除时异步 dispose，worker 退出、无孤儿；重新启用后惰性启动；Host 进程退出时 worker 收尾（在授权测试范围内）。
6. 安全边界：响应不含 Host/worker 路径、stderr、源码或临时目录；请求无 path/URL；registry 只含受控 fixture。
7. 兼容/回归：`npm run check` 保持静态+smoke；新 Host 契约测试（fake WorkerClient）覆盖路由/tool 共用、错误映射、dispose；旧 0.1.3 可回滚；不改 profile 手写。
8. 未测项：console/真实模型体验/HMR 替换/Windows/Linux/Chrome/FFmpeg 缺失/失败注入等，按实际记录，不能以单元测试替代。

## 9. 未验证 / 风险与需主会话决策

- `connection.fetch` 与 `tools.register` 本轮**只做契约核对**，未在 P2-B 代码/真实 Host 中运行；路由鉴权、客户端相对路径、body 限制、artifacts 字节传输需真实安装后验证。
- **Node 启动路线未决**：真实 Node 路径 vs Electron-as-Node；`WorkerClient` 无 env/cwd seam；Host 继承 `ELECTRON_RUN_AS_NODE`/`NODE_CHANNEL_*`；需要主会话决定是否修改引擎 client（跨 owner）。
- **worker entry 解析**：worker 包无 `exports` 子路径；Host 需 Config/包解析；跨 owner 小改待批。
- **依赖分发/构建脚本**：worker 依赖 esbuild 安装脚本、pnpm pendingBuilds/approval 语义；P2 分发方案未定；本轮未安装任何依赖。
- **HMR/替换**：0.2.1 对已运行包替换/HMR 的重启语义已从 README 核实，但未真机验证 P2-B 更新路径；linked package 的依赖/构建/HMR 行为需实测。
- **Auth/权限**：精确 Fetch 路由由浏览器/API Peer 鉴权，但本提案未设计 per-project/per-session ACL；受控 fixture 阶段可接受，未来用户工程需 Host 权限模型（主会话/后续任务）。
- **安全**：worker 路径校验不是沙箱；任意 Agent 生成 HTML/JS、用户素材、符号链接竞态、OS 隔离未解决；P2 只承诺受控 fixture。
- **客户端 UI/Tool 呈现**：最小纵向样例未实现；Tool 结果对模型的可读性、frame 图片是否作为附件展示、渲染进度 UI 均未验证。
- **平台/工具**：仅本机 macOS arm64/Node 24/Chrome 155/FFmpeg 8.0.1 环境实测；Windows/Linux、Chrome/FFmpeg 缺失、字体差异未验证。

## 10. 证据清单与出处

- 版本：`Info.plist` `0.2.1-rc.1`；`app.asar` SHA-256 `f15cc450…89ee`；`dsh/package.json` `@deepseek-ai/dsh-desktop-runtime 0.2.1-rc.1`；当前 profile 依赖 `dsh-video 0.1.3`（未改）。
- Skill：内置路径 `@deepseek-ai/dsh-agent-preset/skills/`（只读解包到 `/tmp/p2002-skills/`）；归档 `docs/reference/dsh-plugin-dev-kit-20261017/skill`（16) 文件，PROVENANCE targetHost 0.2.0-rc.2）。
- Host 加载/解析：`dsh-app-boot/lib/index.js`（profile 模块注释、`collectInstallationScopePackages`/`collectProfileScopePackages`/`dependencyClosure`）；`@deepseek-ai/cordis-plugin-loader/src/config/tree.ts`（`import` 解析）；`dsh-plugin-manager/README.md`（install/rollback/replacement/HMR/linked packages/await resources）。
- 生命周期：`@deepseek-ai/dsh-hmr/README.md`；shipped `dsh-client-ui-deliverables/lib/index.js` 的 `ctx.effect(() => async () => …)` 示例；官方 Skill `host-plugin.md`（apply/Config/inject）。
- `connection.fetch`：Host `connection` Service inspection；`dsh-client-connection/lib/index.js`（`registerFetchRoute`/`assertFetchRoute`/`endpointFromPath`）；`dsh-session-log-export/lib/index.js`（`/api/session.export`）；`dsh-client-file-upload/lib/index.js` 与 `lib/client.js`（`/api/session/uploadFileBinary`、文档相对 fetch）。
- Tools：`@deepseek-ai/dsh-tools/README.md`（`defineTool`/注册/执行流水线）；Host `tools` Service inspection。
- Subprocess：Host `subprocess` Service inspection（`resolveExecutable`/`spawn`）；`profileContext` Service inspection（bundled package manager runtime）。
- Node 探针：`ELECTRON_RUN_AS_NODE=1 <app bin> -e ...`、bundled primary-runtime node 探针、`runtime/bin/node` launcher、`dsh-desktop-host/lib/{index,cli}.js`（Desktop 启动环境）。
- 引擎：`git show 3b5f6de:packages/video-engine-worker/**`、`git show 6c4b2e9:packages/video-engine-client/**` 与 `docs/research/{P1-002,P2-001}`；worker README/protocol.schema.json/errors.mjs；引擎测试基线 Node 24.14.0，当前宿主 Node 24.21.0。
- 本机工具状态：Chrome `155.0.8059.79`、FFmpeg/ffprobe `8.0.1`（只读版本查询；不作为分发契约）。

> 本记录只追加文档与提案；未修改根插件/manifest/引擎/锁/全局规范，未安装/启停/重启/改 profile/未 push。P2-B 实现的任何跨 owner 变更（engine client env seam、worker exports）都应由主会话协调后再动。
