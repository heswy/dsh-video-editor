# P3-012：先走通对话生成、预览与对话续改

日期：2026-10-18。执行video-studio，唯一开发会话；允许Client/Host/engine端到端修改，通用规则读DEVELOPMENT。用户最新明确收敛：先实现右侧对话→AI生成→左侧出现→继续对话修改，**用户手动编辑后期再加**。本指南替代P3-011全部执行要求；鹈鹕/球只是历史回归证据，不能成为专用功能或唯一验收题。

## 当前唯一交付目标

用户从右侧原生对话描述一个视频，AI生成并提交绑定工程；左侧无需点击刷新/重开自动显示可播放预览。用户继续在同一对话说改什么，AI修改同一工程，左侧自动显示新版本。连续至少两轮修改能工作，保存重开后还是最新作品。产品可编辑在本阶段指**能通过AI持续修改**，不要求逐对象手动编辑。

## 范围收敛

- 左侧是只读作品预览：自动载入、播放/暂停、seek、适应画面和必要的加载/错误反馈。右侧AI持续可见，复用已有历史/模型/Composer。少文案、无场景卡片。
- 隐藏/移除本阶段用户入口：对象点选/描边/拖动/缩放手柄、文字原位编辑、浮动属性、目标下拉/颜色/字号/时间表单及“保存修改”。底层现有typed edit API可以供AI使用，不需要删掉已验收引擎能力；不为暂缓的手动UI补新功能/测试。
- 不新增素材拖放、复杂素材管理、专业时间线或多轨音频。原生附件/已有资产归属保留能用的路径，不把附件系统重构放上关键路径。导出MP4已有能力可保留；**不能让完整MP4渲染成为每次左侧更新的前置**，不将导出作为此轮主目标。
- 不把固定product-launch模板变成创意上限；支持范围需由明确composition契约决定。首轮可采用已验证HTML/SVG/GSAP程序化作品形式，不引入新后端。未知不支持输入快速明确反馈，不伪造完成、不转而研究开发仓库。

## 必须打通的技术边界

1. **统一生成/修改提交路径。** AI获得绑定projectId、当前revision、当前作品结构和可用操作，并按同一合约生成或修改。可复用typed ops，也可增加最小受控作品提交入口；不要为了本轮遍历所有图元开发手动编辑协议。候选必须校验后再发布，原子保存工程/revision；失败保持最后有效作品。不能只把MP4/图片放会话cwd就说已完成工程，也不能让Agent裸写正在预览的文件后由前端猜格式。
2. **AI产物与左预览是同一修订。** Host确认提交后发出可观察版本变化，UI按project/revision获取预览；能用既有安全轮询/事件，不为此另建大系统。scenes=[]不能成为“不能预览”的判据，composition根与timeline不能硬编码某个模板id。兼容mode能力由真实结果决定，错误明确且保留旧预览。
3. **加载正确作品。** project/session切换、迟到响应、连续修改时不串工程或用旧结果覆盖新结果。AI正文的“已完成”不能替代实际提交及预览就绪；工具结果提供可信publishedRevision与preview状态。不能要求用户手动刷新或重新打开来让作品出现。
4. **对话是用户唯一修改入口。** 至少支持对当前生成作品的文案/配色/构图或动画中两种修改，以通用作品提交或已有操作完成。保留无关内容，不每轮悄悄新建工程。没有适用能力时清楚报告，不能耗时翻Git/README来开发插件。必要工程上下文应由Host提供。
5. **保留现有边界。** 项目归属/路径/资产manifest/字节大小/revision冲突、快照TTL和CSP/sandbox/实例消息/worker生命周期继续生效。生成脚本不能在Host主进程执行；不把新作品提交口当任意本机读写/网络接口，也不声称现有隔离是完整OS沙箱。若需增加协议，记录精确params/results/失败原子性，同步各层与版本即可，不先开多轮调查。

## 验收依据（先用户行为，再回归）

A. **空工程首次创作**：右侧自然语言→工具提交→左侧自动ready并可播放/seek，确认画面确实属于该project/revision，不需要用户开demo或点“更新画面”。
B. **连续对话修改**：同工程两轮不同修改，至少涉及文案与视觉/动画之一；每轮工程revision及左侧画面对应变化，无关内容保留，重开后一致。
C. **题材泛化**：至少两个结构明显不同的生成composition（例如插画动画和文字动效，具体题材由开发者选择），都走同一生成/提交/预览入口；额外变更描述验证不是按提示词或固定stableId分支。鹈鹕/球可作旧回归，不为它们写专用逻辑。
D. **失败与并发**：生成格式错误/缺资产/提交失败不毁最后有效作品；旧revision拒绝、旧快照失效、迟到结果不覆盖新作品，停止/重新进入资源不泄漏。左侧失败有可恢复反馈，不能无限“画面尚未生成”。
E. **实际UI证据**：真实组件浏览器证明自动首次预览、两轮变更、播放/seek、切换和失败恢复；组件不得出现本轮暂缓手动控件。开发页与真实DSH安装证据分开，不用VM或工具直调冒充模型实际发起。

