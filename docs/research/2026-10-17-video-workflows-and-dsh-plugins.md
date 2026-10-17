# DSH Video：视频工作流与插件接入调研

调研日期：2026-10-17。本文是研究结论和架构建议，不是已通过验证的实现规范。

> 后续更正（2026-10-17）：用户已提供本机官方开发包，目标为 Desktop 0.2.0-rc.2。产品已确认顶部「普通｜视频」切换；不再以官方 Web 起步作为当前开发决定。本文 master Remote、依赖和 Client 建议仅保留为研究，实际契约先由 P0-001 在目标运行时核实。当前规则见 `../DEVELOPMENT.md`，产品见 `../product/PRODUCT.md`，官方材料见 `../reference/`。

输入计划：[DSH-Video-AI-Native-Programmatic-Video-Studio.md](/Users/orange/Downloads/DSH-Video-AI-Native-Programmatic-Video-Studio.md)。原文中的技术冻结、安装命令和开发要求按待评审提案处理。

## 1. 结论

产品方向成立：在 DSH 内让 Agent 创建程序化视频工程，用户可视化修改后让 Agent 继续编辑。真正需要验证的是代码、可视化编辑、Agent 上下文和导出是否能形成同一条闭环。

建议保留「Code as Video」「Scene 内编排 + 跨 Scene 时序」「人与 AI 共用工程」三个原则。调整四点：

1. 优先验证 HyperFrames 原生工程、SDK、Player 与 Studio 的复用，不先造独立视频引擎。
2. HTML、JSON Graph、Timeline 不能各自成为权威状态。先以原生工程文件为内容真相，插件维护索引、修订号、选择上下文和任务状态。
3. 「可编辑」必须分级。DOM 文本、样式和时序可以结构化编辑；Canvas、Three.js 和任意 JS 内部对象不能默认承诺逐对象拖拽。
4. 先锁定一个 DSH 宿主和版本。建议技术验证从官方本地 Web profile 开始；目标社区 Desktop 应单独完成兼容验证。

以上是根据后文证据作出的工程建议，不是上游承诺。

## 2. 最近 Opus 5.5 视频热潮：实际发生了什么

### 2.1 模型与生成链路

