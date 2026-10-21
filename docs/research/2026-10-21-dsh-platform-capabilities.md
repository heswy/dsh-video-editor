# DSH 宿主平台能力审计（下一大版本预研）

> 审计对象：本机安装的 DeepSeek Harness 桌面 App（`/Applications/DeepSeek Harness.app`，`app.asar`）与当前 `desktop` profile（`~/.dsh`），基线 worktree `next-major-research`（origin/main `9b0928e`，2026-10-21）。
> 方法：**只读**。asar 用 Node 解析 8 字节 pickle header + JSON 目录后按 offset 取文件，全部临时文件只写 `/tmp/dsh-asar`；仓库/宿主源码用 `read` 读取；未修改 App、`~/.dsh`、profile，未重启 DSH、未安装依赖。
> 版本注记：仓库 `docs/reference/dsh-plugin-dev-kit-20261017` 是 **0.2.0-rc.2**（2026-10-17 导出，`VERSION.txt:4`），本机已升级到 **0.2.1-rc.2**，读宿主行为时以 asar 实际代码为准。文中【文档】=官方 README/Skill 原文，【源码】=asar/仓库代码，【实测】=本次实际运行命令或读取本机文件。

## TL;DR（≤15 行）

1. 宿主：Desktop App `0.2.1-rc.2`、运行时 Node 24.21.0 / pnpm 11.28.5 / Cordis 4.0.5、`hostProtocolVersion: 4`；插件运行时契约 = `dsh.manifestVersion:1` + `dsh.bundle.patch` + `dsh.client(platform:web)` + `window.__ModuleLoader__`。
2. **@ 引用可在原生 Composer 扩展**：客户端有 `ctx.inputTriggers.registerSource()`，跟官方 `@file/@session` 是同一机制；插入的是 chip + 普通文本，模型只看到序列化文本。**非文档化 API，需 spike 验证**。
3. chip 的 `appearance` 在持久化 schema 里只允许 `session|file|folder`；自定义片段引用应复用 `file/folder` 外观或省略图标。
4. **打开工程文件夹可行且低风险**：插件 Host 直接 `child_process.spawn('/usr/bin/open', [dir])`（Host 代码运行在 DSH 进程内、不受 bash 沙箱限制）；DSH 自身也这么干（`revealNativePath` → `open -R`）。
5. 另有官方 Remote `session/openWorkspacePath`（`action:'reveal'` → Finder，Host 侧校验路径），但属客户端内部 Remote，稳定性弱于自建 Host 路由。
6. **音频播放**：插件面板是普通 DOM，可 `<audio>`/`new Audio()`；未发现 CSP 限制（仅 `/api/file` 响应自带 sandbox CSP）。聊天里音频附件只有"通用文件卡片"，无播放器（`dsh-attachment` 明确 audio/video 无专门处理）。
7. DSH **没有任何 TTS/音乐/音频生成能力**（只有 STT 语音输入）；provider 配置只含 text/image 输入。生成音频要走插件自有 Provider/本地 `say`+ffmpeg，不能"复用宿主模型凭据"。
8. **持久化只信 Host 文件**：`localStorage` 会丢——desktop Host 以 `--port 0` 启动（`dsh-desktop-host` 固定 `--port 0`，OS 随机端口；dev-kit 记录 19387、本次实测 61275），origin 变化即清空 localStorage；跨重启数据必须落盘（`$DSH_HOME` 下或工程目录）。
9. 稳定可用的公开 API：`ctx.slots`、`--dsw-*` 主题 token、`connection.fetch`(`/api` 鉴权)、`ctx.tools.register`、`ctx.logger`、`ctx.effect/on`、`ctx.subprocess`；其余（`ctx.remote`、`inputTriggers`、`uiSession`、`sidebarRight`）是内部 API。
10. 最大风险：nightly 通道 + 4 天内 `0.2.0-rc.2→0.2.1-rc.2`，插件 API 无 semver 契约；大版本应把"内部 API 依赖"集中隔离在薄适配层并准备 fallback。

---

## 一、宿主版本与环境事实

