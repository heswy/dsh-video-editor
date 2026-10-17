# P1-001：HyperFrames 单场景引擎验证（并行）

状态：已授权实现与本地验证，待用户打开新 Codex 会话。
执行：新 Codex 开发会话；架构/协调/验收：当前主会话。
分支：`codex/p1-engine-spike-b4bf`。
worktree：`/Users/orange/.codex/worktrees/b4bf/dsh-video-editor`（用户新会话自动创建，现作为唯一活动引擎工作区）。
base：`831a64df399215ca2074874a6ac904bdca587329`；自动 worktree 起点与原规划相同。Codex 已从 detached HEAD 建立上述分支并同步本路径更正；开工记录实际 HEAD。

原预建目录 `/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/p1-engine-spike` 与分支 `codex/p1-engine-spike` 暂留未使用；不要在两个目录同时执行本任务。

## 目标

独立证明 HyperFrames 在本机可以完成：创建一个程序化 Scene → 精确时刻预览/抽帧 → 通过 SDK 修改标题和 timing → 写回原生工程 → 进程退出重开 → 导出真实 MP4。此轮不接 DSH UI，不造编辑器、不复刻 Playwright capture 引擎。

## 开始前

读 AGENTS、DEVELOPMENT、PRODUCT、本任务及已有视频引擎调研。先核对当前官方 HyperFrames 文档、实际发布版本与 Node/浏览器/FFmpeg 要求，记录精确版本与来源，不把上一轮文档当作当前 ABI。

## 文件归属（避免与 DSH 冲突）

- 可改：`spikes/hyperframes/**`（含独立 package.json、锁文件、脚本、测试、示例和局部 .gitignore）、`docs/research/P1-001-engine-spike.md`、本任务的开发记录。
- 不改：根 package.json/锁文件、client.js、index.js、cordis.patch.yml、locale、README、STATUS、DEVELOPMENT、DECISIONS、P0 任务与 DSH 的 worktree。
- 只读参考 DSH 分支即可；不要 cherry-pick/merge/rebase 其他分支。集成由主会话安排。

## 实现范围

1. 建独立、可复现的 spike 包，锁定实际验证过的依赖；提供清楚的安装、doctor、抽帧、编辑、重开、渲染与验证命令。
2. 用受控自有样例：5 秒、1280×720、30fps，中文标题、基础形状/图片与 seekable 动画。字体本地确定，不依赖运行时 CDN，不含来历不明资产。随机效果固定种子。
3. 通过真实官方 SDK（如该版本支持）查找稳定对象、修改文本及 timing、序列化写回；保留稳定标识。记录实际调用 API、源码与工程路径，不仅用字符串替换假装 SDK 编辑。
4. 读取保存后的工程重新打开，验证修改仍在；同一时间顺序 seek 与乱序 seek 的关键帧比较，环境固定。输出修改前后真实帧，检查中文可见和文字不溢出。
5. 用上游 CLI/渲染入口导出 H.264 MP4，ffprobe 验证尺寸、帧率、时长与实际帧数；时长按帧级容差报告，不仅检查文件存在。
6. 验证渲染取消/超时能结束自己启动的进程及子进程，清理拥有的临时目录，不杀其他用户进程。
7. 产出可供后续 Host 接入的最小操作契约建议：open/inspect/edit/frame/render/cancel 的输入输出、工程路径、revision/文件变化检查、错误与任务状态。它是待评审接口，不提前写完整服务框架。
8. 说明引擎依赖与 DSH 0.2.0-rc.2 Host 的边界，优先评估独立 Node worker/子进程是否能避免宿主依赖解析耦合；本轮不在 DSH 中安装验证。

## 验证、权限与交付

- 允许：本 worktree 内编程、测试、固定版本的项目本地依赖安装、运行已审查的官方工具与自有场景、访问公开官方文档、必要本地提交。
- 安装前检查依赖 scripts；未知 postinstall 不执行。不得全局安装软件、改系统配置、改 DSH profile/app.asar、上传素材或调用付费服务。缺少必需系统工具时先记录诊断与最小补充要求，继续不依赖它的工作。
- 本轮只执行受控自有样例。路径 confinement 不能视作安全沙箱；不得宣称任意 Agent 生成代码已可安全执行。
- 真实场景的 Player/预览与渲染属于本任务，可运行；不能生成假 DSH 页面或把 spike 预览说成插件 UI 集成。
- 有意义的验证覆盖 SDK 写回/重开、seek 一致性、导出元数据、取消/超时；避免只测静态字符串或复制实现逻辑。
- 生成视频、帧、浏览器缓存和 node_modules 不进 Git；可重现 fixture、脚本、锁文件和证据元数据进 Git。产物存 spike 局部忽略目录，报告绝对路径供主会话查看。
- 返回：base/result commits、变更路径、准确版本、实际执行命令及结果、真实产物路径/摘要、限制、建议接入方式。更新调查与本任务开发记录。不 push/PR/merge，不替其他会话发送消息。

## 开发记录（新会话填写）

- base / result commit：待填写。
- 依赖版本与官方来源：待填写。
- 实际实现与运行命令：待填写。
- 真实帧/MP4/元数据绝对路径：待填写。
- 写回/重开/seek/取消验证：待填写。
- 未验证/阻塞/建议契约：待填写。

## 评审记录（主会话）

待交付。引擎 spike 通过不代表已完成 DSH 集成或不可信代码隔离。