Anthropic 于 2026-09-22 发布 Opus 5.5。其官方模态说明列出文本、图像输入及文本输出，不能据此把它理解成直接输出视频的扩散模型。[发布说明](https://www.anthropic.com/claude-opus-5-5)、[官方模态说明](https://www.anthropic.com/transparency)

可检查的社区工程主要采用以下路径：

```text
Brief / 截图 / 品牌素材
→ 编码 Agent 编写 HTML、CSS、SVG、GSAP 或 React
→ 渲染器在指定时间取得画面
→ 浏览器捕获 + FFmpeg 编码
→ MP4，同时保留可继续修改的源码工程
```

配音、音乐、真实拍摄画面通常是另外的素材或工具产物，不能统归为 Opus 原生生成。

### 2.2 值得参考的可检查案例

| 一手来源 | 公开内容 | 对 DSH Video 的价值 |
|---|---|---|
| [opus-video-recipes](https://github.com/bilaldemirerr/opus-video-recipes) | App Store 预览用 Remotion；动态排版、带本地 TTS 的竖屏片用 HyperFrames；提供提示词、源码和 MP4 | 同一产品应围绕可交付工程组织工作流；不用把产品绑定到模型名字 |
| [opus-5-5-video-templates](https://github.com/lumian2015/opus-5-5-video-templates) | 30 个 HTML 动效模板、变量替换脚本、Skill 与 HyperFrames 渲染命令 | 内容变量可编辑是可快速落地的一层；这些是复刻模板，不等于原始作者生成过程 |
| [作者公开的 40 秒宣传片制作记录](https://www.reddit.com/r/SideProject/comments/1wqucbc/i_made_this_40second_promo_without_touching_the/) | 作者自述经过 9 个版本，使用 HTML + GSAP、无头 Chrome；记录了逐帧 seek 时 clip-path tween 异常 | 不能仅凭实时预览验收；修改、抽帧、导出复核是核心体验 |
| [作者公开的代码视频制作记录](https://www.reddit.com/r/ClaudeCode/comments/1wqnoy4/opus_55_made_my_whole_video_as_code_this_trailer/) | 作者自述使用 HTML、GSAP、Three.js、WebGL、HyperFrames；语音来自本地 Chatterbox | 将画面创作、声音生成和最终渲染区分为独立能力 |

社区记录是作者自述；本次没有重新运行这些工程，也没有独立测量其成本或制作时长。公开案例有明显筛选效应，不能据此推出默认一次生成成功率或模型排名。

[公开提示词索引](https://github.com/Reger-c/opus5.5-video-prompts)可用于追溯案例；它是资料汇编，具体效果应回到原帖和工程核实。

### 2.3 应沉淀的工作流

建议 Skill 将长任务组织为：明确传播目标 → 简短分镜与视觉方向 → 按 Scene 创建 → 关键帧检查 → 带音频草稿 → 修改 → 最终渲染复核。简单标题卡不必强制经过完整策划流程。

确定性时间是基础要求：随机数固定种子，素材和字体就绪，动画由明确时间驱动，避免依赖当前时钟、实时网络或单纯 requestAnimationFrame 累进。HyperFrames 官方解释了逐时刻渲染与这类约束。[工程模型](https://hyperframes.heygen.com/concepts)

## 3. HyperFrames 能复用到什么程度

### 已有公开接口

| 能力 | 已核实的官方说明 | 对计划的影响 |
|---|---|---|
| 原生工程 | HTML 保存场景、嵌套 composition、媒体与时序；Agent、Studio、CLI 共用文件 | 不急于创建第二套完整 Composition Graph |
| 对象编辑 SDK | `openComposition`、稳定 `data-hf-id`、查询、`setText`、`setStyle`、`setTiming`、批量编辑与序列化 | 优先用 SDK 实现 UI/Tool 的结构化修改 |
| 变更与历史 | 默认 undo/redo，变更产生 RFC 6902 patch，支持宿主接入自己的历史 | Journal 可以增加 actor/reason/revision，不必重做所有底层编辑操作 |
| Studio | 画布选择、Inspector、Layers、时序编辑、源码回写；仅支持可安全编辑的属性和元素 | 先验证整体嵌入与上下文桥接，再决定替换多少界面 |
| Player / CLI | 可嵌入播放；CLI 可检查、抽帧和渲染 | 不必第一步就接底层 capture engine |

来源：[工程模型](https://hyperframes.heygen.com/concepts)、[SDK quickstart](https://hyperframes.heygen.com/sdk/quickstart)、[Undo/Redo/Patches](https://hyperframes.heygen.com/sdk/guides/undo-redo-and-patches)、[Studio](https://hyperframes.heygen.com/studio)、[开发接入](https://hyperframes.heygen.com/developers)。

### 不能从文档直接推定的能力

- 任意生成 HTML/JS 都能无损往返编辑。
- Canvas 内每个图形、Three.js 中每个 mesh 都自动成为 Inspector 对象。
- SDK patch 自动解决外部代码编辑、并发写入和文件改名后的冲突。
- Studio 的 UI 和选择事件在 DSH 内可以直接无修改嵌入。
- 跨平台导出效果、中文字体、GPU shader 结果完全一致。

官方画布文档明确指出部分生成或源码驱动元素无法安全暴露全部属性；不支持时需要转交 Agent 或编辑源码。[编辑边界](https://hyperframes.heygen.com/studio/canvas)

建议分三级承诺：

1. Scene 级：所有受支持工程都能交给 AI 重写指定 Scene。
2. 元素级：受支持 DOM 元素提供文字、颜色、位置、尺寸、时序编辑。
3. 自定义图形级：Canvas/WebGL 先暴露作者定义的参数，其内部对象编辑另行实现。

计划中将浏览器渲染写成「Chromium / Playwright」过于具体：HyperFrames 当前公开 engine 描述使用 Puppeteer + FFmpeg。接它的 CLI/Producer 时，不必另外引入 Playwright 作为生产渲染实现；Playwright 可独立用于端到端验证。[官方仓库与包划分](https://github.com/heygen-com/hyperframes)

HyperFrames 仓库标注 Apache-2.0；项目自有素材、字体和后续依赖仍应分别记录来源。Remotion 是另一套许可，不应沿用插件自身的 MIT 标签推定其适用范围。[HyperFrames](https://github.com/heygen-com/hyperframes)、[Remotion 许可入口](https://www.remotion.dev/license)

## 4. DSH 插件开发规范：与本项目直接相关的部分

DSH 官方明确说明还在 developer preview，会有不兼容变化。以下是 2026-10-17 查阅的官方文档快照；开发时需对照选定版本的源码和类型。官方树 API 当次返回 master SHA：`1517a4dbca0a2789ff1d41ba439600f8547d23fa`；这不是本项目已完成兼容测试的基线。[官方仓库](https://github.com/deepseek-ai/deepseek-harness)

### 4.1 插件、服务与生命周期

- 普通插件导出 `name`、`apply(ctx)`；所需服务通过 `inject` 声明。
- 可替换的视频能力用 Service 暴露；Tool 与 UI 消费同一业务服务。
- 必需服务消失会导致消费者卸载，恢复后重载。因此渲染进程、订阅、文件监听和临时资源必须有明确释放路径。

来源：[首个插件](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)、[服务与依赖](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/service)。

### 4.2 安装包不是只有 TypeScript 入口

- 可安装 bundle 在 `package.json` 声明 `dsh.bundle.patch`，由 `cordis.patch.yml` 插入插件行。
- 不声明 bundle 的普通依赖不会自动激活插件层。
- bundle 安装到 profile；本项目验证应使用隔离测试 profile。
- 需要与宿主共用实例的 DSH 依赖放入 peerDependencies，开发时另有 devDependencies。
- 优先分发预构建 npm 包或 tarball。Git 安装源码涉及 prepare/build 与独立构建脚本许可。
- 安装后看 `--dump-config` 和实际激活状态；包安装成功不代表 Host 和 Client 都加载成功。

官方教程给出的本地流程形式为：

```sh
# 仅是开发验证流程说明；本次未执行安装。
dsh plugin --profile video-dev add ./path-to-built-plugin
dsh --profile video-dev --dump-config
```

应在所选版本确认 Web surface 的启动方式，测试 profile 不可假定自带 Web UI。[打包与安装](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)

版本兼容已是安装和启动准入条件。官方升级指南描述了新规则：有 `engines.dsh` 时优先使用它，否则回退到相关 DSH peer 范围。该指南描述 alpha.3 之后的行为，不能无条件套到旧宿主；预发布版本范围也需专门验证。[兼容升级指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.md)、[Plugin Manager](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.md#version-compatibility-and-exemptions)

### 4.3 Tools 与 Skills

Tool 使用 `defineTool` 和 `ctx.tools.register()`，声明参数及 canonical output schema，由 `output.render` 提供模型可读结果。渲染任务需要区分创建任务、进度、取消、失败和完成，避免只返回一行日志。[官方 Tool 教程](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool)

Skills 通过 `ctx.skills` 注册 provider 或运行时贡献；本地发现也支持 `.dsh/skills/<name>/SKILL.md`，但发布包不能假定仓库里任意 `skills/` 目录会自动被加载。模型与用户可调用性分别控制。[Skills 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md)

建议第一轮只保留一个 director Skill 和少量项目、编辑、预览、渲染工具。工具数不是验收目标。

### 4.4 Web UI 与 Host 通信

Client 包需声明 `dsh.client`、`platform: web`，并通过 `exports["./client"]` 提供构建产物；仅把 React 放进 `src/client` 不会自动成为 DSH 页面。[Client Modules](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.md)

UI 应通过 Slots 贡献：用 `ctx.slots.inject()` 等待拥有者，再 `ctx.slots.register()`。避免导入其他功能插件的运行时组件；展示组件不接收整个 Cordis ctx。[Slots](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.md)

官方当前 Remote 路线是 Host 的 `TypertRemoteService` + `@Remote`、生成契约、Client 的 `ctx.remote.<namespace>`；需要处理 `RemoteResult`、错误码和 AbortSignal。第三方独立包的生成与 namespace 装配应先做最小样例验证，不能仅凭主仓 cookbook 推定无需额外配置。[Remote cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-remote-api.md)

权威状态、持久化、变更排序和权限属于 Host；Client model 是镜像，UI store 只保存视图与交互状态。[Web Client 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-client.md)

### 4.5 信任边界

安装的 Host 插件在 DSH 进程中执行，处于 Agent workspace sandbox 之外。因此「插件是可信应用代码」与「Agent 生成的视频工程是不可信代码」必须分开设计。[Plugin Manager 信任边界](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.md)

本项目应验证工程路径及符号链接边界、素材路由权限、浏览器与子进程隔离、固定 argv、取消与超时、文件替换策略及网络策略。仅用 iframe 不足以证明生成代码不能访问本地服务或工程外资源。

## 5. 已有 DSH Remotion 插件的参考边界

[chenjie1129/remotion-video-plugin](https://github.com/chenjie1129/remotion-video-plugin)已有 Skill + Tools 的 bundle，覆盖环境诊断、composition 发现、still/video 渲染和输出 probe。其文档区分单元检查、真实 Harness probe 与浏览器渲染集成证据，这种验收方式值得复用。

但它不是完整的可视化视频工作区，也没有证明本方案要求的选中对象上下文、人与 AI 连续编辑以及双向源码同步。其 README 声明的 DSH host package 范围在 0.2.0 之前，不能直接当成当前 master 的兼容样板。

## 6. 对原计划的具体修改建议

| 原计划章节 | 建议 |
|---|---|
| §8、§37 HyperFrames-compatible runtime | 改为「优先验证固定版本的 HyperFrames 原生接口」，兼容层范围后定 |
| §14 Composition Graph | 先作为派生索引或适配视图；明确每个字段的权威来源 |
| §15 Operation Journal | 复用 SDK patch，增加来源、修订、前置条件和项目快照；外部代码编辑另走整文件版本检查 |
| §23 Browser renderer | 使用上游生产渲染入口，不同时自建一条 Playwright capture 管线 |
| §30 MVP 必须有 Whisper 等 | Whisper、逐字字幕、复杂音频分析移至后续；保留基本音轨导入与混合 |
| §31 插件目录 | 补齐发布 manifest、Client 构建、Remote 契约生成和隔离安装验证；不先按每个名词拆 Service |
| §32 Desktop First | 先写明具体 Desktop 项目及上游 pin；未确定前以官方本地 Web 做技术基线 |
| §38 第一阶段唯一目标 | 加入「手动修改后 AI 不覆盖该修改」及「关闭重开仍可编辑」的验收 |

### 推荐架构边界

```text
DSH Agent + Director Skill          DSH Video Client / 嵌入编辑器
             │                                  │
          Video Tools                     typed Remote
             └────────────────┬─────────────────┘
                        Host Video Service
                   修订 / 写入排序 / 任务 / 审计
                              │
                  HyperFrames SDK + 原生工程文件
                              │
                Player / Studio       CLI / Producer
                                            │
                                     Chromium + FFmpeg
```

选择上下文建议至少包含 projectId、revision、sceneId、scoped element IDs、playhead、range、snapshot 引用。它是有作用域的交互状态，不应作为视频内容写进权威工程；提交提示词时捕获快照，避免 Agent 根据过期选择编辑。

代码改动与 UI patch 共用 Host 写入入口。Agent 读取 revision 后，提交必须检查该版本；已有变化则重读或拒绝旧写入。渲染固定 revision 快照，确保导出的内容可追溯。

## 7. 下一步技术验证与验收

这是建议交给开发 Agent 的验证范围，本次没有分派或开始实现。

1. **安装与挂载**：选定 DSH 发布版/commit；构建一个 bundle，注册最小工具、Skill 和 Client 入口，隔离 profile 安装后检查各层，卸载后资源释放。
2. **视频闭环**：Logo + 3 张截图生成 15 秒、3–4 个 Scene 的工程；DSH 内可预览，导出 H.264 MP4；probe 确认尺寸、帧率、时长和音轨。
3. **编辑闭环**：选择标题修改文字、位置与一处 timing；撤销/重做；再要求 AI 修改第二幕，先前人工编辑仍保留；重启后工程可恢复。
4. **状态冲突**：故意以旧 revision 提交，必须拒绝或显式解决；外部文件编辑后 UI 刷新，不能静默覆盖。
5. **渲染一致性**：同一固定环境下随机 seek 与顺序播放的关键帧一致；检查中文字体、首末帧、场景边界和音画同步；取消任务后无遗留渲染进程。

优先回答的三个问题：Studio 的哪部分可直接嵌入？独立 DSH 插件如何接入自定义 Remote 生成链路？SDK、外部源码编辑与宿主修订如何统一？这些答案决定架构，而不是先冻结完整目录和八组工具。

## 8. 证据范围

完成：阅读用户计划、网络检索、官方文档/API 合约与公开案例核查。官方仓库树 API 可访问；完整 clone 与 raw 文件直连遇到网络问题，相关内容通过浏览工具读取。未安装 DSH/HyperFrames、未运行样例、未验证 API ABI、未做性能或兼容测试。本文的「已核实」指官方公开说明存在，不等同于本项目已集成成功。
