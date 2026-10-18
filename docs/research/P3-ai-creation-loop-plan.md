# P3 创作闭环：工作拆解与 Host/引擎契约草案

日期：2026-10-17。总调度（DSH 继任会话）起草，**草案状态，未冻结**。依据：产品约定、ADR-0001/0002、P1/P2 已验收证据、[原始调研](2026-10-17-video-workflows-and-dsh-plugins.md)。不修改已接受决策；新决策以 proposed 记录。

## 1. 目标与验收样例

产品第一条完整样例：Brief + Logo + 3 张截图 → AI 在 DSH 内建立 **15 秒、3–4 个 Scene** 的可编辑工程 → 预览 → 用户直接修改（标题、基础布局/时序）→ AI 继续修改指定 Scene 且保留人工变更 → 保存重开 → 导出 H.264 MP4。

验收必须包含：真实安装宿主内完成上述闭环；人工改动在 AI 续改后仍存在；修订冲突显式提示而非静默覆盖；重开后 revision、Scene、选择上下文可恢复；成片 ffprobe 校验尺寸/帧率/时长；不出现假进度、假成功、假导出。

## 2. 现状与依赖

- 引擎：`54f4671` 验收。当前只有**单 composition 工程**、`index.html` 入口 + 声明资产、稳定 `data-hf-id`、text/timing 两类 typed edit、revision=入口与资产清单哈希、frame/render/status/cancel/close。**没有**多 Scene、场景 CRUD、工程创建、任意代码写入、撤销/重做、素材上传。
- 宿主：P2-002-B 在修 R1–R4；真实 Host 激活、路由/Tool、卸载重启均未验证；已安装仍是 0.1.3。
- 依赖顺序：P3 实现必须等 P2-002-B 验收 + 安装 + 真实链通过，否则会冻结未验证接口。

## 3. 关键技术选择（proposed，待 spike 后确认）

| 选择 | 草案 | 理由 |
|---|---|---|
| 创作驱动方 | **DSH Agent 通过 Tool 驱动**；插件不内置模型凭据、不直连模型 API | 与「一个操作只实现一次 / UI 与 Tool 共用 Host 入口」一致；复用会话上下文；避免第二套模型配置 |
| 内容形态 | Code as Video：HTML + GSAP 时间线，稳定 `data-hf-id` 为编辑锚点 | P1 已验证可编辑/可渲染；不造第二套 Composition Graph |
| 生成自由度 | 首版**受模板约束**的 Scene 代码（结构、ID、时长、资产占位由模板/校验保证）；任意 JS 后置 | 当前 worker 无沙箱；任意 Agent 代码是未解决的安全边界，不能默认承诺 |
| 多 Scene 表示 | 待 P3-001 判定：嵌套 composition / 单文档多时间线 / 多入口 + manifest | 以 SDK、Player、CLI 三方一致且可单 Scene 重写为准 |
| 权威数据 | 工程内容以原生 HTML/资产为唯一真相；revision 快照；操作日志只作历史/撤销辅助 | 延续 P1/P2 决策，UI 不成为第二真相 |
| 人工与 AI 写入 | 同一 Host dispatcher；写入带 `actor`（human/ai）、`expectedRevision`、`operationId`；冲突显式返回 | 防止 AI 覆盖人工修改 |

## 4. 工作分解

| 任务 | 内容 | 执行 | 依赖 | 当前状态 |
|---|---|---|---|---|
| P3-001 | 引擎可行性 spike：多 Scene 结构、场景操作、AI 重写+人工改动合并、撤销/重开、素材、项目创建/注册 | 程序员 1（现有 b4bf 树） | 无（不改已验收包，只出证据/提案） | 指南已下发 |
| P3-002 | Host 侧契约与 AI 编排设计：方法表、修订/合并语义、素材入口、Tool/UI 共用、上下文注入 | 总调度 | 与 P3-001 并行 | 本文草案 |
| P3-003 | 引擎实现：scene create/update/remove/reorder、project.create、revise、history/undo/redo、资产写入 | 程序员 1 | P3-001 + P3-002 + P2 验收 | 未开始 |
| P3-004 | 插件实现：创建流程、Scene 列表/时间线、AI 上下文面板、冲突提示、撤销/重做、重开恢复 | 程序员 2 | P3-003 契约冻结 + P2 验收 | 未开始 |
| P3-005 | 端到端验收：真实安装内跑通 15 秒样例、人工+AI 混合编辑、重开、导出；记录未测项 | 总调度评审 | P3-003/004 | 未开始 |

