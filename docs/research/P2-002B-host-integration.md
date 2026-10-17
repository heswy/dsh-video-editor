# P2-002-B：Host 桥、真实示例编辑与开发 staging 准备

日期：2026-10-17。执行：程序员 2（原 DSH 会话），工作树 `p0-mode-shell`、分支 `dsh/p0-mode-shell`。
收到指南：`057f56c`（任务文件 `docs/tasks/P2-002B-host-integration.md`）；调查基线 `afcf57d`；实际开工 HEAD `057f56c`。实现提交：`c553b1b`（本记录随后作为文档提交）。
当前运行 Host 仍为 Desktop **0.2.1-rc.1**；已安装插件仍为 **0.1.3**，本轮**未安装/替换/启停/重启、未改 profile、未 push/merge**。

## 1. 本轮交付

| 项 | 内容 |
|---|---|
| Host half | `index.js` + `host/{bridge,config,env,engine,errors,routes,tool}.js` |
| Client half | `client.js`：侧栏入口/面板原子生命周期保留，增加受控示例打开、真实 inspect/编辑/帧/导出/取消 |
| Tool | `video_engine`（9 个 action），与 Fetch 路由共用 `VideoBridge.invoke` |
| 根版本 | `0.2.0`；根 `package.json` 仍无引擎/开发依赖 |
| 本地固定包 | `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p2-b/dsh-video-0.2.0.tgz`，37,369 B，SHA-256 `4d5d9a07c155c2df2638943279f12d9067e61ee74dfc44c9cc4ff2a57efea58b`（16 文件） |
| staging/真实引擎 | 脚本已备；**尚未运行**，等待主会话复审后的 P2-003 固定引擎提交 |
| 已安装状态 | 保持 0.1.3；未触碰 profile |

## 2. Host 接入实现

### 2.1 单一业务对象与 lazy 生命周期

- 每个插件 fiber 一个 plugin-local `VideoBridge`（`host/bridge.js`），HTTP 路由和 Tool 只持有它；业务参数、错误映射、job 归属只有一份实现。
- 模块 import / `apply` 不启动 worker；第一次明确的 `doctor/open/inspect/edit/frame/render/status/cancel/close` 请求才 `ensureClient()`。并发首批请求由同一个 `starting` promise 合并（单飞），不会并行 spawn。
- 插件停用/移除：`ctx.effect` 的异步 cleanup 先设置 `closing` 拒绝新请求，再等待已接受请求落定并 `await client.dispose()` 一次；`dispose` 幂等。UI 面板挂载/切换/返回对话**不**创建或销毁 worker。
- 旧 `WorkerClient` 若没有显式 `env`/`cwd` seam 会被配置检查拒绝（要求 engine client `>=0.1.1`），不把 `5b9032b` 当作已接清理环境的版本。
- worker 显式环境由 `host/env.js` 构造：只复制操作系统/渲染所需白名单键，不含 `ELECTRON_*`、`NODE_*`、`DSH_*`、`npm_*` 等继承项；不修改 `process.env`。cwd 必须是已存在的绝对目录。
- `workerNode` 经 `ctx.subprocess.resolveExecutable` 验证；未采用 `process.execPath` Electron-as-Node。Node 路径、registry、artifactRoot、workerCwd 全部来自可信 Config。

### 2.2 可信 Config（根 patch 仍为空 `config: {}`）

样板见 README；字段：

```json
{
  "workerNode": "/absolute/real/node",
  "workerCwd": "/absolute/private/worker-cwd",
  "registryPath": "/absolute/controlled/registry.json",
  "artifactRoot": "/absolute/output-root",
  "allowedProjects": ["demo"],
  "workerEntry": "/optional/absolute/worker.mjs"
}
```