本地验证可用受控Agent/工具请求模拟模型产物，但报告为模拟；真实模型对话闭环仍是最终验收必要项，候选复审后按具体授权在专用测试Session完成。无需为了“通过”反复调用付费模型。记录提交→预览ready耗时与错误，不编造总体速度承诺。

## 开发与交付

先读现有代码与已确认断点，复用能用的生成/快照/会话链，给本任务一份简短实现计划后直接实现，不停在提案。先补失败用例再修；保留受影响engine/Host边界回归，**本轮不要求重跑/扩展所有手动拖拽用例**。涉及版本/协议/打包时在统一树一次改齐。

交固定提交、新包/新staging及摘要、分项检查、两种作品/连续续改与失败证据，普通push codex/video-studio并更新统一草稿PR。原目录/原分支/原作品不覆盖。总调度复审的是这条通用闭环，不是测试总数或两个例子的截图。

只授权功能开发与任务副本本地验证，不安装/启停/重启、不改profile/用户工程、不新增真实模型请求、不merge main、不自动派发其它Agent或跨会话联络。无安全定向输入通道时提供用户人工步骤，禁止全局坐标/键盘/个人剪贴板。

---

## 开发记录（video-studio 开发会话，2026-10-18）· 自述，待总调度复审

执行范围：按本任务实现，未安装、未改 profile/用户工程、未发真实模型请求、未 merge main。
详细契约、版本、验证分层与未测项见 [research/2026-10-18-conversation-first-mvp.md](../research/2026-10-18-conversation-first-mvp.md)。

### 实现摘要

- **同一提交路径**：Engine `project.compose`（完整 HTML composition 契约校验 → 原子写入口 →
  字节回读 → 私有快照证明 → 历史记录；restore 失败才标 `uncertain`）+ `project.source`
  （当前权威 HTML/revision，48 KiB 界）。worker/client 升 0.4.0，协议 JSONL v1 不变（24 方法）。
- **Host/Tool**：`video_engine` 增加 `project.compose`/`project.source`；Host 预校验 html 预算与类型、
  沿用 Agent Session→工程作用域；compose 成功后刷新 prompt facts；`project.list` 返回
  `{projects:[{projectId,updatedAt}], defaultProjectId}` 供首开自动选择；绑定会话 prompt context
  写入完整工作流、契约、skeleton 与冲突恢复，并明确禁止 shell 改工程文件。
- **Client**：左侧统一为只读 `previewOnly` 画布（不再以 `scenes` 存在为判据），按 revision 自动
  轮询并换快照；删除旧 PNG/表单编辑器渲染分支与 demo 入口；首开自动打开最近/记住工程并载入或
  自动创建一次绑定会话，无工程时自动创建一次「空工程+会话」；右侧原生会话/历史/模型不变。
- 手动画布实现与 typed edit/scene API 保留在默认 `previewOnly:false` 代码路径与引擎中，仅从产品
  UI 移除入口（本轮不为其新增功能/测试）。

### 固定提交（本地，待 push）

| 内容 | commit |
|---|---|
| engine 0.4.0 compose/source + 测试 | `9efb172` |
| Host bridge/tool/prompt + checks | `32f4f77` |
| Client 只读自动预览/首开流程 + checks | `97a2ec0` |
| P3-012 独立 harness + 交付门禁更新 | `8799260` |
| alpha.4 staging gate（根版本 + 审核版本对） | `79c6e20` |
| docs：契约/交付/证据记录 | `5f2a271` |
| 复审缺陷修复（escaped 双上限 + timeline 校验加固） | `d84ec5d` |
| engine-client spawn-context 测试去 flake（仅测试） | `5956a93` |

### 检查结果（本轮实际输出）

| 层 | 命令 | 结果 |
|---|---|---|
| Engine worker 契约 | `node --test --test-concurrency=1 test/*.test.mjs`（packages/video-engine-worker） | 44 pass / 0 fail |
| Engine compose 集成 | 同上 `test/compose.integration.mjs` | 5 / 5（含复审缺陷回归） |
| Engine client | 同上（packages/video-engine-client） | 22 pass / 0 fail / 1 opt-in skip |
| Host 契约 | `node scripts/check-host.mjs` | 53 / 53（基线 46 + 6 P3-012 + 1 escaped 预算复审回归） |
| Client 冒烟 | `node scripts/smoke-client.mjs` | 71 / 71（按新范围替换 16 个旧手动编辑器用例，清单见交付消息） |
| 静态/打包 | `node scripts/check.mjs`、`node scripts/test-stage-version.mjs` | 50 / 50、10 / 10 |
| 统一门禁 | `npm run check` | 全绿 |
| 开发 staging 现有链回归 | `test-canvas-browser`、`test-canvas-chain`、`test-host-engine`（最终 fix staging） | 均 ok=true（证据在共享 artifacts/p2-b/evidence/） |
| 开发 staging 手动画布套件 | `test-canvas-workspace` | 本轮按任务不要求重跑/扩展手动拖拽用例，未作为交付关口（默认 false 路径仍保留） |
| P3-012 独立验证（chain） | `scripts/test-conversation-chain.mjs --staging <fix staging>` | ok=true，**230/230**：同工程 3 轮 compose（A/B/B-mod）、28/28 失败矩阵原子性、幂等/冲突/作用域、snapshot 字节、真 Chrome 双题材 ready/seek/play、prompt context、close/reopen |
| P3-012 独立验证（preview） | `scripts/test-conversation-preview.mjs --staging <fix staging>` | ok=true，**41/41**，B1–B5：首开自动 ready 708ms、发布→左侧 ready 1518/1221ms、play/pause/seek、失败+恢复、产品面板 0 手动控件/0 写请求；8 张真实页面截图 |
| 复审缺陷 post-fix probe | verifier 对抗性 probe（fix staging） | 7/7 期望结果：HIGH 引擎致死输入现被 typed 拒绝且 engine 存活；注释/null timeline 被拒；source escaped E_LIMIT |