树与并行：**暂不新开 worktree**。P3 横跨现有两个写入区域（引擎包 / 根插件），新树要么复制代码要么缺一半；等 P2 验收后如需要端到端负责人，先建整合分支 `codex/integration`（不动 main），再从它切 `p3-ai-loop`。P3-001 在现有 b4bf 树内新增 spike 目录，不碰已验收包。

## 5. 数据模型草案

```
ProjectRef  { projectId: string }                      // Host 数据目录内受控工程
Scene       { sceneId, order, start, duration, title?, stableIds[] }
Revision    = sha256(入口 + 声明资产 路径/字节 清单)     // 延续现有规则
Operation   { operationId, actor: 'human'|'ai', baseRevision, kind, targetScene?, patchSummary,
              prevRevision, nextRevision, createdAt }
```

- Scene 边界同时存在于内容（composition/时间线）与派生索引；**内容文件是权威**，Scene 索引可重建。
- 操作日志放在工程目录的保留子目录（如 `.dsh-video/history/`），**不进入 revision 计算**，也不作为内容第二真相。
- 选择上下文（当前 Scene/对象/播放头）属于 UI 交互状态，通过 Tool 参数传递；不写入工程内容。

## 6. 引擎方法提案（草案，P3-001 后校正）

在现有 open/inspect/edit/frame/render/status/cancel/close 基础上增加：

| 方法 | 输入 | 输出/语义 |
|---|---|---|
| `project.create` | `{templateId, title?, width?, height?, fps?, assets[]}` | 在 worker 受控 projectsRoot 复制模板生成工程，返回 projectId/revision/scene 列表；不允许任意路径 |
| `scene.create` | `{projectId, expectedRevision, sceneId?, afterSceneId?, title?}` | 插入 Scene，返回新 revision 与 sceneId |
| `scene.update` | `{projectId, expectedRevision, sceneId, html?, duration?, order?}` | AI 重写/调整单 Scene；超出模板约束拒绝；返回新 revision + 变更摘要 |
| `scene.remove` / `scene.reorder` | revision + sceneId/order | 结构变更；单写者队列保证串行 |
| `project.revise` | `{projectId, expectedRevision, sceneId?, instruction?, patch}` | 高阶：AI 在 Scene 内按 stableId 应用批量 text/style/timing；等价于 Scene 内 typed ops 集合 |
| `history` | `{projectId, limit?}` | 最近操作（actor/时间/摘要/修订），供 UI 与 AI 理解上下文 |
| `undo` / `redo` | `{projectId, expectedRevision}` | 用户动作；返回新 revision 与实际恢复的摘要 |
| `asset.put` | `{projectId, expectedRevision, name, bytes/sha}` | 受控资产写入（Logo/截图），大小/类型受限，校验后进入 manifest |
| `inspect`（扩展） | `{projectId, sceneId?}` | 结果带 sceneId、每 Scene 时长/顺序、对象 stableIds/capabilities |

错误语义延续：`E_REVISION_CONFLICT`、`E_UNSUPPORTED_EDIT`、`E_OPERATION_REUSED`、`E_PARAMS`、`E_PERSIST`、`E_PROJECT_NOT_FOUND`、`E_LIMIT`；新增 `E_TEMPLATE`、`E_SCENE_NOT_FOUND`、`E_CONFLICT`（需人工/AI 协调），并保留 `uncertain`/`jobUnknown`。

## 7. 人工/AI 修订合并草案

1. 所有写入以 `expectedRevision` 为前提；worker 单写者队列串行。
2. AI 重写 Scene 时基于 `baseRevision` 生成候选 HTML；worker 重开 composition 校验结构/ID/时长，再与当前 revision 做**stableId 级三方合并**：
   - AI 新增元素：插入；
   - AI 删除元素：若人工也改过该元素 → `E_CONFLICT`；否则删除；
   - AI 改元素、人工未改：采用 AI；
   - AI 与人工改同一元素 → `E_CONFLICT`（返回对象清单，UI/AI 协调，**不静默覆盖**）；
   - 人工新增/改动的元素 AI 未触及：保留。