| 事实 | 值 | 证据 / 验证方式 |
|---|---|---|
| App 版本 | `0.2.1-rc.2` | `Info.plist` `CFBundleShortVersionString`（PlistBuddy 实际运行） |
| 运行时包 | `@deepseek-ai/dsh-desktop-runtime@0.2.1-rc.2`，依赖 300+ 个 `@deepseek-ai/dsh-*@0.2.1-rc.2` | `app.asar/dsh/package.json:4,6-311`（读源码） |
| 运行时描述 | `version 0.2.1-rc.2`, `hostProtocolVersion 4`, `nodeVersion 24.21.0`, `pnpmVersion 11.28.5`, darwin/arm64 | `app.asar/dsh/desktop-runtime.json`（读源码，文件有 2 字节前缀需跳过） |
| Cordis | `@deepseek-ai/cordis@4.0.5`，loader/include/group/timer 为 1.x | 同上 `dsh/package.json:7-12` |
| 插件运行时契约 | 包 manifest `dsh.manifestVersion:1`、`dsh.bundle.patch`、`dsh.client{platform,immediately,inject,external}` | `skill/cordis-plugin-development/references/host-plugin.md:5-27,47-60`；`ui-plugin.md:7-13`；本插件 `package.json` `dsh` 段 |
| Client bundle 加载 | Host 扫描 loader 行 → 组合 boot graph → `/plugins/...` 提供组合脚本；浏览器 `window.__ModuleLoader__.load({id, factory(require)})`，id 必须等于包名；仅平台 seed 表（react 等）与已注册 factory 可 require | `dsh-client-modules/README.md:13,35,49-51,85`（文档）；`dsh-client-ui-input-trigger/lib/client.js:1-10`（读源码） |
| Profile | `DSH_PROFILE=desktop`、`DSH_PROFILE_DIR=~/.dsh/profiles/desktop`、`DSH_HOME=~/.dsh`、`DSH_WEB_URL=http://127.0.0.1:61275` | shell `env` 实际运行输出 |
| Profile 组成 | bundles：dsh-base、dsh-web-app、agent-team、auto-review、voice-input、dsh-context、inspector、dsh-codex、dsh-video；dsh-video 以 `link:` 指向 staging bundle | `~/.dsh/profiles/desktop/package.json`（实际文件） |
| 已装插件 | `dsh-video` symlink → `.../artifacts/p2-b/staging-alpha10-1cceb96/bundle`；bundle patch 一行 `id: dsh-video`，config 全是绝对路径（workerCwd/projectsRoot/assetInboxRoot/sessionStatePath…） | `~/.dsh/profiles/desktop/node_modules/dsh-video` → `cordis.patch.yml`（实际文件） |
| `~/.dsh` 目录 | `attachments/ cache/ dsh-runtimes/ inbox/ llm-deepseek/ profiles/ sessions/ skills/ storages/ workspace-sync/` + `.credentials.yaml`、`.openai-codex-auth.json` | `ls ~/.dsh`（实际运行；只读，未打开凭据内容） |
| storages 现状 | `workspace.json`（domain unit，`version:2`）、`dsh-game-market/` 自有目录、`session_projcache/` 等 —— 第三方插件把自有 JSON 放 `$DSH_HOME/storages/<name>/` 有先例 | `~/.dsh/storages/`（实际运行）；`dsh-storage-json/README.md:39-47` |
| 更新通道 | electron-updater generic feed，`channel: nightly`，`https://download.deepseek.com/dsh-desk/feeds/mac-arm64/`（用 curl 拉 latest-mac.yml 返回 404，未能读到在线 release notes） | `app-update.yml`（实际文件）；curl 实际运行 |
| 宿主进程 | Electron 主进程 spawn `node --expose-internals .../dsh-desktop-host/lib/index.js`，固定传 `--no-open --host 127.0.0.1 --port 0`，ready 后回传 `authenticatedUrl` | `app.asar/lib/main.js:3794-3812`；`dsh-desktop-host/lib/index.js:220-252,343`（读源码） |
| 浏览器安全边界 | 所有 BrowserWindow/WebContentsView：`sandbox:true`、`contextIsolation:true`、`nodeIntegration:false`、`webSecurity:true`、`webviewTag:false` | `app.asar/lib/main.js:6842-6849,8613-8619,10157-10163,10555-10562`（读源码） |
| 未验证 | 在线 release notes / 下一版计划；`cordis_inspect_*`（外部 Agent 无此工具，拿不到运行期 SlotMap） | — |