可选上限：`startupTimeoutMs`、`requestTimeoutMs`、`shutdownTimeoutMs`、`forceKillTimeoutMs`、`maxPending`、`maxLineBytes`、`maxStderrBytes`、`maxRequestBytes`、`maxArtifactBytes`、`maxResultBytes`。缺少/未知/相对路径等配置错误 → `E_CONFIGURATION`；壳仍加载，不删除 UI。

启动前只读核对：registry 顶层键/绝对路径、非空 projects、`root` 与 allowlist 项目 realpath 包含关系、`artifactRoot` 与 `outputRoot` 同一 realpath、worker entry 存在、Node 可解析。未写入工程内容。

### 2.3 路由与 Tool

- `POST /api/dsh-video/request`：JSON `{method, params}`；Content-Type 校验、正文默认 64 KiB 上限、拒绝额外字段/未知方法；params 按 worker v1 typed 契约校验（revision 64 hex、operationId、ops ≤32/text ≤2048/timing bounds、frame time、timeout 200–120000 等）。UI/Tool 参数里没有 path/URL 入口；projectId 先过 allowlist。
- `GET/HEAD /api/dsh-video/artifact?jobId=...`：只接受一个 `jobId` 参数；`status` 复查 job 必须 succeeded，校验 UUID 文件名、realpath 在输出根、普通文件、大小 ≤ `maxArtifactBytes`（默认 64 MiB）、SHA-256 与 worker 记录一致后才返回 PNG/MP4；`no-store` + 正确 Content-Type/Length；不列目录/不代理 URL/不返回路径或 stderr。
- 错误统一 `{ code, message, stage, uncertain?, jobUnknown? }`；HTTP 状态映射见 `host/routes.js`（参数 400、未知项目/job 404、冲突 409、配置/worker 不可用 503、过大 413、完整性 500）。Host 不重试写/渲染，不缓存第二份 revision/operationId 结果。
- Tool `video_engine` 参数 `action` + typed 字段；`execute` 只经 `bridge.invoke`，返回 `{action,result}`；Tool 结果限 64 KiB，超限明确 `E_RESULT_LIMIT`；错误文本保留 code/stage/uncertain/jobUnknown，不自动变成附件或模型调用。

### 2.4 Job 归属

frame/render 成功后登记 `jobId → {projectId,revision,kind}`；`status`/`cancel`/`artifact` 先查该登记，未知旧 job/其它项目 job 拒绝；不提供持久 registry，插件重启后的旧 job 拒绝（符合 ADR-0002）。close 后的成功产物仍可读（登记保留），但 Host 在 artifact 读取时重新向 worker 取 succeeded 记录。

## 3. Client 最小真实界面

- 无工程仍是一句「尚无工程」；增加一个明确的「打开示例」（固定受控 id `demo`，不对 request 暴露路径）。
- 打开成功后主体显示来自真实 `inspect` 的标题（text element）、尺寸/时长；自动请求当前 revision 的真实 PNG（`artifactUrl(jobId)`），不显示演示数据。
- 提供标题输入、start/duration 输入、更新画面、导出 MP4、取消；字段错误/冲突/配置/网络/worker 错误就近显示；编辑后重新 `inspect` 并用新 revision 取帧，取帧前清掉旧帧，旧帧不会冒充新 revision。
- 导出只显示真实 job state/progress/取消/成功后下载链接；不显示 revision 哈希、路径、版本或开发阶段常驻文案。详细 stableId/capabilities 在按需展开的属性区。
- 保留原生侧栏 id/order/label、面板/入口原子 pair、返回对话、显示选项菜单与减少动效；面板切换时 UI 保留可见工程/草稿/帧/job 的 bounded view memory，运行中 job 恢复轮询；worker 仍是唯一内容权威。无时间线/连续预览/AI 生成按钮。

## 4. 本地验证（实际执行）

```sh
npm run check
```

2026-10-17 本机结果：