3. 冲突处理：返回结构化冲突（sceneId、stableId、人工改/ AI 改摘要），由 UI 提示或 AI 调整后重试；不允许「取最新 revision 强写」。
4. 撤销/重做基于操作日志 + 修订快照：撤销产生新 revision，不篡改历史；AI 操作与人工操作都可撤销（撤销按钮由用户触发）。
5. 外部代码编辑（Studio/手改文件）仍可能出现 TOCTOU；P3 要求单一写入入口，外部编辑的冲突检测最坏情况是 revision 冲突，必须显式报错。

## 8. AI 创作流程草案

```
1. 用户在会话里给 Brief + Logo + 截图（或指向附件）
2. Agent 调 project.create（模板 + 资产）→ 得到 projectId/revision/场景骨架
3. 逐 Scene：Agent 生成受模板约束的 HTML（视频引擎 Tool 写入），中间抽帧自检
4. UI 打开工程：真实画面、Scene 列表、可编辑对象；用户直接改标题/时序
5. AI 继续：Agent 带「当前 revision + sceneId/对象上下文」调 scene.update/revise
   → 引擎合并，保留人工修改；返回变更摘要与冲突
6. 用户撤销/重做、再次修改；保存重开
7. render → 轮询 status → 成功后取 MP4；失败/取消保留可重试状态
```

进度表达只用真实阶段（模板创建/Scene 写入/渲染帧/编码），不编造百分比；AI 修改完成后以描边+摘要说明改动（见设计规划）。

## 9. 素材与权限

- 用户素材（Logo/截图）来源待调查：DSH 附件/文件服务如何以受支持方式提供给插件；**不得绕过权限读取个人目录或系统剪贴板**。P3-002 先做只读调查再定接口。
- 资产类型/尺寸/数量受限（如 PNG/JPEG，单文件 ≤ 8MiB，总数 ≤ 16），写入后由 manifest/revision 覆盖；私有测试素材不得入库。
- 字体/Chrome/FFmpeg 沿用部署配置与 worker doctor，不写死系统路径。

## 10. 安全边界（P3 不承诺的部分）

- 当前 worker 不是沙箱；AI 生成 HTML/JS 属于不可信输入。P3 首版以**模板约束 + 受控资产 + 无网络**降低风险，但仍不能宣称任意代码安全隔离；独立威胁模型/隔离任务另立。
- 不新增 per-user/per-session 权限模型；P3 仍以单用户本机受控范围为验收边界，文档中如实标注。

## 11. 未决问题

1. 多 Scene 的权威表示（P3-001 回答）。
2. 合并算法在「AI 改结构（增删元素/改布局）」时的可自动化程度；哪些情况直接交人工协调。
3. 用户素材进入插件的受支持通道（P3-002 调查）。
4. 工程创建后 worker 注册表如何动态更新（worker 内部 projectsRoot + 持久 registry，或 Host 控制重启）。
5. Tool 结果体积：Scene HTML/大摘要不得撑爆模型上下文或 Tool 限额（R2 修复的字节限额直接相关）。
6. 渲染性能：15 秒成片预计明显长于 5 秒样例（P1 实测 5 秒约 16.5 秒），需真实测量与取消/进度体验。
7. 是否将 `video_engine` 扩展为创作入口，还是拆 `video_director` 高层 Tool；以模型可理解性实测决定。

## 12. 验收标准（P3-005）

- 真实安装的 DSH 内、用 P3 样例素材完成 15 秒 3–4 Scene 生成、预览、人工修改、AI 续改保留人工改动、重开、导出 MP4。
- 冲突/失败/取消均有真实状态与恢复路径；无假按钮、假进度、假成功。
- 记录 Host 版本、commit、包摘要、命令、截图/录屏（真实页面）、未测项与回滚步骤。
- 未达成的部分明确标「未验证」，不得用设计稿或本地 mock 替代。