---

## 二、能力矩阵

| # | 能力 | 可用性 | 证据（asar 内路径 / 仓库路径均相对可读） | 风险 |
|---|---|---|---|---|
| 1 | 原生 Composer `@` 菜单扩展（自定义 source） | ✅ 有机制，⚠️ 内部 API | 客户端服务 `ctx.inputTriggers`（`super(ctx,"inputTriggers")`, `registerSource(src)` 唯一 `(trigger,name)`）：`dsh-client-ui-input-trigger/lib/client.js:1528-1605`；官方 `@file/@session` source 注册示例：`dsh-client-ui-reference/lib/client.js:295-369`（`trigger:"@"`、`candidates`、`onPick→{insert}`、`codec.serialize`、`ctx.effect(()=>inputTriggers.registerSource(source))`）；菜单行为文档：`dsh-client-ui-input-trigger/README.md:13,29-35` | API 未在官方插件文档承诺；`appearance` enum 受限；chip 持久化/恢复由 ui-conversation 校验 |
| 2 | 把引用 chip 序列化成发给模型的文本 | ✅ | 提交路径 `inputTriggers.serializeReference(source, ref)`：`dsh-client-ui-conversation/lib/client.js:15471-15522`；draft schema `appearance` 仅 `session\|file\|folder`：同文件 `4339-4355`；chip 节点：`13659-13730` | 自定义 scheme 文本模型默认不懂，需 system prompt + Tool；不能伪造 `dsh-session:` 语义 |
| 3 | 原生 `@file` 已覆盖的文件范围 | ✅（仅 session cwd） | provider 以 agent 的 session cwd 为根、有排除目录与 5 万条上限：`dsh-file-reference-local/README.md:29-55,121-131`；服务/语法：`dsh-file-reference/README.md:13,31-41`；Remote 入口 `ctx.remote.fileReferences.list` | 工程素材若不在 session cwd 内，原生 @ 看不到；跨命名空间无 provider 替换点（`ctx.fileReferences` 单例抽象服务，provider 包独占挂载） |
| 4 | 从插件 UI 打开工程文件夹（Finder） | ✅ 推荐自建 Host 路由 | Host 侧 spawn 先例：`dsh-native-command/lib/index.js:261-283`（macOS `open -R <path>`）；DSH 的 `open-in-app` 目录启动路由接受绝对目录且 catalog 有 `finder`：`dsh-host-open-in-app/lib/index.js:1133,1321-1402`、`lib/types/catalog.js:75-80`；插件已具备鉴权路由与工程 allowlist：仓库 `host/routes.js:12-13`、`host/bridge.js:816-895` | 必须 Host 侧解析 path（禁止 UI 传任意路径）；`open <dir>` 无返回值 = 成功不可观测；需注入 `PATH`/`open` 绝对路径 |
| 5 | 官方 Remote 打开/定位路径（含 Finder reveal） | ⚠️ 可用但内部 API | `session/openWorkspacePath`（`action:'reveal'` 或默认应用；Host 侧 `verifyDesktopPath` 校验 fs 映射）：`dsh-api-session-controller/lib/types/index.js:399-470`，wire schema `lib/typert.host.js:738-750`；浏览器调用方：`dsh-client-ui-open-in-app/lib/client.js:450,472` | Remote 名/wire 可能随版本变；插件面板不在 session 作用域内时目标 session 语义含糊；需 `ctx.remote`（内部服务） |
| 6 | 插件面板内播放工程音频 | ✅ 可行 | 面板是 stdout slot 里的普通 React/DOM（本插件已是）；无全局 CSP（index.html 无 CSP meta：`dsh-web-frontend/dist/index.html`；asar 中唯二 CSP 在 `dsh-api-session-controller/lib/types/media-references.js:12-17`，只给 `/api/file` 响应加 `sandbox;default-src 'none'`）；静态资源必须自建路由：`dsh-host-webserver/README.md`：register/fallback 只认命名路由与 SPA fallback（第 3 节『Registering routes』），不提供任意静态目录服务 | 若走 `/api/file`：上限 `maxImageBytes 20MiB`、**不支持 Range**（`media-references.js:20-62`，一次读全量）→ 大音频/拖动进度会失效；自建 exact `webServer` 路由需自己做 Range/鉴权 |
| 7 | 聊天里播放音频/视频附件 | ❌ 无原生播放器 | `dsh-attachment/README.md:13,41,119,135-137`：非图片文件一律"通用文件"（存字节 + 给模型一行 path），**audio/video 无专门处理**；`dsh-client-ui-attachment/README.md:29-39,53` 渲染范围 = 图片 + 文件卡片 + lightbox，无播放器组件 | 插件无法改宿主附件渲染（不碰 DOM）；只能自建面板播放器或自定义 user-text/chat 节点 |
| 8 | 持久化 API | ⚠️ storageDomain 存在但插件难直接用；✅ 自有文件 | `ctx.storageDomain`（defineDomain+zod，需 import `@deepseek-ai/dsh-storage-domain`）：`dsh-storage-domain/README.md:29-74`；`ctx.storage` 需配 backend：`dsh-storage/README.md:31-60`；工程数据现状=插件自己的 JSON/目录（`host/session-state.js`、staging `cordis.patch.yml` 的 projectsRoot）；`$DSH_HOME` 解析：`dsh-home-paths/README.md:35-42` | profile 安装的路径包无法 import `@deepseek-ai/*`（AGENT-BRIEF §4）；`--port 0` 导致 localStorage 跨启动丢失；工程若放 staging/artifacts 下，重装即丢 |
| 9 | Tool 注册 / 审批 / 取消 / 长任务 | ✅ | 注册 `ctx.tools.register(defineTool({...}))`、schema/pipeline/取消 `exec.signal`：`dsh-tools/README.md:31-62,86-91,125-127`；本插件实际用法：仓库 `index.js`（`inject:['connection','tools','subprocess']`）+ `host/tool.js`；审批由 permission preset 决定（当前 profile 默认 `danger-full-access/approval:never`）：`~/.dsh/profiles/desktop/cordis.patch.yml`；长任务/取消：`dsh-jobs/README.md:10-30`；"一个操作两个调用方"规范：`user-actions.md:5-13` | Tool 一旦注册即对模型可见；长任务需自己实现取消与清理；审批不可由插件 UI 代替 |
| 10 | 宿主生成音频/TTS/音乐 | ❌ 无 | 全量包名筛查无 TTS/music/audio-generation 包；仅 STT：`dsh-experimental-speech-to-text/README.md:8-25`、`dsh-experimental-voice-input-bundle/README.md`（且该 bundle 已在 desktop profile 启用）；provider 仅 text/image：`~/.dsh/profiles/desktop/cordis.patch.yml`（llm-pi-ai models `input: [text,image]`） | 不可复用宿主模型凭据做音频；合规上不应读取 `~/.dsh/.credentials.yaml`；外部 TTS 需用户自备 key/endpoint |
| 11 | 宿主版本演进稳定性 | ⚠️ 中高风险 | 4 天内 dev-kit `0.2.0-rc.2`（`docs/reference/.../VERSION.txt:4`）→ 本机 `0.2.1-rc.2`；nightly 通道（`app-update.yml`）；官方文档明示"installed Harness is the authority / APIs are versioned and drift"（dev-kit `VERSION.txt:14`、`practices.md:1-3`） | `ctx.remote`/`inputTriggers`/`uiSession`/`sidebarRight`/`connection.fetch` 均非文档化长期 API |