- `scripts/check.mjs`：**29 passed, 0 failed**（manifest/patch/exports/files/locale/侧栏原子生命周期/显示菜单/空状态/真实编辑器范围/无开发绝对路径/Host 无 DSH 内部 import 等）。
- `scripts/smoke-client.mjs`：**38 passed, 0 failed**，包含 P2-B 新增：无工程不自动请求；打开示例固定 id + 真实标题/帧；edit expectedRevision/operationId/typed ops + 新 inspect；revision 冲突不覆盖；旧帧在更新期间清空；render/cancel 结构化状态；配置错误壳可用；面板重挂载恢复可见工程且不重复 open。
- `scripts/check-host.mjs`：**16 passed, 0 failed**，覆盖配置缺失/绝对路径/registry 与 artifactRoot 一致性、allowlist/额外参数、typed edit、单飞 start、job 归属、artifact 文件/根/大小/SHA/越界/未成功、路由 body/错误状态、dispose 拒绝新工作并等待、启动失败重试、Tool 共用 dispatcher、engine 包从安装 bundle 上下文解析、apply 注册两路由+一 Tool。

这些都**不是** DSH 真实激活、真页面或真实引擎子进程证据；staging/真实引擎链未执行。

## 5. staging 与真实引擎（未执行）

- 新增 `scripts/stage-dev.mjs`：要求干净根 worktree + 指定 `--engine-commit <reviewed-P2-003-sha>` + 真实 Node（及可选 Chrome/font），通过 `git archive` 取固定根/引擎快照；校验 engine client/worker 版本 0.1.1、worker `./worker`/`./package.json` 导出；`npm ci --ignore-scripts` 准备 worker 依赖闭包（记录 esbuild 二进制缺失/不运行 postinstall），准备受控 fixture，写快照专属 `config.json`、`INTEGRITY.json`，并在**快照副本** patch 注入可信 config + 本地依赖/链接（根提交 patch 仍 `config: {}`）。
- 新增 `scripts/test-host-engine.mjs`：通过同一 `VideoBridge` 在真实 staged engine 子进程上跑 doctor→open→inspect→text/timing edit→inspect→frame/status→PNG 字节→render/status→MP4 字节→取消→close→dispose，证据写到 staging 同级 `evidence/`（不修改不可变快照）。
- **本轮没有运行上述两个脚本**，也没有生成任何 staging 目录：主会话尚未给出复审通过的 P2-003 固定 commit；按指南不能把 5b9032b（无 env/cwd seam）当作最终 staging。没有真实引擎子进程、PNG/MP4 证据，也没有安装。

## 6. 未验证 / 限制 / 下一动作

- 真实 DSH 安装后的路由鉴权、Tool 模型可见性/结果体验、加载/卸载/重启、HMR 替换、真实页面视觉/键盘/明暗/窄窗/草稿保持、artifact 字节实际读取：均未执行；需要安装授权。
- 真实引擎链、Chrome/FFmpeg/Node 24.21.0 的实际 doctor/PNG/MP4/取消：等待 P2-003 复审固定提交后 staging + `test-host-engine`。
- 无 per-session ACL、无多用户工程隔离、无 OS 沙箱；受控 fixture 限制不变；artifact 不支持 Range/连续预览。
- 根包不是正式可移植发行 tarball；staging 的相对 `file:` 依赖/链接只对该快照有效；正式发行、Windows/Linux、构建脚本/依赖分发另立任务。
- 0.1.3 回滚保持当前安装不动；0.2.0 包/代码先交主会话复审。

## 7. 文件清单

根：`index.js`、`client.js`、`package.json`、`README.md`、`host/bridge.js`、`host/config.js`、`host/env.js`、`host/engine.js`、`host/errors.js`、`host/routes.js`、`host/tool.js`；检查/staging：`scripts/check.mjs`、`scripts/smoke-client.mjs`、`scripts/check-host.mjs`、`scripts/stage-dev.mjs`、`scripts/test-host-engine.mjs`。未修改 `packages/video-engine-*`、`spikes/**`、锁文件、全局规则/决策或历史证据。
