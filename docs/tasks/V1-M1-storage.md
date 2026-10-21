# V1-M1 存储与工程生命周期 · 实现契约与任务卡

日期：2026-10-21（Asia/Shanghai）。状态：**in_progress（用户已说“开始”进入 M1）**。
工作树：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/v1-m1-storage`（分支 `codex/v1-m1-storage`，base 缓存 `origin/main` `1aabd6e`；M1 候选版本 `1.0.0-alpha.1`）。
依据：[V1.0-PLAN](../../../v1-plan/docs/plans/V1.0-PLAN.md) §5 M1 · [开发运行指南](../../../v1-plan/docs/plans/V1.0-DEVELOPMENT-GUIDE.md) · [验收矩阵](../../../v1-plan/docs/plans/V1.0-ACCEPTANCE.md) §M1 · [M0 报告](../../../v1-m0-validation/docs/research/V1-M0-report.md)（存储/路径相关结论）。
性质：**实现产品代码**（Host/worker/client/脚本），不安装、不重启 DSH、不合并 main；由实现会话改代码，Lead 评审/跑门禁/提交/staging。

## 0. 目标（M1 完成定义）

1. 工程数据根从「按版本新建的 staging 目录」迁出到**稳定用户数据根**：默认 `~/Movies/DSH Video/`，可用 `DSH_VIDEO_DATA_ROOT` 或 Loader config `dataRoot` 覆盖（外置盘）。
2. 旧 staging 工程**一次性迁移**：只复制不移动、旧目录保留、`migration.json` 记录、失败可重试、可回滚；alpha.10/alpha.11 工程迁移后可在 UI 打开。
3. registry/session-state 容错：单工程损坏 / 目录缺失只 quarantine 该工程；registry 损坏尝试恢复/备份；session-state 损坏可从备份重建，**不阻塞整桥**。
4. 每个工程「文件夹」按钮：工程菜单「在 Finder 中显示 / 复制路径」→ Host UI-only `project.path`/`project.reveal`，路径只来自 Host 权威 registry + realpath 校验；跨平台 open/reveal。
5. 上次打开工程/面板偏好持久化到 Host `ui-state.json`（不再依赖 localStorage）；保存状态可见（已保存/保存中/失败）。
6. 门禁与候选：新增/更新单测与真链；`1.0.0-alpha.1` staging 由 Lead 构建，用户真机验收。

## 1. 数据根布局（唯一权威）

```
<dataRoot>/                          # 默认 ~/Movies/DSH Video；env/config 可覆盖
├── registry.json                    # 工程登记表 {version, managed:true, projects:{id:path}, ...}
├── session-state.json               # 工程↔创作会话映射（沿用 schema v1；迁移时可合并旧文件）
├── ui-state.json                    # UI 状态：lastProjectId / layout / timeline 等（新）
├── migration.json                   # 迁移记录 {version, migratedAt, sources[], results[]}
├── projects/<projectId>/            # 工程内容（timeline/config/assets，v0.3 为 index.html+project.json）
├── asset-inbox/                     # 上传收件箱（临时，0600）
├── exports/                         # 导出产物（M1 可先建目录，M3 启用）
└── cache/                           # 派生缓存（previews/thumbs/...，可重建）
```

- Host 启动（或首个业务请求）时 `ensureDataRoot()`：mkdir -p、权限 0700、写 registry 若不存在（空 projects）、写 ui-state 若不存在。
- **worker 的 outputRoot/artifactRoot** 也必须迁到 `<dataRoot>/cache/output`（或 `<dataRoot>/cache/artifacts`），避免继续写在 staging；Host 启动时确保 managed registry 的 outputRoot 指向新位置（worker 启动读取 registry 时校验）。若 staging 固定 registry 无法改，则 Host 负责在 dataRoot 生成新的 managed registry 并把它传给 worker（`registryPath` 指向 dataRoot/registry.json）。
- 原 staging 内 `projectsRoot/assetInboxRoot/sessionStatePath/sessionCwd/artifactRoot` 降级为**迁移来源（legacy）**，迁移完成后不再写入。

## 2. 配置与启动流程

- `host/config.js` 新增可选键：`dataRoot`、`legacyDataRoots`（字符串数组，可选；迁移来源）；保留现有键做兼容（旧 staging 配置仍能启动并迁移）。
- 默认 dataRoot 解析优先级：Loader config `dataRoot` > env `DSH_VIDEO_DATA_ROOT` > `~/Movies/DSH Video`。
- `legacyDataRoots` 来源：Loader config（stage-dev 注入：已知旧 staging 根，如 alpha.11 staging）> env `DSH_VIDEO_LEGACY_ROOTS`（路径分隔符分隔）。
- 启动/首个请求流程：
  1. `ensureDataRoot()`（目录/权限/空 registry/ui-state）。
  2. 若 `migration.json` 不存在或未覆盖某 legacy root → 执行迁移（见 §3）。
  3. Host 用 dataRoot registry 作为权威；worker 的 managed registry 指向 dataRoot。
  4. UI `project.list` 返回 dataRoot 工程；`project.path` 返回绝对路径。
- stage-dev 变更（M1 内）：
  - 生成的注入 config 增加 `dataRoot`（默认 `~/Movies/DSH Video`）与 `legacyDataRoots: [<本次安装前已知 staging 路径>]`（构建参数 `--migrate-from` 或 `--legacy-data-roots` 传入；Lead 构建 alpha.1 时传 alpha.11 staging 根）。
  - 不再要求 staging 内 `projects/`、`asset-inbox/` 作为运行数据根；保留空目录仅作迁移来源/兼容。
  - `RUNTIME_PATHS` 加新 host 文件；`CONFIG_KEYS`/README 同步。

## 3. 迁移算法（幂等、可回滚）

1. 对每个 legacy root：读 `managed/projects.json`（或 `managed/registry.json` 的 registryPath）→ 工程 id→绝对路径；校验 realpath 在 legacy root 内；读 `session-state.json`（若存在）。
2. 对每个工程：若 dataRoot/projects/<id> 不存在 → 复制目录（`cp -R` 保留 mtime，或 Node `fs.cp` recursive）；生成/更新 dataRoot/registry.json 条目；已存在则跳过并记录 `skipped-existing`（不覆盖用户数据）。
3. session-state 合并：旧文件作为来源，按 `{version, projects, sessions}` 合并（同 sessionId 冲突时保留数据根已有；同 projectId 的 sessionIds 去重合并）。
4. 写 `migration.json`：`{version:1, migratedAt, sources:[{root, projects, copied, skipped, error?}], results}`；原子写。
5. 失败：单个 legacy root/工程失败不阻塞启动，记录 error；UI 后续可显示"迁移部分失败"（M1 最少日志 + 状态，不要求 UI 面板）。
6. 旧目录**不删除、不改写**；迁移失败可重跑（幂等键 = legacy root + projectId）。
7. 回滚：数据根为空/仅迁移数据时可手工删除 dataRoot 恢复旧 staging 安装；文档写明。

## 4. Host API（UI-only，Tool 不允许）

| method | params | result | 说明 |
|---|---|---|---|
| `project.path` | `{projectId}` | `{projectId, path}` | 绝对路径；只来自 dataRoot registry + realpath；UI 可展示/复制 |
| `project.reveal` | `{projectId}` | `{projectId, opened:true}` | Host `spawn`：darwin `open <dir>`、win `explorer`、linux `xdg-open`；detached/unref；失败 `E_REVEAL_FAILED` |
| `ui.state.get` | `{}` | `{version, lastProjectId, layout, timelineOpen?}` | UI 启动读取 |
| `ui.state.set` | `{patch}` | 同 get | 白名单字段；原子写；不进 revision |

- 二者加入 `REQUEST_METHODS`/`validateParams`/UI-only 分支；`source:'tool'` 拒绝（沿用 project.list 模式）。
- `project.list` 增加 `path?`（可选；仅 UI）或用 `project.path` 单独取——**推荐单独 method，避免列表泄漏路径**。

## 5. 容错

- `registry.json` 读取失败：尝试同目录 `.bak`/tmp 残留；仍失败 → Host 记为 `registryError`，以空工程表启动（不阻塞面板），UI 显示可恢复错误；**不自动清空文件**。
- 单工程目录缺失/不可读：`project.list` 该工程标 `quarantined:true`（或跳过并日志），业务请求返回 `E_PROJECT_UNAVAILABLE`，其它工程正常。
- `session-state.json` 损坏：备份为 `.corrupt-<ts>`，尝试 `.bak`；否则从空状态启动并日志（会话映射可重建，不删数据）。
- `ui-state.json` 损坏：备份后重置默认，不阻塞。

## 6. 客户端（client.js）

- 工程菜单（现有 `projectBar` 下拉）新增：「在 Finder 中显示」「复制路径」；点击调 `project.path`/`project.reveal`；失败 toast（不阻塞）。
- 顶栏保存状态：在作品名旁/菜单里显示「已保存 / 保存中 / 保存失败·重试」；数据来自 revision/请求状态（M1 最小可见）。
- 启动：`ui.state.get` 替换 `editorMemory` 上次工程恢复；`ui.state.set` 写 lastProjectId（去抖）；layout 比例可继续用 localStorage 作 fallback，但 Host 为权威（M1 至少 lastProjectId 走 Host）。
- 新增文案走 client 内联字典（中英）；locale 文件同步（如使用）。
- 不动右侧宿主对话/预览核心逻辑。

## 7. 任务分解（任务板编号）

| ID | 任务 | 主要文件 | 写作用域 |
|---|---|---|---|
| M1-01 | dataRoot/config/ensureDataRoot + worker outputRoot 迁移 | `host/config.js`、`host/bridge.js`、新 `host/data-root.js`、`scripts/stage-dev.mjs` | `host/`（config/bridge/data-root）、`scripts/stage-dev.mjs` |
| M1-02 | legacy 迁移 + migration.json + session-state 合并 | `host/data-root.js`（migration）、`host/session-state.js` | 同上 + session-state |
| M1-03 | registry/session 容错 + quarantine | `host/bridge.js`、`host/session-state.js` | host 相关段 |
| M1-04 | project.path/reveal + client 菜单 | `host/bridge.js`、`host/routes.js`、`client.js` | host 方法 + client 顶栏 |
| M1-05 | ui-state + 上次打开 + 保存状态 | 新 `host/ui-state.js`、`host/bridge.js`、`client.js` | host + client 顶栏/启动 |
| M1-06 | 门禁/重启与迁移 E2E/文档 | `scripts/check-host.mjs`、新 `scripts/test-v1-storage.mjs`、README | scripts/ + docs |

依赖顺序：M1-01 → M1-02 → M1-03；M1-04/M1-05 可在 M1-01 后并行（但同 worktree 顺序做）；M1-06 最后。**同一 worktree 同一时间仅一个写入者**（本卡由单一实现会话顺序完成）。

## 8. 验收（M1，用户真机）

见 [V1.0-ACCEPTANCE §M1](../../../v1-plan/docs/plans/V1.0-ACCEPTANCE.md)：

1. 安装候选 → 打开 Vedio Editor 正常；能看到现有工程。
2. 打开旧工程 → 改名/编辑 → 正常。
3. 工程菜单「在 Finder 中显示」→ 打开**该工程真实目录**；「复制路径」一致。
4. 重启 DSH ≥3 次 → 工程/会话映射/上次打开/面板比例保留。
5. alpha.10/alpha.11 旧工程通过迁移出现在列表，可打开；旧 staging 目录仍保留。
6. 新建工程 → 编辑 → 重启 → 仍在；无重复/幽灵工程。
7. 人为破坏 registry 单条/移走工程目录（Lead 演练）→ 只该工程显示异常，其余可用；不再整桥 `E_CONFIGURATION`。
8. 保存状态可见；数据根是 `~/Movies/DSH Video/`；无 staging 绝对路径泄漏进工程内容。

## 9. 验证命令（实现会话自测，Lead 复跑）

```sh
node --check index.js && node --check client.js && node --check host/bridge.js
node scripts/check.mjs
node scripts/smoke-client.mjs
node scripts/check-host.mjs
node scripts/test-stage-version.mjs
# 新增：node scripts/test-v1-storage.mjs （重启/迁移/容错 E2E，临时 HOME/dataRoot）
```

L3 真链需 Lead 构建 staging 后跑；真机由用户验收。

## 10. 约束与红线

- 不改 DSH/asar/profile；不安装/重启；不读宿主凭据；不碰用户数据（迁移只读源 + 写新数据根，**M1 测试一律用临时目录**）。
- 不 `reset/clean/强推`；不直接改 main；不 commit/push（由 Lead 评审后提交）。
- 不把 staging 绝对路径写进工程内容/registry；新代码不得引入 `~/.dsh` 凭据读取。
- 新增 Host 文件必须加入 `scripts/stage-dev.mjs` 的 `RUNTIME_PATHS` 与 `package.json files`（后者只列 `host/*.js` 通配已覆盖，注意确认）。
- 任何 UI 文案走现有 i18n 字典；不引第三方依赖。

## 11. 实现证据（M1 实现会话自测，2026-10-21，待 Lead 复跑/提交/staging）

实现范围（全部在本 worktree，未 commit）：

| 任务 | 文件 | 关键决定 |
|---|---|---|
| M1-01 | `host/data-root.js`（新）、`host/config.js`、`host/bridge.js`、`scripts/stage-dev.mjs`、`scripts/check.mjs` | dataRoot 优先级 config > env > 默认；两文件布局（`registry.json` 冻结 5 键 worker managed 外部配置 + `projects.json` id→path map，后者可带 version/managed 附加字段）；Session store 在构造期指向 `<dataRoot>/session-state.json`，目录/迁移在首个业务请求；`browserPath` 可选配置并在既有 registry 缺省时原子补写 |
| M1-02 | `host/data-root.js`、`host/session-state.js`、`host/bridge.js` | legacy 来源 config > env > 旧 config 路径推导；只读复制（`fs.cp` + `errorOnExist` + preserveTimestamps）、copied/skipped/errors、`migration.json` 原子写、失败源 `completed:false` 重试、Session 映射 `mergeLegacyState`（数据根优先、去重、上限 200）；旧 registry 的 `browserPath` 补入数据根 |
| M1-03 | `host/bridge.js`、`host/session-state.js`、`host/data-root.js`、`host/ui-state.js`（新） | map 损坏恢复顺序 .bak → temp 残留 → **扫描 projects/ 目录重建（source='scan'）** → 空表；corrupt 证据保留 `.corrupt-<ts>`；单工程 quarantine（`quarantined/error`）；worker registry 派生物重建；session-state 损坏备份 + .bak + 空 v1 重建；ui-state 损坏备份 + 默认重置 |
| M1-04 | `host/bridge.js`、`host/routes.js`、`client.js` | UI-only `project.path`（registry+realpath+projectsRoot 校验）/`project.reveal`（argv 形式 `spawn(cmd,[dir],{detached:true,stdio:'ignore'})`，darwin open/win explorer/linux xdg-open，`E_REVEAL_FAILED`）；client 顶栏可见文件夹按钮 + 菜单「在 Finder 中显示/在文件管理器中显示 + 复制路径」，clipboard→execCommand→失败 toast 显示路径；窄容器隐藏按钮但保留菜单项 |
| M1-05 | `host/ui-state.js`（新）、`host/bridge.js`、`client.js` | UI-only `ui.state.get/set`（白名单 lastProjectId/layout.aiPaneRatio/timelineOpen、≤64 KiB、原子写、tool 拒绝、不进 revision）；client 启动 Host 优先恢复 lastProjectId+比例（localStorage fallback），打开/切换去抖 250ms 写回 + 保存状态（保存中/已保存/失败·重试），splitter 交互 400ms 写回比例 |
| M1-06 | `scripts/check.mjs`、`scripts/check-host.mjs`、`scripts/smoke-client.mjs`、`scripts/test-v1-storage.mjs`（新）、`README.md`、本任务卡、`docs/STATUS.md` | 静态契约 +4、Host 契约 +2、client smoke +3、存储 E2E 20 条 |

自测数字（2026-10-21，临时 HOME/dataRoot；真实 `~/Movies/DSH Video` 未创建已断言）：

- `node scripts/check.mjs`：**58 passed / 0 failed**（基线 54；新增 4 条 M1 静态契约）
- `node scripts/smoke-client.mjs`：**84 passed / 0 failed**（基线 81；新增菜单 path/reveal+剪贴板、ui-state 恢复与保存状态、失败重试 3 条）
- `node scripts/check-host.mjs`：**70 passed / 0 failed**（基线 68；新增 dataRoot 权威/path+reveal argv、ui-state 白名单 2 条）
- `node scripts/test-stage-version.mjs`：**10 passed / 0 failed**（未改版本门禁）
- `node scripts/test-v1-storage.mjs`：**20 passed / 0 failed**（M1-01×5、M1-02×3 含 alpha.11 staging 副本真实迁移演练、M1-03×5、M1-04×2、M1-05×1、browserPath 回归等）

演练事实：alpha.11 staging 数据副本（只读复制到临时目录）迁移出 `demo` + `proj-mvhq5nnj-3eb8e5db`，session 映射合并成功；重复激活不重写迁移证据；单工程缺失 → partial 记录、补齐后重试 complete；旧目录 digest 前后一致。registry map 损坏（无 .bak）→ 从磁盘扫描恢复；缺 `project.json` 的目录 → quarantined。

未验证/待 Lead：真实 staging 构建与安装（stage-dev 未实跑，受“不安装”约束）、真机重启 ≥3 次、真实用户工程迁移（本次用副本）、Windows/非 darwin 默认数据根与 reveal 命令、真实大工程同步迁移耗时。


### 11.1 Lead review 修复（2026-10-21 第二轮）

1. **test-v1-storage 环境隔离**：`withTempHome` 每个场景默认清空 `DSH_VIDEO_DATA_ROOT`/`DSH_VIDEO_LEGACY_ROOTS`（需要测 env 优先级的场景在回调内自行设置），并新增「继承的外部 env 不得泄漏进默认根场景 + 场景内 env 仍优先于默认」正向用例。结果：无外部 env 与 `DSH_VIDEO_DATA_ROOT=/tmp/v1-m1-lead/gate-data` 两种跑法均 **21/21**。
2. **L3 staging harness dataRoot 适配**：新增 `scripts/lib/data-root-isolation.mjs`（能力探测：config 含 `legacyDataRoots` = M1 快照；提供临时 base、`<base>/data`、清空 legacy 至仅 staging 快照、真实数据根 baseline/断言）；`scripts/lib/conversation-harness.mjs#prepareStateRoot` 与 `scripts/test-canvas-workspace.mjs` 同名函数改为 capability-gated 的 dataRoot 布局（M1 快照：projects/output/inbox/session-cwd 全在 `<base>/data` 下，registry 写 `<base>/data/registry.json`，`legacyDataRoots: []`；旧快照保持原布局）；`test-host-engine`/`test-canvas-chain`/`test-canvas-browser` 通过 `isolateStagedConfig` 注入临时 dataRoot 并在 teardown 断言真实用户数据根未被创建/修改；conversation-chain/preview/fixture-smoke/canvas-workspace 在 finally 调 `assertStateRootIsolation` 并记录 `evidence.dataRootIsolation`。
3. **stage-dev 注入确认**：不传 `--data-root` 时 config **不含 dataRoot**（运行时默认）；`legacyDataRoots` 总是注入（显式 `--legacy-data-root/--migrate-from` + 本快照 fixture 根），不含构建机用户 home 绝对路径；`check.mjs` 增加静态断言。

第二轮门禁与 L3（alpha.11 staging，旧快照原样透传路径已回归）：

- `test-v1-storage`（无外部 env）：**21/21**；`DSH_VIDEO_DATA_ROOT=/tmp/v1-m1-lead/gate-data` 下：**21/21**
- `check.mjs` **58/58**、`smoke-client` **84/84**、`check-host` **71/71**（68 + 2 M1 + 1 L3 隔离）、`test-stage-version` **10/10**
- L3（alpha.11 staging 1aabd6e 系列 51b95dc）：`test-host-engine --staging` **ok=true**（engine 51b95dc，real Chrome/ffmpeg）；`test-conversation-chain --staging` **261/261, ok=true**；`test-canvas-chain --staging` **ok=true**；三者均 `stagingReadOnly.same=true`，真实 `~/Movies/DSH Video` 未被创建。`test-conversation-preview`（real Chrome，时长较长）本轮未跑，M1 staging 构建后由 Lead 复跑。
- 说明：alpha.11 staging 的 bridge 是旧代码、config 无 `legacyDataRoots`，因此 L3 走原布局（能力门控验证）；M1 快照的 dataRoot 路径将在 `1.0.0-alpha.1` staging 上执行同一套 harness。