---

## 三、按 5 项需求的推荐路径

### 需求 4（@ 引用片段/素材）——推荐"原生 @ 菜单加一个 source"+ Host 解析层

- **UI 侧**（client bundle 内，不碰宿主 DOM）：
  1. `ctx.get('inputTriggers')` 取服务；`ctx.effect(() => svc.registerSource({ trigger: '@', name: 'video-clip', order, candidates, header, onPick, codec, lexicon }), '...')`。候选来自插件自己的鉴权路由（`connection.fetch` 或在 `package.json dsh.client.inject` 里声明 `@deepseek-ai/dsh-client-ui-input-trigger` 以获得激活顺序）。
  2. `onPick` 返回 `{ insert: { source:'video-clip', ref:'…', label:'片段名', appearance:'file'|'folder', clipboardText:'@片段名' } }`。**appearance 必须落在 `session|file|folder` 内**（否则 draft schema 拒绝持久化）。
  3. `codec.serialize(ref)` 输出模型可读文本，推荐形如 `@[片段:开场](dsh-video:clip/<projectId>/<clipId>)` 或简单 `@clip/<projectId>/<clipId>`。
- **Host 侧**（让模型"懂"引用、且真能取到元数据）：
  1. 在 Tool 里加 `action: 'describe_reference'`（复用现有 `video_engine` dispatcher，避免第二个 Tool 占 prompt）；schema 用 `defineTool` 的 DSL。
  2. `ctx.systemPrompt.section()` 注入固定语法说明（当前工具链里已有该扩展点，见 `practices.md:18` "Add prompt text with ctx.systemPrompt.section()"）。
  3. 可选增强：`agent/pre-step` 监听器解析 mention 并注入素材元数据（官方 session-reference 就是这么做的，`dsh-session-reference/README.md:33,88-90`）；**这条属于强扩展点，改动 `decision` 需 spread，且必须回退 `next()`**（`practices.md:16`）。
