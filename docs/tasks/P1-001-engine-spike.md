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

- 开发状态（2026-10-17）：本机受控单场景闭环已完成，交主会话复审；不是主会话独立验收。
- base / result commit：任务起点 `831a64df399215ca2074874a6ac904bdca587329`，本轮实际开工 `89eabb8`；实现/研究/证据提交 `c779b94d8b05bc817e3fa82e67a7520ce3b97542`，随后本记录单独提交。分支仍为 `codex/p1-engine-spike-b4bf`，只用当前自动工作树，没有切换或新增 worktree。
- 依赖版本与官方来源：HyperFrames CLI/SDK/core/parsers `0.8.167`，GSAP `3.15.0`，puppeteer-core `25.14.0`；Node `24.14.0`、npm `11.9.0`、Chrome `155.0.8059.79`、FFmpeg/ffprobe `8.0.1`，macOS arm64。来源、registry integrity、完整锁文件、系统字体 SHA 和安装脚本审查见 `spikes/hyperframes/evidence/` 与调查文档。所有 npm 生命周期安装脚本禁用；最后以树内 cache 完成一次 npm ci 复现。未全局安装或升级软件。
- 实际实现与运行命令：独立包、原生 HTML fixture、官方 SDK fs adapter 保存、CLI snapshot/render、真实 Studio/Player 浏览器检查、进程生命周期封装。复现命令完整列于 `spikes/hyperframes/README.md`。最后 npm ci 成功，行为测试 `npm test --prefix spikes/hyperframes` 3/3；真实 rendering cancel/timeout 集成测试 2/2；`npm run verify --prefix spikes/hyperframes` 成功；git diff --check 通过。
- 真实帧/MP4/元数据绝对路径：统一根 `/Users/orange/.codex/worktrees/b4bf/dsh-video-editor/spikes/hyperframes/artifacts/`。`before/at-2.5s.png`、`ordered/at-2.5s.png` 为编辑前后帧；`studio-preview.png` 为真实官方 Studio；`edited.mp4` 为 H.264 导出，125821 bytes，SHA-256 `68d9805af3dc13bf9afef921d97942f402cba3153eec147224cb055e8998edfa`；`mp4-at-2.5s.png` 为视频实际解码帧；`verification.json` 包含其他哈希和 ffprobe 元数据。帧、MP4、字体、node_modules 与缓存不进 Git，可提交证据副本在 evidence。
- 写回/重开/seek/取消验证：`find` 定位 `hf-title`，SDK batch 修改标题为「每一帧，都可编辑」及 start=1/duration=3，flush 后磁盘与 serialize 一致，另起进程重新读取，7 个稳定 ID 不变。保存后入口 SHA-256 `dd1e57c98e128919d32a2348fe3a3acde32c38f42c763969432de7fae3c14580`。顺序与乱序 8 个时间点的 PNG 完全一致；真实 Player 0.5/4.5 秒 hidden、1/2.5 秒 visible，字体就绪、文字不溢出，播放使动画推进，页面 errors=[] 且 blockedRequests=[]。ffprobe：1280×720、30/1 fps、5.000000 秒、150 实际解码帧，0 秒时长误差（允许 1/30 秒）。真实取消与 20 秒超时均发生在 streaming capture，跟踪到的 CLI/Chrome/helper/FFmpeg 无存活者且临时目录消失；预览服务已停止，最终检查未见本 spike artifacts 路径的残留进程。
- 未验证/阻塞/建议契约：无本任务必要系统工具阻塞。SDK duration 快照读取 data-end 导致本例 null，原生 data-duration 写回及 Player/渲染行为正确；Studio 曾尝试 CDN MotionPathPlugin，已补同版本本地脚本并通过阻断外网检查；Studio 历史锁需要单写者或快照隔离。建议独立 Node worker，open/inspect/edit/frame/render/cancel 契约、revision 与错误状态详见 `docs/research/P1-001-engine-spike.md`，均待主会话评审。未验证 DSH 0.2.0-rc.2 集成、音轨/多 Scene、跨平台像素一致或不可信代码隔离。
- 变更边界：只改 `spikes/hyperframes/**`、`docs/research/P1-001-engine-spike.md` 和本任务开发记录；根插件文件、P0、STATUS、DEVELOPMENT 与 DECISIONS 未改。未 push/PR/merge，未安装 DSH 或改 profile，未向其他会话发送消息。

## 评审记录（主会话）

待交付。引擎 spike 通过不代表已完成 DSH 集成或不可信代码隔离。