### 独立复审缺陷与修复（2026-10-18）

独立 verifier 对冻结 staging 做对抗性边界 probe，报告 3 项；均已修复并经可执行证据闭环
（详见 research 第 6 节，修复提交 `d84ec5d`）：

1. **HIGH**：契约合法的 quote/backslash 密集 HTML 经 JSON 转义后超过 worker 64 KiB JSONL 行，
   worker 返回不可关联 `E_LINE_LIMIT` 帧 → engine client 杀 worker → 之后所有视频请求
   `E_WORKER_EXITED`。修复：Host validate 阶段 escaped ≤61440 预校验（`E_PARAMS`，不启动 worker）+
   worker composition escaped 上限（`E_COMPOSE_INVALID`）+ source escaped `E_LIMIT`。修复后 probe：
   typed 拒绝、无 fatal protocol、engine 后续 inspect/source/compose 正常；边界 escaped 60499 B
   文档仍可发布（不过度收紧）。
2. **MEDIUM**：timeline 暴露原来按原始 HTML 文本匹配，注释中的赋值/`main: null` 也能发布并拿到
   `publishedRevision`。修复：只扫描 inline `<script>` 体，拒绝字面量 null/undefined；明确
   “静态必要非充分”，播放证明仍由预览 runtime 承担。
3. **LOW**：原文 “48 KiB 保证 source <64 KiB” 的声言在转义下不成立；escaped 上限加入后成立
   （source escaped >61440 返回 `E_LIMIT`），注释与文档同步更正。

残留限制：engine client 对不可关联协议帧仍按既有设计致命处理（Host 预校验使文档允许路径不再产生）；
engine-client spawn-context 测试在高负载下的 200ms handshake 预算偶发超时（与运行时修复无关），
已给该两类用例独立宽松预算（`5956a93`），负向超时用例保持 200ms。

### 交付物

- 新引擎包（固定提交 `d84ec5d` 重打）：`artifacts/p3-012/packages/`（client 8610 B
  `14b85c39…ed513`，worker 66733 B `f86b8639…7863b`）。
- 最终 clean staging：`artifacts/p2-b/staging-p3-012-d84ec5d-d84ec5d`（rootCommit=engineCommit
  `d84ec5d`，rootDirty=false；INTEGRITY.json sha256
  `9b8aff4ba3f9afaec75d603ed5dc6652aac9e987b9c8e43bf5e37de9c15ba199`）。
- push `codex/video-studio` 并创建/更新草稿 PR（此前统一分支 PR 创建超时未确认，本轮按
  head=codex/video-studio 查询为 0 后创建草稿 PR #4；原 #1/#2/#3 保留）。
- 本轮只完成**单元/契约 + 开发 staging 真组件浏览器**两层；真实 DSH 安装、真实模型对话、真机
  验收仍需总调度复审后按授权安排。安装/模型请求不在本任务授权内。

### 复审关注点（已知边界，不谎报）

1. 原始 48 KiB（且 JSON-escaped ≤60 KiB）是 AI 编辑路径的 MVP 上限；旧更大/quotes 密集工程可被
   浏览器预览，但 `project.source` 会明确 `E_LIMIT`，不静默截断。
2. `preview.status:"ready"` 只证明契约+SDK+快照管线可服务，不是浏览器播放证明；timeline 暴露是
   静态必要非充分校验；播放由左侧 snapshot+runtime 证实，失败显示可恢复错误。
3. compose 是全文档替换：prompt 已要求保留无关内容，但复杂回归仍取决于模型质量；真实模型闭环
   未在本轮授权内验证。
4. 旧手动画布路径仍保留代码与 P3-008 runtime 契约覆盖，产品 UI 不可达；本轮未重跑全部手动拖拽
   浏览器用例。
5. `test-canvas-workspace.mjs` 本轮未作为交付证据（任务明确不要求），默认 false 路径由
   `test-canvas-browser`/`smoke-client` 的 runtime 契约与 wiring 用例覆盖。