- **素材库页面**（需求 3）可直接复用同一份 Host 候选接口；页面渲染用已有 `sidebar.panellist + main` slot 形态（仓库现状），不需要 iframe。
- 限制/未验证：`inputTriggers.registerSource` 对第三方 bundle 是否在 `immediately:true` 加载下可用，需 1 次真实 spike；若不可用，退化方案 = 用户手打 `@clip/...` 纯文本 + Tool 解析（零 UI 风险）。

### 需求 5（工程"文件夹"按钮）——推荐插件自建 Host 路由，不依赖 DSH 内部 Remote

- `POST /api/dsh-video/open-project-dir { projectId }`（挂在现有 `connection.fetch` 鉴权 `/api` fence 内，`host/routes.js` 同款）。
- Host：`projectId → 工程目录` 只能来自 Host 权威（managed registry / projectsRoot realpath 校验，已有 `discoverManagedProjects`/`projectDirectoryCache`，`host/bridge.js:816-895`）；校验目录存在且 realpath 在 projectsRoot 内 → `child_process.spawn('/usr/bin/open', [dir], { detached:true, stdio:'ignore' }).unref()`。
- 安全边界：UI 永不传路径；同一工程 id 只能打开其登记目录；不做 `open -a` 任意应用；失败以稳定错误码回传。
- 备选（不建议作为主路径）：客户端 `ctx.remote.session.openWorkspacePath({action:'reveal', path})`（`index.js:399-470`）——官方已实现 Finder reveal 与 Host 侧路径校验，但依赖内部 Remote 且 panel 不在 session 作用域内时语义不明。
- 未验证：`open` 异步成功不可观测（进程退出码即成功）；工程目录若在 iCloud/外置卷上的行为未测。

### 需求 1（生成音频接入）——插件自有 Provider，别指望宿主

- 宿主 **没有** TTS/音乐生成；provider 只有 text/image（见能力矩阵 #10）。因此方案只能是：
  1. **MVP 本地 TTS**：Host 调 macOS `say -v <voice> -o out.aiff`（本机实测 `/usr/bin/say` 可用，测试文件 27,830 B AIFF-C），再 `afconvert -f m4af`/`ffmpeg` 转 m4a；零网络、零 key，产物进工程 `assets/`，天然可被预览与导出链路消费。
  2. **外部 TTS/音乐 API**：Host 侧 adapter（endpoint/model/key 走插件 `Config`，用户自填），产物同样落 `assets/`；不要读取 `~/.dsh/.credentials.yaml`，也不要假设宿主 llm key 可换取音频能力。
  3. 若宿主将来提供音频生成：通过能力探测（`ctx.get('llm')` 输出模态 / 新 Tool）再接入，不在大版本依赖它。
