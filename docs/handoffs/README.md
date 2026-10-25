# 当前交接入口

## 集成入口：1.0.0 最后功能合入main（2026-10-25）

用户明确授权合码；本轮时间线可视化、手动分离音频、媒体跳转、波形及右键菜单修正、插件更新通道统一通过 [PR #33](https://github.com/heswy/dsh-video-editor/pull/33) 集成。PR的实时合并状态以GitHub为准，下面“未合并”文字保留为此前验收快照，不再代表当前集成状态。

当前安装仍为已验收b45e28a固定包；合码不重新打包或替换安装。GitHub首次公开Release尚未发布；可分发macOS arm64包与待启用的发布工作流模板已备好。首次公网下载/升级需发布后验证。


## 当前安装：1.0.0 插件更新候选（2026-10-25）

用户指定更新入口作为1.0.0最后功能；无npm账号，采用GitHub Releases首发，保留新DSH的npm版本API适配。顶栏“插件更新”提供当前版本、检查/新版说明/用户点击安装/失败重试/需重启提示。link本地开发安装不联网、不替换；正式版资产按平台架构匹配。独立认证UI路由，不对AI开放安装URL或更新方法。

固定运行时/root/engine `b45e28af184bfb1ac53e4232e1361ae8fc1d6827`，bundle1.0.0 / engine0.9.0；目录 `artifacts/p2-b/staging-v1.0.0-updates-verified`，INTEGRITY SHA256 `580ae822909bf4c3b72b8195380b4c242e19369e799efc0ce313aeb29006bbe8`。官方管理器安装启用并重启，实际worker路径核对；原生更新面板显示当前1.0.0及本地开发来源，Esc关闭通过。bb7829e旧包保留回滚。PR #33未合并，未公开发布。

12项更新/发行配置测试、8项真实浏览器UI检查、最终固定包工作区103项、源码门禁58/86/71通过。真实DSH CLI在临时DSH_HOME安装测试0.9.9→1.0.0 tarball，同一工程revision保留且新引擎真实抽帧成功；实际DSH额外临时插件从认证HTTP用户动作触发，自身卸载后继续安装新版成功（disposed=true），已通过官方管理器移除测试插件。启动apply的HMR事务内不能嵌套管理操作；生产安装仅走用户HTTP动作，后台只检查、不安装。

可迁移发行包 `artifacts/v1/release-updates-b45e28a/dsh-video-1.0.0-darwin-arm64.tgz`，SHA256 `99b82a48ce8737d29a71f20a7afc21d172f47b79d9bffa7b8cadc94fef3a6f26`，包含引擎及JS依赖，非本机link布局；仍需DSH>=0.2.1-rc.2、系统Node22+/FFmpeg/Chrome。目前只实测macOS arm64。GitHub发布工作流模板已准备，当前OAuth缺workflow scope，未启用/未在云端执行；首次公网下载/升级必须正式Release发布后验证，不能以本地包和模拟feed冒充公网已通。

证据 `artifacts/v1/evidence/plugin-updates-20261025`；[任务](../tasks/V1-plugin-updates.md)、[更新通道说明](../releases/UPDATE-CHANNEL.md)。


## 当前修正：右键菜单贴近点击点（2026-10-25）

片段和轨道菜单已改用原始鼠标坐标、浏览器top layer与实际尺寸避让；窗口边缘向左/上展开，保留8px边距，轨道右键不沿用片段上下文。源码/固定包工作区各103项通过，源码门禁58/86/71通过。官方管理器安装并重启，原生片段及音频轨右键截图确认菜单角贴近指针，Esc收起通过；未执行工程写入。

当前固定运行时 `bb7829e1ae8196a3ddddf64329815873c5a2477b`，目录 `artifacts/p2-b/staging-v1.0.0-context-anchor-final`，bundle1.0.0 / engine0.9.0；INTEGRITY SHA256 `b2351fdd41db4416d68ceef27d292a968a0286c8bb9c836ff947c070d96a7e16`。55ff055旧包保留回滚，PR #33未合并。证据 `artifacts/v1/evidence/context-anchor-20261025/native-clip-menu.png` 与 `native-track-menu.png`。


## 当前修正：分离后隐藏视频波形（2026-10-25）

用户验收要求已实现：分离后视频只显示名称和缩略图，波形留在独立音轨；普通静音保留暗波形，重开视频原声/撤销分离恢复波形。源码与固定包工作区均101项通过，源码门禁58/86/71通过。官方管理器安装并重启，实际worker来源及原生截图确认新版本已加载。

固定运行时 `55ff055c1093ea60a294a5e1a5b81d918a923a90`，bundle1.0.0 / engine0.9.0；目录 `artifacts/p2-b/staging-v1.0.0-detached-wave-55ff055-final`，INTEGRITY SHA256 `0763abf2c78e4c30ebc200bd4ad36465aaf9c63cf01cc30e2a5dd322b1fc9724`。旧5ddb697包保留回滚；PR #33继续未合并。证据 `artifacts/v1/evidence/detached-wave-20261025/native-hidden-wave.png`。未改变音频处理或用户工程数据。


## 当前安装：1.0.0 时间线可视化候选（2026-10-25）

已完成五项：真实多分辨率音频波形、导入视频及AI场景连续缩略图、视频原声波形、蓝色视频/绿色音频名称条、右键手动分离音频。分离保持源区间、速度、音量和淡化，视频原声关闭；独立编辑、一次撤销/重做。AI可调用同一事务，本轮不保证AI理解和端到端效果。

官方Plugin Manager安装并重启，固定目录 `artifacts/p2-b/staging-v1.0.0-visuals-5ddb697`，clean runtime/root/engine `5ddb6974b864c014fdf8424dbf88f7df10f2f63c`，bundle1.0.0 / engine0.9.0，INTEGRITY SHA256 `13b896bd1ab86c452683970d0ee1e402b8ec6f5857fadf913e5fffc8ab16908a`；实际worker进程来源已核对。810891c旧包保留回滚，PR #33未合并，未公开发布。

固定包工作区98项、worker及真实采样92项通过；源码门禁58/86/71、版本10通过。120秒视频/音频/AI场景混合工程首屏6338ms、采样期间inspect 3ms、缓存220ms，峰值worker RSS约303MiB、缓存718279字节；大素材1GiB引用、流式上传/Range/重启及引用保护通过。21秒AAC导出四处音画偏差最大21.313ms，小于1帧。

原生独立“1.0.0 时间线验收”工程：完整胶片条/原声波形/独立音轨实际显示；右键分离、自动选中、菜单关闭、撤销/重做、中段6.01秒定位、播放至9.26秒暂停通过，暂停后保留完整缩略图。原生按钮导出12秒360帧H264/48kHz立体声AAC，实际音频mean -19.0dB、peak -11.6dB；不把此分析称为扬声器听感验收。两个原用户工程timeline SHA256不变。证据目录 `artifacts/v1/evidence/timeline-visuals-20261025`，截图 `native-final.png`。

本机成品已安装；通用跨平台安装器、硬件扬声器听感及真实AI分离效果不在本次已验证结论内。实现与边界见任务记录。


## 当前安装：1.0.0 媒体跳转修复候选（2026-10-24）

用户授权直接操控电脑验收。官方Plugin Manager安装启用并重启，当前固定包 `artifacts/p2-b/staging-v1.0.0-media-native-810891c`，clean runtime/root/engine `810891cc3c34d28ac01ac98261058d70265f2444`，bundle1.0.0 / engine0.8.3，INTEGRITY SHA256 `0ff8720c3c9c02b166603d706d03584b6aa784b1635e660ea9ce6641fa057245`。旧包保留回滚，未公开发布。

原生Test工程实测：启动后直接跳44.05秒显示视频；点击视频片段定位65.53秒，画面更新；连续播放66.02→70.77秒画面持续更新；暂停后点击空白视频轨定位29.80秒并显示对应画面。按钮明确为“开启作品预览声音”，点击后收起；未监听系统输出，扬声器听感不算已验收。两个用户工程timeline SHA256与操作前一致。固定包工作区90项、长GOP媒体7项通过；新增媒体origin/CSP保护6项通过，源码门禁58/86/71、版本10通过。首个1563cbc包原生黑屏已被此包替代。截图位于 `artifacts/v1/evidence/media-preview-20261024/native-810891c-accepted.png`。

[修复记录](../tasks/V1-media-preview-recovery.md)；[可视化方案](../plans/V1.0-TIMELINE-VISUALIZATION.md)。波形增强、视频缩略图/原声波形及分离音频仍是方案项，未实现，不能据此宣称整个1.0.0全部需求验收完成。

## 当前入口：1.0.0 已安装，等待用户最终验收

2026-10-24 官方管理器安装启用1.0.0并重启，runtime `e09f267`，固定包工作区87/音频导出14通过；实际Client/worker来源已核对，alpha.13回滚保留。用户验收通过且无修复时发布沿用同一包，未对外发布。见 [STATUS](../STATUS.md) 与 [版本卡](../releases/1.0.0.md)。

## 当前开发入口：音频收敛及轨道操作

2026-10-24 用户追加轨道画面/声音开关、删除/撤销及轨道右键菜单，并授权将本轮及之前修改一起合码。用户指定只留AI代码生成直接上轨、用户上传进素材两条路径。声音面板及入口已删除，追加时间线菜单外部/Esc关闭和明确动作名称；source工作区87/音频导出14/模型契约8通过；未安装重启。详见 [任务](../tasks/V1-audio-flow-simplification.md) 与 [STATUS](../STATUS.md)。

## 最新入口：alpha.13 已安装

2026-10-23 用户授权合码安装，PR #29 已合入main，#28关闭。最终固定runtime `d4b635e`，工作区84、音频导出14通过；官方管理器安装启用alpha.13并重启，原生界面确认新版声音/轨道/播放头控件及工程恢复，用户timeline哈希不变，alpha.12回滚保留。详见 [STATUS](../STATUS.md)。

## 最新入口：alpha.12 移动与自动时长

2026-10-23 两项修复完成，已安装 alpha.12 并退出重开 DSH；Test 工程自动时长 532 帧 / 17.73s，片段与素材不变。source/固定 Chrome 各 52 项及真实 532 帧导出通过；固定 runtime `f10e7ff`，alpha.11 回滚保留。见 [任务](../tasks/V1-move-duration-consistency.md) 与 [STATUS](../STATUS.md)。浏览器验证不冒充原生拖动验收，未公开发布。

## 最新入口：alpha.11 轨道叠放修复

2026-10-22 按用户要求改为上轨覆盖下轨，预览/导出共用修正层级；source/固定候选红蓝像素测试通过，官方管理器安装 alpha.11 / engine 0.8.3，真实 DSH 新预览确认上轨层级更高。固定 runtime `0381bf0`，详情见 [任务](../tasks/V1-upper-track-priority.md) 与 [STATUS](../STATUS.md)。alpha.10 回滚保留，用户工程未重写，未公开发布。

## 最新入口：alpha.10 跨轨拖动反馈

2026-10-22 增加片段拎起跟手、源占位和目标落点反馈；source/固定候选各 45 项交互回归通过，已通过官方管理器安装 alpha.10，runtime `ad9a6b2`。当前窗口仍缓存旧 Client，原生控制因捕获失败无法代重启，用户重开 DSH 后需实际验收手感。alpha.9 回滚保留，未发布，见 [任务记录](../tasks/V1-timeline-drag-feedback.md) 与 [STATUS](../STATUS.md)。

## 最新入口：alpha.9 剪辑区精简

2026-10-22 用户实测体验可用，要求继续简化轨道与素材入口；已实现资源栏、独立播放条、轨道适应宽度、按需片段参数/历史。固定 runtime `9d25518`，bundle 1.0.0-alpha.9 / engine 0.8.2；source 与固定候选 Chrome 各 41 项及 Host 通过，官方管理器已安装，重启刷新 Client。事实与限制见 [STATUS](../STATUS.md) 和 [任务记录](../tasks/V1-timeline-ui-refinement.md)。本轮另清理 4.12 GiB，历史 staging 归档恢复入口为同级 artifacts/cleanup-20261022，不再使用历史展开路径。当前/回滚与用户工程保留，未公开发布。

## 当前入口：M1–M5 CR 与用户验收

2026-10-22 当前会话完成验收前 CR，修复迁移、撤销回执、响度、隐藏轨声音和冲突素材排队 5 类问题。候选 alpha.7 / engine 0.8.1，runtime `bfc34d13bb3398236d5ec0535049edc4e25358e3`，固定包 `artifacts/p2-b/staging-v1.0.0-alpha.7-bfc34d1`，INTEGRITY `4cce9e034194646c3c75e785b25e56d2a845d47af4055abe5ea40d2e5013dfe8`。固定候选 Chrome 工作区 38、对话 261、预览 164 和真实 Host/画布/1 GiB 媒体通过，见 [CR 报告与验收顺序](../tasks/V1-CR-regression.md)。本轮不自动安装、重启、调用原生模型或发布；下一步使用此唯一候选进行用户真机验收，旧候选/作品保留。

## V1 M5 历史入口

2026-10-22 当前会话按用户指派完成 M5 开发，沿用既有合码权限选择 [PR #21](https://github.com/heswy/dsh-video-editor/pull/21)。候选 alpha.6 / engine 0.8.0，runtime `bed1f8d`，固定包 `artifacts/p2-b/staging-v1.0.0-alpha.6-bed1f8d`，INTEGRITY `07abdee2d82c165b80f105aa210492b8d459f8eb52bdc24d515196ce62ed90e5`。原生 @ 适配与真实工程候选/复制 token、resolve、变更回执、定向撤销、冲突预演和幂等恢复已实现；固定包工作区 37、对话 261、预览 164 全过，详见 [任务卡](../tasks/V1-M5-collaboration.md) 与 [STATUS](../STATUS.md)。未安装/重启/真实模型/发布，M1–M5 原生联合验收待下一授权窗口；30 条中文操作契约不能冒充模型成功率。下一阶段 M6 发布硬化仍需开发与验收，不把 M5 当 1.0.0 发布。后续仍由本会话负责，不自动派发或跨会话联系。

## M4 历史入口

2026-10-22 当前会话完成 M4，用户明确要求音频供应商以千问云试点、允许导入，并精简轨道 UI。交付 alpha.5 / engine 0.7.0，runtime `81ffb1b`，固定候选 `artifacts/p2-b/staging-v1.0.0-alpha.5-81ffb1b`，INTEGRITY `afbf1ac1d0314d8ec5fbade781cf56b1a918b4a7a1e2367daec88f0da7ce8eea`；[PR #20](https://github.com/heswy/dsh-video-editor/pull/20) 按既有权限选择合码。千问 TTS/SFX、本地旁白、导入配乐、音轨预览混音与 AAC 导出已验证；音乐 403 未开通时禁用并以导入兜底。详见 [M4 任务卡](../tasks/V1-M4-audio.md) 和 [STATUS](../STATUS.md)。未安装/重启 DSH；最后确认安装为 alpha.11，本轮未替换。下一安装窗口联合验收 M1–M4；不要自动派发或跨会话联系。后续 V1 开发仍由当前会话负责。

## M3 历史入口


2026-10-21 用户要求当前会话一次完成 M3，并授权判断合码。M1 #17/M2 #18 已合入 main；M3 从 `00223dd` 独立开发，2026-10-22 开发交付 alpha.4（engine 0.6.0，固定 runtime `0d5ccff`，PR #19 按授权选择合码），详见 [STATUS](../STATUS.md) 与 [M3 任务卡](../tasks/V1-M3-timeline.md)。本轮未安装/重启/真实模型/发布；下一次授权窗口联合验收 M1–M3。后续开发仍由当前会话负责；不要自动派发或联系其它会话。下方旧状态保留追溯，当前判断以上述入口为准。


### V1 M2 delivered / 后续开发负责人（2026-10-21）

- 当前会话已获用户授权负责 M2 及后续 V1 全部开发；不等待另一个开发会话、不自动跨会话联系。
- 树 `v1-m2-media` / `codex/v1-m2-media`，base M1 `e810a68`；[PR #18](https://github.com/heswy/dsh-video-editor/pull/18) 依赖 [M1 PR #17](https://github.com/heswy/dsh-video-editor/pull/17)，均未合并。
- 固定候选 `artifacts/p2-b/staging-v1.0.0-alpha.2-939419e`，root=engine=`939419e`、rootDirty=false、bundle `1.0.0-alpha.2` / engine `0.5.0`，INTEGRITY `0ead5c6b…ed3903fa`。前序 alpha.2 目录仅追溯，不继续安装。
- L1–L3：58/86/71/10、worker 56、client 23、storage 21、media 15、Chrome 媒体 UI 13 全过；最终 staging 引擎/画布/1 GiB 媒体通过，对话 261/261、预览 164/164、same=true。
- 本轮未安装/重启/真实模型/合并/发布。下一步是用户授权的 M1/M2 联合真机验收，再由本会话继续 M3。完整清单与持久证据见 [V1-M2-media](../tasks/V1-M2-media.md)；规划 [V1.0-PLAN](../plans/V1.0-PLAN.md)，验收 [V1.0-ACCEPTANCE](../plans/V1.0-ACCEPTANCE.md)。
- 回滚：alpha.11 `staging-alpha11-51b95dc/bundle` 与 M1 alpha.1 候选保留；不删除用户数据或旧 staging。

以下为 0.3 稳定线历史交接与回滚依据。

更新：2026-10-21。alpha.11 已安装；用户明确“直接合码，这是 0.3.0 版本的最后一次改动”；P3-028 已合并 PR #15（`51b95dc`），未等待重启视觉复核（组件/真 Chrome 几何回归通过）。之后按具体问题从最新 main 建立修复分支。

- **V1 M1（1.0.0-alpha.1）候选已构建、待安装验收（2026-10-21）**：分支 `codex/v1-m1-storage`，commit `99532f1`（M1 实现）+ `5d42b1f`（bump）。固定 staging `artifacts/p2-b/staging-v1.0.0-alpha.1-5d42b1f`（root=engine=`5d42b1f`、rootDirty=false、bundle `1.0.0-alpha.1`、client/worker `0.4.0`；INTEGRITY sha256 `55e61ebbabee4df92b44d5ba6c3429a7bea5f7c58e2c27e8f9b58c50f55f958c`）。L3：host-engine ok=true、conversation-chain 261/261、canvas-chain ok、conversation-preview 164/164；真实 `~/Movies/DSH Video` 未被测试创建。**未安装**；待用户 Plugins 页 link 安装并做 M1 真机验收（数据根/迁移/文件夹按钮/ui-state/容错）。回滚 `artifacts/p2-b/staging-alpha11-51b95dc/bundle`。详细见 [P3? → V1-M1 任务](tasks/V1-M1-storage.md) 与 STATUS。
- 最新代码、规则、项目记忆统一读origin/main；先读STATUS、DEVELOPMENT、PRODUCT。
- 当前没有已下发的新功能任务；不继续旧p0/p1/video-studio/ui-polish/project-foundation分支。
- P3-013保留为真实对话验收的行为清单，P3-014记录已整合UI候选。**当前安装为 0.3.0-alpha.11**（root=`engine`=`51b95dc`，client/worker `0.4.0`，staging `artifacts/p2-b/staging-alpha11-51b95dc`，INTEGRITY sha256 `fd080d27086fa80bea8f4b0623d823c497c6281b8974ee1e0d0a2ac89db682ab`）；已通过真实 Plugins 页安装/启用（插件页 v0.3.0-alpha.11 / 1 of 1 运行中）。回滚保留 alpha.10 staging `artifacts/p2-b/staging-alpha10-1cceb96`（INTEGRITY `6061004f…3e4f9`）、alpha.9 staging `artifacts/p2-b/staging-alpha9-573352e`（INTEGRITY `28f319b9…3b9e`）、alpha.8 staging `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593`（INTEGRITY `988302e9…6857`）与用户原作品；更换候选先核对实际包/版本/摘要。
- **P3-015 提速**：分支 `codex/faster-video-turn`（base `1672a42`，PR #9）已完成代码/测试/固定 staging `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593`（alpha.8、root=`engine`=`cf7e593`），并通过 2 次真实模型真机验收（3 步/44.2s、2 步/39.3s，对比基线 14 步/536s）。alpha.8 已安装启用；PR #9 已按授权合并。回滚 alpha.7 staging `artifacts/p2-b/staging-alpha7-preview-public-0deef8f-bf38fd6/bundle`。范围与证据见 [P3-015](../tasks/P3-015-faster-video-turn.md)、[提速记录](../research/2026-10-20-faster-video-turn.md)。
- **P3-016（A）面板/工程标题已合并 main 并随 alpha.9–alpha.11 安装**：PR #10 合并提交 `61c566e`。完成 A1 右栏可拖拽（默认 42%、上限 720px、左侧保底、双击/方向键/Home、比例持久化、窄容器仍堆叠）、A2 `project.json` 可选 `title` + UI-only `project.rename` + inspect/project.list 返回 title + 顶栏左对齐内联重命名、A3 移除插件显示设置（保留系统 reduced-motion/transparency）、A4 门禁与测试。真机 UI 已确认：splitter 可拖拽且 reload 持久、作品名内联重命名生效且 revision 不变、无显示设置/简化效果；**alpha.10 用户最终验收通过**。范围/证据见 [P3-016](../tasks/P3-016-panel-title.md)。
- **P3-017（B）预览稳定性/图片预览/产品导出（已合并 main + alpha.9–alpha.11 安装）**：PR #11 合并提交 `573352e`（候选阶段：B merge `55fbed7`、版本 bump `795acaa`；冲突按“A 左侧作品名/箭头/内联 rename + B 右侧导出；显示设置保持删除”解决）。B1 预览状态机（snapshot/ready 独立 30s 预算、1s revision 去抖、失败自动重试 1 次、旧画面保留、有界诊断、旧快照 release）；B2 内嵌对话图片/文件点击本地 overlay（data/blob/remote 直接显示、相对路径走 Host preview、绝不回落 sidebarRight）；B3 产品顶栏右侧“导出 MP4”（真实 stage/百分比/已用时间/取消/下载、绑定点击时 revision、防重复点击、Host/worker render 900000ms、frame 仍 120000ms）。合并后门禁：check **54/54**、smoke-client **80/80**、check-host **68/68**（×3 稳定）、worker **56/56**、test-stage-version **10/10**、real Chrome `test-conversation-preview` **164/164**（含 A+B 顶栏/分隔条集成断言）。alpha.9 固定 staging 回归：host-engine **ok**（5s render 150 帧/取消）、conversation-chain **261/261**、conversation-preview **164/164**。**真机已确认**右侧导出按钮真实 5s 导出约 10s 并出现下载链接；**alpha.10 用户最终验收通过**（预览超时自动恢复、导出按钮可用；fileLink 点击问题由 P3-022 修复）。**剩余长期观察**：真实 20s/120s 长片导出耗时/取消/失败路径、真实模型复杂多轮修改。范围/证据见 [P3-017](../tasks/P3-017-preview-export.md)。
- **P3-022（修复 alpha.9 真机 sidebarRight 报错；已合并 main + alpha.10 安装 + 用户验收通过）**：分支 `codex/p3-022-file-link-preview`（base `0396838`），**PR #13 合并提交 `1cceb96`**（含 `418c2ea` 修复 + `d6ad098` alpha.10 bump）。根因来自 DSH 当前 chat bundle：ToolRow collapsed summary 是真实 `<button class="<hash>_fileLink">`（无 title/data-*、非 a[href]），文案为「读取图片 · <path>」，B2 点击解析漏掉它，原生 `openFile → sidebarRight.openResource` 在全局面板内抛错。修复：`client.js` 匹配 `[class*="fileLink"]` button/a 并从 summary 的 ` · ` 后取路径（相对/绝对），preventDefault+stopPropagation 后走插件 `openPreview`，img 分支优先、普通按钮不拦截；不调用/不猴补原生 sidebarRight。门禁：check **54/54**、smoke-client **81/81**（新增真实 ToolRow 形状用例，原 B2 保留）、check-host **68/68**；alpha.10 staging 回归 stage-version 10/10、host-engine ok、chain 261/261、preview 164/164；该 staging client 的真实 ToolRow DOM probe **167/167**（native opener 0 次、Host path 原样转发）；独立 verifier **32/32**。**alpha.10 已安装并重启加载新 client；用户真机点击 `read_image` 文件链接确认不再弹 sidebarRight、打开本地图片 overlay**；用户最终 6 项验收全部通过。剩余观察：宿主未来若改 fileLink DOM/分隔符需同步 selector；真实长片导出/复杂多轮仍属长期观察。范围/证据见 [P3-022](../tasks/P3-022-file-link-preview.md)。
- **P3-028（修复 darwin 收起侧栏后顶栏不居左；已合并 main + alpha.11 安装；0.3.0 最后一次改动）**：分支 `codex/p3-028-topbar-left`（base `9b0928e`），**PR #15 合并提交 `51b95dc`**（含 `7c8f9ae` 修复 + `ed2480e` alpha.11 bump）。根因：darwin 折叠侧栏时宿主设 `--dsh-frame-leading-clearance:160px`，而插件 `.dv-topbar` 已用 `--dsh-frame-top-clearance:48px` 把内容移到窗口控制区下方，却又在通用 padding-left 叠加完整 160px leading，导致返回/作品名右移。修复：`.dv-root` 新增 `--dv-topbar-leading:max(16px, var(--dsh-frame-leading-clearance,0px))`，`[data-platform="darwin"] .dv-root{--dv-topbar-leading:16px}`，topbar 与窄屏规则改用该变量（darwin 窄屏 16px），保留 darwin padding-top；非 darwin 行为不变。门禁：check **54/54**、smoke-client **81/81**、check-host **68/68**、test-ui-polish **27/27**（仓库 client 与 staging client 字节各 27/27；darwin 160/top48 几何：paddingLeft 16px、paddingTop 56px、backLeft 16/top 56、nameLeft 58/top 56；恢复非 darwin 与基线一致）；alpha.11 staging 回归 stage-version 10/10、host-engine ok、chain 261/261、preview 164/164；独立 verifier **PASS**。**alpha.11 已安装（插件页 1 运行中）**；用户明确“直接合码，这是 0.3.0 版本的最后一次改动”，因此**未等待重启后的最终视觉复核即合并**（折叠侧栏顶栏居左的真机视觉确认属未复核项）。剩余观察：非 darwin 平台行为、宿主变量语义变化。范围/证据见 [P3-028](../tasks/P3-028-topbar-left.md)。
- 具体问题修复从main创建codex/<问题名>分支，按需隔离worktree；用户指定Agent负责实现并交PR。路径/权限/复用规则只维护在DEVELOPMENT。

本目录旧按工作区/人员命名的handoff全部为历史证据，不作为新的开工指令。保留旧工作树和固定产物供追溯，不自动安装或清理用户作品。
