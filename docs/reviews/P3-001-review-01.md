# P3-001 复审：多 Scene 结构与人工/AI 修订合并 spike

日期：2026-10-17。总调度独立复审。结论：**通过**——证据充分、可复现，结论可作为 **P3-002 契约冻结输入**；P3 尚未实现，不宣称 AI 创作已可用。

评审对象：`cf24842`（`spike: validate P3 multi-scene structure and human/AI merge`），分支 `codex/p1-engine-spike-b4bf`，PR #2 head `cf24842f10627eaa25c831fec7f64c2ae2de08ea`。

## 独立核对

- **范围**：31 个文件，全部为 `docs/**` 与 `spikes/p3-multiscene/**`；`packages/video-engine-*`、`spikes/hyperframes/**` 未改；未安装/未改 profile；工作树干净，远程一致。
- **单元测试**：独立复跑 `node --test test/*.test.mjs` **12/12 通过**（文档模型/Scene 替换/校验/合并分支/冲突/顺序/新增删除）。
- **产物哈希**（本机 artifacts，逐文件核对）：
  - B 单文档 15s MP4：293,697 B，SHA-256 `8f7046d85e8fad38559796e4caa6fdc18193f08f692f298f3719f31ae6a19af5`；
  - worker Q8 渲染 MP4：同一 SHA-256（**CLI 与 worker 输出字节完全一致**，固定快照可复现）；
  - A 嵌套 MP4：342,384 B，SHA-256 `60c30599f04bfe9d4e71d724900a17e15f9a0766e2e3c821ca1b978cc6ab460e`；
  - 两个 MP4 ffprobe 均为 H.264、1280×720、30/1、**450 帧、15.000000s**。
- **证据 JSON**：q1 SDK 模型（A 根 5 元素 / B 根 29 元素 + 4 scene）、q1 结构（A/B 渲染成功、C 被 CLI 拒绝、单 Scene 重写后其它 section 逐字节不变、1.5/9.5/13.5s 帧 SHA 不变、5s 帧变化）、q5 合并（S1–S7 与冲突码）、q6 历史/撤销、q7 静态 registry/重启、q8 真实 worker 渲染/乱序 seek/取消，均与研究报告一致。
- **Q8 关键数字**：render succeeded 16,388 ms；乱序 seek 帧 SHA 与顺序请求一致；取消 ack `cancelling` → `cancelled`（清理 6,524 ms，artifact null，输出目录不变，client 仍可用）；frame 约 4.2–4.8 s/帧。

## 判定与契约输入

1. **多 Scene 权威结构 = B（单 HTML + Scene 区段 + master timeline）**：A 不能从根文档 inspect/edit 子 Scene（`E_UNSUPPORTED_EDIT`），C 被官方 CLI 拒绝；B 现有 typed edit 直接可用。Scene 局部时间在生成时换算成全局 `data-start`（P3-001 已踩坑验证）。
2. **Scene 生命周期走受控整文件重写**：SDK 结构 API 不同步根 duration/master timeline；`setTiming` 会把 timeline 改出矛盾。写入模型 = Scene 模型 → 重新生成完整 HTML/timeline → SDK 重开校验 → 原子写 → revision 重算；校验失败不发布、旧 revision 保持可读。
3. **insp`ect 扩展**：从内容重建 `scenes[{sceneId,order,start,duration,elements[]}]`，stableId 全局唯一（`sceneId-elementId`），Scene 索引不进 revision。
4. **人工/AI 合并**：stableId 三方合并；自动合并不冲突的不同对象；同对象双改 `BOTH_MODIFIED`；AI 删人工改过对象 `AI_DELETE_HUMAN_MODIFY`；Scene 元信息/结构/tag/其它 Scene 改动显式冲突；冲突结构 `{sceneId,stableId,reason,human,ai}`；目标 Scene 之外禁止 AI 改动。
5. **v1 生成受模板约束**：AI 候选由模板生成（不是任意 HTML/JS），合并只覆盖受控模板一层元素；任意 Agent 代码仍视为不可信、后续独立安全任务。
6. **工程创建/注册**：推荐 worker 管理 `projectsRoot` + 持久 registry + `project.create`（原子写、启动 reload、路径包含）；Host 重启 worker（+~377 ms）为回退；Host 不直接改 worker 文件。
7. **修订身份/历史**：revision 保持内容哈希；撤销恢复旧内容时 revision 回到旧值，历史另加 `historyCursor`/operation seq（若契约需要“撤销产生新 revision”，用单调序号解决，不改哈希定义）；历史存 `.dsh-video/history/` 且不进 revision。
8. **素材**：资产进入 manifest/revision 已实测；v1 限额建议 PNG/JPEG、单文件 ≤8 MiB、≤16 资产、≤64 MiB 工程；字体不入 Git。

## 非阻塞观察与风险

- `StaticGuard` 对 master timeline 初始 opacity 有警告（`#scene-1` 首次 tween 前已可见），实现生成器时必须消除或显式接受。
- 恰好 Scene 边界（4.0/8.0/12.0s）时新 Scene 已显示、入场动画从边界开始；UI 策略未定，实现时记录。
- 嵌套 A 的逐 Scene 编辑路由未实现（本路线不采用 A，记录即可）。
- 安全：任意 Agent HTML/JS 未隔离；隔离/沙箱另立任务，P3 v1 只走模板生成。
- 多写者并发、跨进程 operation journal、AI 失败回滚后的历史一致性、真实 Studio UI 连续播放、跨平台未验证。
- 合并实现只覆盖模板一层元素与已知属性，通用 DOM 合并不在本轮范围。

## 下一步

- 冻结 D020（结构/写入模型）、D021（revision 与历史）、D022（projectsRoot 与 project.create）。
- 下发 **P3-003 引擎实现**给程序员 1（多 Scene 工程、创建、inspect 扩展、素材导入、历史/撤销、AI 候选合并、真实渲染）；
- 程序员 2 先完成 P2-005 R1 补丁与 0.2.1 重装；P3-004 插件侧（创建流程/AI 上下文/冲突 UI）在引擎契约落地后下发。