- 音频进导出链路：worker 侧 ffmpeg 混音（现有 worker 已用 ffmpeg），属于插件内新增，不需要宿主能力。

### 需求 2（音频播放）——插件面板内播，聊天不承诺

- 面板：`<audio controls src="api/dsh-video/audio?assetId=...">`（同源、带 cookie）或标签页内 `new Audio(url).play()`（用户点击后调用，规避 autoplay 策略）。自建 exact `webServer` 路由（参考 `host/snapshot.js:95-135` 的做法）以绕开 sandbox iframe 的鉴权 fence，并实现 `Range`（音频拖动进度条需要）。
- 若图省事走 `/api/file?path=`：上限 20MiB、无 Range（`media-references.js`），只适合短音效；**不推荐用于工程原声**。
- 聊天内：DSH 无音频播放器；插件不要读宿主 DOM/替换 app root（`practices.md:33-38`）。若要"AI 引用音频片段"，靠 `@` 文本 + Tool，音频本身在插件面板播放。
- 未验证：Electron/Chromium 对插件页的 autoplay 是否默认限制；建议所有 `play()` 只在用户手势里调用（保守即可）。

### 需求 5（持久化复核）——Host 文件是唯一权威

- **不要用 localStorage 存业务数据**：desktop Host 每次启动 `--port 0`（`dsh-desktop-host/lib/index.js:236-240`），GUI origin 的端口每次可能变化（dev-kit `AGENT-BRIEF.md` 记录的 GUI 端口是 `19387`，本次会话实测 `61275`），origin 变了 localStorage 即不可见；本插件 README 也只在"浏览器偏好"层面使用 `localStorage['dsh-video.ui.v1']`。
- 工程数据建议：`$DSH_HOME/storages/dsh-video/projects/<projectId>/`（第三方先例：`~/.dsh/storages/dsh-game-market/`），或用户可见工作目录（便于"文件夹"按钮）；二者都要写 manifest（version/schema）并原子写。
- `sessionStatePath`（工程↔会话映射）继续用 Host 绝对路径 + 原子写；profile 覆盖层（cordis.patch.yml）在升级后保留，但**当前 bundle patch 把 staging 绝对路径写死**，大版本应把默认路径改为 `$DSH_HOME` 派生并只允许显式覆盖。
- `ctx.storageDomain` 是可用的"正规"持久化，但第三方路径包不能 import `defineDomain`（zod schema 包），所以除非把 storage-domain 作为真实 npm 依赖装进 bundle，否则自管 JSON 更实际。
- 宿主重启语义：插件 Host 代码随 profile 重新 apply，客户端 bundle 由 `/plugins` 重新下发；内存状态不保留，文件保留。会话历史在 `~/.dsh/sessions/*.jsonl`（宿主所有），插件不得 append 新事件类型（`practices.md:21`）。

---

## 四、风险与不确定

