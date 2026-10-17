# P3-004 协议 schema 补齐（R1）与引擎预览快照

日期：2026-10-17。执行：p1-engine 工作区；工作树 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p1-engine`，分支 `codex/p1-engine-spike-b4bf`；功能基线 `aae05e9`，开工 HEAD `929ff37`（仅 AGENTS 入口文档提交前移，未 reset）；协调记忆读取自 `origin/codex/project-foundation` @ **12f9952**（2026-10-17 fetch，未 merge、未切换分支）；实现提交 **`5cc3ad8`**（`feat(engine): complete protocol schema and add preview snapshots`），并按独立复核结论补强 **`df4b74f`**（`fix(engine): harden preview privacy and schema path rules`）；固定包与证据按 `df4b74f` 生成。本轮只改 `packages/video-engine-worker/**`、`packages/video-engine-client/**` 及其测试/README/schema 与本任务、研究记录；未改根插件、`spikes/**`、全局规则/STATUS/决策；未改 profile、未安装/启停/重启 DSH、未 merge、未调模型 API；HyperFrames 固定 0.8.167，依赖与锁文件未变。

## 结论（先行）

1. **R1 完成。** `protocol.schema.json` 从 P2 的 10 个方法补齐为 **22 个 v1 方法、85 个 `$defs`**（draft 2020-12，`$id` 不变）：每个方法有严格 params（`additionalProperties:false` + `required` + 类型/范围/pattern）与 result 定义；响应帧本身不带 method，因此顶层 `x-methods` 把方法名映射到 request/result 定义。新增 `test/schema.test.mjs` 强制 schema 方法集 == worker switch 方法集、所有 `$ref` 可解析、README 方法表同步，并对每个方法做“缺必填字段/多传字段”双向探针 + 真实响应结果校验，防止再次漂移。
2. **预览快照落地。** 新增 `preview.snapshot {projectId, revision, ttlMs?}` / `preview.release {snapshotId}`：仅已 open 工程、revision 必须等于当前；worker 把 entry + 声明资产复制到 `outputRoot/previews/<snapshotId>/`，重读磁盘核对字节/`sha256` 后才发布；返回只含相对路径的 manifest 与 `expiresAt`/`maxBytes`。TTL 默认 10 分钟、上限 30 分钟；`close`/`shutdown`/EOF/信号与 worker 启动 sweep 都会清理私有副本。
3. **顺手修复 registry 失败恢复。** `project.create` 改为 registry 最后写；成功后失败路径删除目录、内存映射并在需要时回滚。故障注入测试覆盖 `open` 失败与 registry 写入失败，重启后不再出现 `E_CONFIGURATION`。
4. **交付数字：** worker 单元/契约 **29/29**、真实链 **10/10**、client **18 pass + 1 opt-in skip / 19**；两包 **0.2.1** 固定包逐字节与 `df4b74f` 一致（见下）。未接入 Host、未安装；画布渲染/播放与 Host 资产路由仍属 P3-005。

## R1：协议 schema 落地

| 项 | 0.2.0（P3-003 复审发现） | 0.2.1（本轮） |
|---|---|---|
| 方法覆盖 | 只有 P2：doctor/open/inspect/edit/frame/render/status/cancel/close/shutdown | 22 个：上述 + project.create/asset.import/scene.create/scene.update/scene.remove/scene.reorder/project.revise/history/undo/redo/preview.snapshot/preview.release |
| params | 仅 P2 方法有结构 | 全部严格结构：必需/可选键、`additionalProperties:false`、string 长度、number 范围、十六进制 revision、sceneId 与 snapshotId pattern、scene template 模型、order 唯一 |
| result | 仅 `"result": {"type":"object"}` | 每个方法一个 result 定义（inspect/job/history/scene/revise/预览等共用 `$defs`），成功帧仍保持严格 envelope |
| 定位 | — | `x-methods[method] = {request, result}` JSON Pointer；响应帧无 method 时由测试按此映射校验真实结果 |
| 防漂移 | 无 | `test/schema.test.mjs`：方法集/`$ref`/README 同步 + 每方法双向参数探针 + 真实响应校验 + 响应 envelope 严格性 |

Schema 与 worker 校验对齐时顺带消除了三处隐藏漂移（均写入 README）：

- `project.create.templateId` 现在必填且只接受 `product-launch-v1`（未知值 `E_TEMPLATE`；此前缺失会在深层以非参数错误暴露）。
- `project.create.width/height` 必须为整数（此前允许小数）。
- `scene.update`/`project.revise` 的嵌套 `template` 不再允许携带 `sceneId`（此前被静默忽略；现在返回 `E_PARAMS`）。`scene.create` 仍可用 `sceneId` 指定新 Scene id。

schema 的边界是**参数结构/keys/类型/范围与路径、名称形态**：`sourceName`/`inboxName` 拒绝分隔符与前导点，资产 `name` 使用 worker 的 ASCII 图片名规则，`files[].path` 限制为无绝对路径/反斜杠/冒号/空段/`.`/`..` 段的相对路径。依赖磁盘或引用文件状态的检查（inbox 是否存在、PNG/JPEG 签名、资产重复、内容大小、revision 当前性）仍在 worker 语义层，因此 schema-valid 请求仍可能被 `E_ASSET_MISSING`/`E_PARAMS`/`E_REVISION_CONFLICT`/`E_LIMIT` 拒绝；schema 与 worker 的一致性测试同时覆盖结构与路径形态的负向探针。

## 预览快照 API（0.2.1 新增）

| 方法 | params | result |
|---|---|---|
| `preview.snapshot` | `{projectId, revision, ttlMs?}`（ttlMs 整数 100–1800000） | `{snapshotId(32 hex), projectId, revision, entry:"index.html", files:[{path,bytes,sha256}], expiresAt(ISO), maxBytes:134217728}` |
| `preview.release` | `{snapshotId}` | `{snapshotId, projectId, revision, released:true}` |

语义与边界：

- **只读私有副本**：worker 是唯一复制者；快照不进工程 revision/history，不可用于 edit/revise，也没有读取/执行内容的协议方法。Host 只能按 `snapshotId` + manifest 相对路径读取 `outputRoot/previews/<snapshotId>/` 下的精确文件。
- **revision 精确**：仅 open 工程可快照；`revision !== 当前` 返回 `E_REVISION_CONFLICT`（不猜最新）；复制完成后再读一次 revision，若期间变化则删除半成品并返回冲突。
- **复制后核对**：逐文件重读磁盘，核对字节数、`sha256`、原始内存字节与 `read()` 清单；任何不一致返回 `E_PERSIST` 且不发布。
- **相对路径**：manifest `files[].path` 只含工程内相对路径；worker 在写入前再次拒绝绝对路径、`..`、反斜杠、冒号与符号链接逃逸（engine 的 `read()` 已先做 realpath 包含校验；schema 同样限制该形态）。私有预览目录与快照目录以 `0700` 创建，属纵深防御，不构成 OS 安全边界。
- **限额**：文件数沿用 manifest 上限（entry + ≤64 资产），快照总字节 ≤128 MiB；超限 `E_LIMIT`（guard 在创建目录前执行）。
- **TTL/清理**：默认 10 分钟、上限 30 分钟、最小 100 ms（便于短会话/测试）；到期定时器（unref，不阻塞进程退出）删除目录。`close` 清理该工程快照，`shutdown`/stdin EOF/SIGINT/SIGTERM/未捕获异常路径清理全部；新 worker 启动时 `rm -rf outputRoot/previews` 丢弃上一进程可能遗留的私有副本（即使从未使用预览）。`previews/` 目录懒创建：从未请求快照的 worker 不会在 `outputRoot` 下新建它；但若上一进程遗留了该目录，启动 sweep 会删除。
- **错误码**：`E_SNAPSHOT_NOT_FOUND`（未知/已过期/已释放）、`E_REVISION_CONFLICT`、`E_LIMIT`、`E_PROJECT_NOT_OPEN`、`E_PROJECT_NOT_FOUND`（open 时）、`E_PATH`、`E_PERSIST`、`E_PARAMS`。重复 `preview.release` 是安全 no-op，但按“未知 snapshotId”返回 `E_SNAPSHOT_NOT_FOUND`；清理 rm 失败时快照保持 tracked 并返回 `E_PERSIST`，可重试，后续 TTL/close/重启仍会清理。
- **未实现的可选项**：同一 revision 复用未过期快照（任务标注为可选优化）；当前每次请求生成新的随机 snapshotId，各自独立 TTL/释放。
- **不是沙箱**：私有快照只限制“复制哪些文件、返回哪些路径”，不执行 HTML。Host 侧仍需 sandbox iframe 与精确资产路由（P3-005）；沙箱边界未在本任务验证。

## 顺手修复：project.create registry 失败恢复（P3-003 复审观察 1）

- 调整顺序：先建目录/文件/素材 → 临时挂到内存映射 → `open` + `ensureHistory` → **最后**写 registry；因此“registry 已写但后续失败”的窗口被结构性消除。
- 失败清理：删除内存映射、handle/lifecycle 与工程目录；registry 最后写失败时 registry 保持原样。清理失败只记固定阶段诊断，不掩盖原始错误。
- 故障注入测试（`test/create-recovery.test.mjs`，3 项）：注入 `open` 失败 → 无目录/无 registry 条目，重新加载 registry 成功；registry 目录只读导致写入失败 → 回滚且同进程恢复后可再创建；协议层同样故障后 worker 重启正常（不再 `E_CONFIGURATION`）。

## 验证数字

| 项 | 命令 | 结果 |
|---|---|---|
| worker 单元/契约 | `npm test --prefix packages/video-engine-worker` | **29/29 通过**（原 17 项 + schema 2 + 预览 7 + 创建恢复 3），约 10.8s |
| worker 真实链 | `npm run test:real --prefix packages/video-engine-worker` | **10/10 通过**（原 9 项 + 预览真实链 1），约 102.7s |
| client | `npm test --prefix packages/video-engine-client` | **19 项：18 pass + 1 opt-in skip**（原 17 + 预览 2），约 49.2s（同一机器早前复跑 28.3s，属负载差异） |
| 真实预览链 | `artifacts/engine/df4b74f/evidence/preview-chain.txt` | 见下节，全部断言通过 |

独立复核（fresh-context verifier）结论为 PASS-WITH-NOTES，无阻塞缺陷；其指出的事实性/措辞问题已在 `df4b74f` 与本文修正：旧 schema 方法数（10 而非 9）、`0.2.0` 语义声明的收窄、schema 路径/名称形态与磁盘语义校验的边界、以及 `previews/` 启动 sweep 的措辞；同时补上私有目录 `0700` 与 schema 路径/名称 pattern 及其负向探针。

真实链证据（`preview-chain.txt`，由真实 worker/client 生成）：3 Scene、11s、1280×720、revision `037395b8…`；快照 `f80740ad…` 的三个文件磁盘字节/`sha256` 与 manifest **全部一致**（gsap 72927B、logo 70B、index.html 4499B）；路径均为相对路径。人工 edit 后 revision 变为 `56ab7e3e…`，旧快照 index.html 仍为 4499B/`bc898da1…`（不可变），过期 revision 请求返回 `E_REVISION_CONFLICT`；新快照 index.html 为 `2f66f39d…` 且包含人工修改。`preview.release` 成功删除，重复 release 返回 `E_SNAPSHOT_NOT_FOUND`；120ms TTL 快照到期后目录消失、release 返回 `E_SNAPSHOT_NOT_FOUND`；`close` 后 `previews/` 为空；重启前植入的假遗留目录被新 worker 启动 sweep 清除。

## 固定包（`artifacts/engine/df4b74f/`，ignored artifacts）

| 包 | 文件数 | bytes | SHA-256 |
|---|---|---|---|
| dsh-video-engine-client-0.2.1.tgz | 3 | 7297 | `59e31cf9ba503a515d89712758b713054487ad2a131412db8908409ab6545fee` |
| dsh-video-engine-worker-0.2.1.tgz | 13 | 43930 | `ea7374d4555e70264c9c40d710ef9a331ff4e0311e840d1359615356b081c775` |

`package-verify.json` 记录：两包每个文件与 `df4b74f` 逐字节一致、重复 `npm pack` 字节一致、包内版本均 0.2.1；client 仍为 3 文件（README/package.json/src/index.mjs），worker 为 13 文件（README/package.json/protocol.schema.json + 10 个 src/*.mjs，新增 `src/previews.mjs`）。包由 `npm pack --pack-destination artifacts/engine/df4b74f` 生成，未安装、未发布。

## 契约差异与已知限制

1. **快照渲染未验证**：本轮只证明快照是 engine 文档解析器可直接消费的忠实副本（测试中用 `buildDocument` 解析快照 index.html 得到相同尺寸/时长）；sandbox iframe 播放/seek、Host 资产路由、画布点选仍待 P3-005。
2. **未接入 Host/未安装**：没有真实 DSH 页面、profile 或安装动作；也无 UI/AI 端到端。
3. **SIGKILL/断电**：用户态清理无法执行；私有目录可能遗留，但新 worker 启动 sweep 会删除，且遗留 id 不被 Host 知晓（随机 128-bit）。未做 fsync；崩溃可能留下未发布的部分目录，同样由下次启动清除。
4. **清理失败**：TTL/close/shutdown 清理失败只记固定阶段诊断（stderr，不含路径/内容）并继续；`preview.release` 的删除失败返回 `E_PERSIST` 且可重试。close 不因单次清理失败而失败，遗留目录由启动 sweep 兜底。
5. **限额可测试性**：工程 `read()` 本身已限制单文件 ≤64 MiB、声明总字节 ≤128 MiB，因此协议层能触发的超限路径主要是 `E_LIMIT`；预览 65 文件/128 MiB 的 guard 另以直接构造 manifest 的单元测试覆盖（不会创建目录）。
6. **内存**：`read()` 会把 entry+声明资产读入内存，预览复制与回读再叠加一份；128 MiB 上限下峰值内存未做压力测量。
7. **同 revision 快照复用**未实现（可选优化）；每次请求一份私有副本，Host 需自行控制并发与释放。预览目录仅 `0700` 权限保护，不是独立 OS 用户/沙箱；同一 `outputRoot` 不假设多 worker 并发（启动 sweep 会清除该目录，配置方需保证单 worker 使用）。
8. 历史/操作缓存仍是进程内存语义（沿用 P3-003）；预览不改变 revision/history 契约。