1. **内部 API 漂移（最高）**：`ctx.inputTriggers`、`ctx.remote`、`ctx.uiSession`、`ctx.sidebarRight`、`connection.fetch.register` 都不在官方插件文档/Skill 的承诺面内；nightly 通道下版本间隔可到 4 天。缓解：所有内部 API 调用集中到 `client.js` 的 2-3 个 adapter 函数 + 启动自检降级；升级后立刻重跑 `scripts/smoke-client.mjs` 与真机验收。
2. **@ 自定义 chip 的持久化约束**：appearance enum 只有三种；`ref/clipboardText` 必须保持 draft 文本一致；未知 appearance 会把草稿判为非法（用户草稿可能被丢弃）。
3. **模型不理解自定义 mention**：必须配 system prompt + Tool，并处理"用户手打但不选菜单"的宽容解析；不可把 `dsh-*:` 自定义 scheme 交给宿主 session-reference 解析（它只认 `dsh-session:`）。
4. **音频路由**：`/api` fence 会拒绝 sandbox/opaque origin 子资源（本插件 snapshot 已踩过，见 `host/snapshot.js:95-108`）；若把播放器放进 sandbox iframe 会 403，放主面板则无此问题；自建 exact 路由要自己防目录穿越 + 能力化 id + Range。
5. **打开文件夹的权限面**：Host 内 `spawn('open')` 无审批（插件安装即授权），必须在 Code Review 层面把"可打开目录集合"限定为工程登记目录；不能把 `open` 做成通用"打开任意路径"工具，否则等于绕过审批的本地执行面。
6. **版本升级导致现有 alpha 行为失效**：0.2.1-rc.2 已出现 `fileLink` DOM/交互变化（P3-022 修复即依赖宿主 DOM `[class*="fileLink"]`）；大版本不要新增宿主 DOM 依赖。
7. **未验证清单**：第三方 client module 能否 `ctx.get('inputTriggers')`（需 spike）；`session.openWorkspacePath` 在 panel 上下文的可用性；Electron autoplay 策略；DSH 在线 release notes / 下一版 API 变更（curl feed 404）；`cordis_inspect_query` 结果（外部 Agent 无工具）。

---

## 五、参考文件路径清单（证据索引）

宿主 asar 内（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/`）：
- `dsh/package.json`、`dsh/desktop-runtime.json` — 版本/协议/共享包版本
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-input-trigger/{README.md,lib/client.js}` — `ctx.inputTriggers`、`registerSource`、菜单行为与限制
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-reference/{README.md,lib/client.js}` — 官方 `@` source 完整样例（trigger/candidates/onPick/codec/openReference）
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js` — chip schema `4339-4355`、提交序列化 `15471-15522`、输入 shell `14899-15330`
- `dsh/node_modules/@deepseek-ai/dsh-file-reference*/` — `@file` 语法/服务/provider
- `dsh/node_modules/@deepseek-ai/dsh-session-reference/README.md` — 自定义 mention 的 Host 语义（canonical URI + pre-step 快照）
- `dsh/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/index.js`、`lib/typert.host.js`、`lib/types/media-references.js` — `openWorkspacePath` Remote、`/api/file`
- `dsh/node_modules/@deepseek-ai/dsh-host-open-in-app/`、`dsh-client-ui-open-in-app/`、`dsh-native-command/` — Finder/open/reveal 的官方实现
- `dsh/node_modules/@deepseek-ai/dsh-attachment/README.md`、`dsh-client-ui-attachment/README.md`、`dsh-attachment-local/README.md` — 附件结构、音频无专门处理、20MiB/存储路径
- `dsh/node_modules/@deepseek-ai/dsh-storage*/README.md`、`dsh-home-paths/README.md` — 持久化与 `$DSH_HOME`
- `dsh/node_modules/@deepseek-ai/dsh-tools/README.md`、`dsh-jobs/README.md`、`dsh-experimental-speech-to-text*/README.md` — Tool/长任务/STT
- `dsh/node_modules/@deepseek-ai/dsh-host-webserver/README.md`、`dsh-host-frontend-static/README.md`、`dsh-web-frontend/dist/index.html` — 路由/静态资源/无 CSP meta
- `lib/main.js`（asar 根）、`dsh-desktop-host/lib/index.js`、`app-update.yml` — Electron 安全配置、`--port 0`、nightly 通道

本机（只读）：`~/.dsh/profiles/desktop/{package.json,cordis.patch.yml,node_modules/dsh-video}`、`~/.dsh/storages/`、`~/.dsh/dsh-runtimes/dsh-primary-runtime/runtime.json`

仓库：`docs/reference/dsh-plugin-dev-kit-20261017/{VERSION.txt,AGENT-BRIEF.md,skill/cordis-plugin-development/{SKILL.md,references/*.md}}`、`index.js`、`host/routes.js`、`host/bridge.js`、`host/snapshot.js`、`host/engine.js`、`README.md`、`docs/STATUS.md`
