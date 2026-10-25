# 当前项目状态

## 当前安装：1.0.0 插件更新候选（2026-10-25）

用户指定更新入口作为1.0.0最后功能；无npm账号，采用GitHub Releases首发，保留新DSH的npm版本API适配。顶栏“插件更新”提供当前版本、检查/新版说明/用户点击安装/失败重试/需重启提示。link本地开发安装不联网、不替换；正式版资产按平台架构匹配。独立认证UI路由，不对AI开放安装URL或更新方法。

固定运行时/root/engine `b45e28af184bfb1ac53e4232e1361ae8fc1d6827`，bundle1.0.0 / engine0.9.0；目录 `artifacts/p2-b/staging-v1.0.0-updates-verified`，INTEGRITY SHA256 `580ae822909bf4c3b72b8195380b4c242e19369e799efc0ce313aeb29006bbe8`。官方管理器安装启用并重启，实际worker路径核对；原生更新面板显示当前1.0.0及本地开发来源，Esc关闭通过。bb7829e旧包保留回滚。PR #33未合并，未公开发布。

12项更新/发行配置测试、8项真实浏览器UI检查、最终固定包工作区103项、源码门禁58/86/71通过。真实DSH CLI在临时DSH_HOME安装测试0.9.9→1.0.0 tarball，同一工程revision保留且新引擎真实抽帧成功；实际DSH额外临时插件从认证HTTP用户动作触发，自身卸载后继续安装新版成功（disposed=true），已通过官方管理器移除测试插件。启动apply的HMR事务内不能嵌套管理操作；生产安装仅走用户HTTP动作，后台只检查、不安装。

可迁移发行包 `artifacts/v1/release-updates-b45e28a/dsh-video-1.0.0-darwin-arm64.tgz`，SHA256 `99b82a48ce8737d29a71f20a7afc21d172f47b79d9bffa7b8cadc94fef3a6f26`，包含引擎及JS依赖，非本机link布局；仍需DSH>=0.2.1-rc.2、系统Node22+/FFmpeg/Chrome。目前只实测macOS arm64。GitHub发布工作流模板已准备，当前OAuth缺workflow scope，未启用/未在云端执行；首次公网下载/升级必须正式Release发布后验证，不能以本地包和模拟feed冒充公网已通。

证据 `artifacts/v1/evidence/plugin-updates-20261025`；[任务](tasks/V1-plugin-updates.md)、[更新通道说明](releases/UPDATE-CHANNEL.md)。


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

[修复记录](tasks/V1-media-preview-recovery.md)；[可视化方案](plans/V1.0-TIMELINE-VISUALIZATION.md)。波形增强、视频缩略图/原声波形及分离音频仍是方案项，未实现，不能据此宣称整个1.0.0全部需求验收完成。

## 当前安装：1.0.0 最终用户验收包（2026-10-24）

用户授权安装最终发布版本，准备自行测试。已冻结 clean runtime/root/engine `e09f267f19e7219e8a05e2ed6474a7f4b7f55142`（基线main `6dfd8b2`），bundle **1.0.0** / engine **0.8.3**；固定目录 `artifacts/p2-b/staging-v1.0.0-final-20261024`，INTEGRITY SHA256 `b31218bf46689a4aa1e3681d91b01a01076f493f9585d579ff3c923b1e99cf97`。源码门禁58/86/71、版本10通过，最终固定包Chrome工作区87项、真实音频工具/上轨/4秒120帧AAC导出14项通过。

官方Plugin Manager完成alpha.13→1.0.0安装启用，并退出重开DSH。原生插件详情确认v1.0.0、1运行中及精确固定来源；实际worker进程来自该包，实际Client只有素材入口、视频轨名称后画面/声音开关，Test作品与原会话恢复。保留alpha.13固定包回滚，未发送真实模型或供应商请求、未公开发布或打公开tag。证据在同级worktrees `artifacts/v1/evidence/release-20261024`，安装截图 `dsh-v1-installed.png`。

时间线哈希核对：一个工程不变；Test在安装观察窗口有track.update历史（最近hidden true→false），故不宣称用户timeline逐字节未变，不回滚/覆盖当前编辑。未用用户作品跑自动化测试。用户验收通过且无修复时沿用同一固定包；若修复则重新冻结和验收。当前本机固定安装布局仍依赖Node/Chrome/字体及相邻引擎，不能只拷贝bundle作为通用安装器。见 [1.0.0验收包](releases/1.0.0.md)。

## 音频入口、时间线菜单与轨道控制（2026-10-24）

用户追加并明确授权合码：轨道名后视频轨显示摄像机/扬声器开关，音频轨仅扬声器；支持隐藏画面、静音、非空轨确认删除和撤销恢复；点击轨道名选择后可从更多菜单底部删除，右键轨道名/轨道区域在鼠标附近打开目标菜单。默认名称显示同类型序号，保留自定义名称。轨道栏宽156px，所有拖动/播放头坐标同步调整。预览及MP4像素检查确认隐藏上层显示下层。当前安装仍alpha.13，本轮未安装/重启。

用户指定移除声音面板，并追加修复时间线菜单。菜单点击外部/Esc收起、有效操作后关闭；复制和同轨相邻交换使用文字，添加视频轨/音轨区分，轨道首尾禁用无效交换，向上展开避免截断。已删除按钮/浮层及相关轮询、试听、配置、样式和文案；素材上传保留。AI skill/上下文要求代码生成后在同轮直接上轨，上传只进素材，外部生成提供指导后导入。底层旧供应商适配保留兼容。source门禁58/86/71通过，Chrome工作区87项、真实音频工具/上轨/4秒AAC导出14项、模型契约8项（3993字符）通过；无声音入口断言在旧实现先失败。组件用例显式传入父级revision，不冒充模型/原生DSH验收。未安装重启，当前安装仍alpha.13。见 [任务](tasks/V1-audio-flow-simplification.md)。

## 最新：alpha.13 已合码、安装并重启（2026-10-23）

用户明确授权后，PR #29 合入 main（`b93eecd`），重复草稿 #28 关闭。包含对话音频、面板/@、吸附/音轨样式、轨道图标及连续播放头修复。

最终固定包 runtime/root/engine 均为 clean `d4b635e8db63b281298eff58e09ed4e1365e3d20`，bundle **1.0.0-alpha.13** / engine **0.8.3**；`artifacts/p2-b/staging-v1.0.0-alpha.13-d4b635e-final`，INTEGRITY SHA256 `875ccf7e98315915194a9cac603082a6ef7586a2da888af187a79f2d11d092a6`。该包完整工作区 **84** 项、音频生成/上轨/4秒120帧AAC导出 **14** 项通过，证据 `/tmp/alpha13-final`；先前 source 门禁58/86/71通过。

经官方插件管理器安装、启用并退出重开 DSH；原生界面确认 alpha.13 / 1运行中、Test工程恢复、17.73s、声音入口、视频轨图标/扬声器、吸附开启状态及播放头slider。声音面板点击时间线后收起。重启前后用户 timeline.json SHA256一致；未编辑用户作品。alpha.12安装包保留回滚。实机安装截图 `/tmp/dsh-alpha13-installed.png`。本轮未发真实云端生成或模型请求，完整拖动回归来自固定包Chrome测试，不冒充原生拖动验收。见 [音频任务](tasks/V1-audio-creation.md)。

## 最新：alpha.12 片段移动与自动时长（2026-10-23）

两项用户反馈已修复：拖动预演和提交共用落点校验，同轨不再隐式重排，双端就近吸附、滚动坐标与边缘滚动统一；工程时长随所有轨道最后片段末端自动伸缩，旧固定留白通过正常可撤销操作迁移。source/固定候选 Chrome 各 52 项、移动规划 16 项、门禁 58/86/71、模型契约 8、版本 10 通过；实际 H264 导出 532 帧 / 17.733333s。

已安装并重启启用 **1.0.0-alpha.12** / engine **0.8.3**，官方管理器 applied、warnings=[]，alpha.11 回滚保留。用户 Test 工程现为 auto / 532 帧，真实 DSH 新浏览器预览 ready、显示 `0.00 / 17.73`，轨道/片段/素材比较不变。固定 runtime `f10e7ffe001e3a62c03852fdd0365bb90b18c4d5`，root=engine、clean；`artifacts/p2-b/staging-v1.0.0-alpha.12-move-duration`，INTEGRITY `44c7ad251f15822b02f4ba7646d6ab20f6bccbd5d6d1caac454be78292f4b061`。详见 [任务与验证边界](tasks/V1-move-duration-consistency.md)。未公开发布，未发真实模型请求。

## 最新：alpha.11 上轨覆盖下轨（2026-10-22）

修正多视频轨叠放方向：上方视频轨优先显示，转场叠层沿用同轨优先级，轨道 ID/顺序/工程内容不改。bundle **1.0.0-alpha.11** / engine **0.8.3**，固定 runtime `0381bf0`、root=engine、clean；`artifacts/p2-b/staging-v1.0.0-alpha.11-upper-track`，INTEGRITY `35c4c78577fcee6ded26f21180ea804bee350b47d99766c5cef65363dc448041`。source 与固定候选实际帧/MP4 像素验证：上轨红色优先，隐藏后下轨蓝色可见；58/86/71、worker 79、client 22（1 项可选跳过）、版本 10 通过。见 [叠放修复](tasks/V1-upper-track-priority.md)。

已通过官方管理器安装 alpha.11（applied、warnings=[]）；真实 DSH 浏览器重新进入工程并等待预览 ready，实际 DOM 确认上轨 index 0/z-index 2，下轨 index 1/z-index 1，新引擎已生效。此为引擎修复，不依赖新 Client；保留 alpha.10 回滚，未公开发布。

## 最新：alpha.10 跨轨拖动反馈（2026-10-22）

用户反馈上下拖动只在松手后换轨，缺少“拎起来”的感觉。现已增加片段跟手 X/Y 位移、提升阴影/描边、原位虚线占位、目标轨道高亮和吸附落点；无效跨轨重叠/不兼容轨道拒绝，Escape/失焦/指针取消清理预演，松手才写入。source 与固定候选 Chrome 工作区各 **45** 项、门禁 58/86/71、版本 10 通过，详见 [拖动修复](tasks/V1-timeline-drag-feedback.md)。

固定 runtime `ad9a6b288d30c89a72a7993e64ba0089f200ec91`，bundle **1.0.0-alpha.10** / engine **0.8.2**，root=engine、clean；`artifacts/p2-b/staging-v1.0.0-alpha.10-drag-feedback`，INTEGRITY `c865050dcbdf2a5fce0100a5f401e1fca4685d4fbfbbcd8a5122b0792d5977bb`。官方管理器安装 applied、warnings=[]，保留 alpha.9 回滚。**当前宿主仍缓存旧 Client，需重开一次 DSH 才生效**；原生控制服务捕获失败，真实浏览器重载后也确认新拖动 CSS 尚未加载，不冒充新 native 交互已验收。未公开发布。

## 最新：alpha.9 时间线精简（2026-10-22）

用户实测反馈“整体体验还是不错的”，继续要求整理轨道信息和素材入口。当前候选 bundle **1.0.0-alpha.9** / engine **0.8.2**，runtime `9d25518dd9727a5c2b517976cf81de86195607e4`，root=engine、rootDirty=false；固定目录 `artifacts/p2-b/staging-v1.0.0-alpha.9-9d25518`，INTEGRITY SHA256 `a1410a98b3de8695a78fb19d13cd713e8418707aaf7da31cc1d96d0f7b9abc37`。包含 alpha.8 实机恢复修复：声明文件/重命名、重复时间线、空工程占位、模型操作说明与场景根/依赖校验、Session 注入。此次新增资源栏、纯播放条、默认适应宽度、按需片段设置和修改历史；[任务与证据](tasks/V1-timeline-ui-refinement.md)。

source 门禁 58/86/71、版本 10，source 与固定候选 Chrome 工作区各 **41** 项通过，含 340px 宽度、声音调整、冲突排队及 22s/660 帧音频导出。固定候选 Host 引擎通过；第一次与 DSH 启动并发导致真实数据根保护探针报变更，停止并发 UI 操作后完整重跑 exit 0。浏览器测试不冒充真实模型成功率。

已按用户授权通过官方 Plugin Manager 安装 alpha.9（applied、warnings=[]），此前窗口仍为旧 Client，随后通过应用菜单退出重开核对。alpha.8/alpha.7 与 alpha.11 保留；没有公开发布 V1.0.0。

磁盘清理按本次明确授权完成：42 个未安装历史 staging 去重归档，4518 个文件 SHA256 校验；去掉可重装旧依赖，释放 **4.12 GiB**。归档及恢复说明在 `artifacts/cleanup-20261022/`；旧文档中的展开 staging 路径应先从归档恢复，不再假定仍在线。用户作品、源码/分支与原始证据保留。

## 当前：M1–M5 CR 与验收候选（2026-10-22）

- 本轮完成代码审查与验收前回归，[PR #22](https://github.com/heswy/dsh-video-editor/pull/22) 按既有授权自行判断合码。修复 5 类问题：中断迁移误注册/混写目录、50 次历史上限后撤销回执错误及 no-op 重做提示、工程响度未用于导出、隐藏视频轨的预览/导出声音差异、冲突期间素材上轨请求丢失。复现与修复见 [CR 报告](tasks/V1-CR-regression.md)。
- 当前唯一验收候选：bundle **`1.0.0-alpha.7`** / client+worker **`0.8.1`**，固定 runtime `bfc34d13bb3398236d5ec0535049edc4e25358e3`（root=engine、rootDirty=false）；同级 worktrees `artifacts/p2-b/staging-v1.0.0-alpha.7-bfc34d1`，INTEGRITY SHA256 `4cce9e034194646c3c75e785b25e56d2a845d47af4055abe5ea40d2e5013dfe8`。旧候选和作品保留。
- source 门禁 58/86/71、worker 74、client 23、版本 10 通过；实际 Chrome 工作区 38、固定候选对话链 261/261、预览链 164/164、Host/画布/1 GiB 素材与重启通过，源码只读审计 91→91 无变化。默认导出 -16.02 LUFS，自定义 -20 LUFS 与音画标记另见报告。
- **2026-10-22 已按用户“直接安装最新版”授权安装 alpha.7**：通过运行中 DSH 的官方 Plugin Manager Service 移除旧 alpha.1 链接、link 安装上述固定候选并启用；返回 `application: applied`、`warnings: []`，Host `fiberPhase: active`。新连接的真实插件页显示 `v1.0.0-alpha.7`、`1 运行中` 和精确来源。未重启 Desktop、未发真实模型或公开发布；现有 Desktop 页是否需要重开以刷新 Client 留作用户验收，不冒充既有窗口已核对。实际安装前回滚为 `staging-v1.0.0-alpha.1-5d42b1f/bundle`（已保留）；证据 `artifacts/v1/evidence/install-alpha7-20261022`。原生 @ chip/官方引用共存、真实多轮模型及成功率、宿主升级 Client/Host 一致性仍需真机联合验收。M6 发布硬化和公开发布不因本轮 CR 自动完成。

## M5 交付历史（当前候选以上文为准）

- **M5 开发完成**：[PR #21](https://github.com/heswy/dsh-video-editor/pull/21)，沿用用户既有授权选择合码。原生 @ 工程候选、引用搜索/复制降级、当前目标解析、持久回执/定向撤销、冲突保留意图与预演确认、响应丢失原请求重试已实现；任务与证据见 [M5](tasks/V1-M5-collaboration.md)。
- 当前唯一候选：bundle `1.0.0-alpha.6` / client+worker `0.8.0`，固定 runtime `bed1f8db3416eacb9cd4f858069df9229dd546c3`（root=engine、rootDirty=false）；同级 worktrees 的 `artifacts/p2-b/staging-v1.0.0-alpha.6-bed1f8d`，INTEGRITY SHA256 `07abdee2d82c165b80f105aa210492b8d459f8eb52bdc24d515196ce62ed90e5`。后续验收记录/验证器清理不改变候选运行时代码。
- 固定候选真实 Chrome 工作区 **37 项**通过（M3 手势 + M4 音频 + M5 引用/协作）；22s/660 帧 H264 + AAC 48k 双声道导出成功，声音预览偏移约 10ms。对话链 **261/261**、预览 **164/164**、真实引擎与画布链通过；候选源码只读审计 **91→91，无变化**。
- 新增 source 验证：引用适配/生命周期 **13**、真实 worker 协作 **18**、真实 Host 归属 **7**、中文操作契约 **30**；check/smoke/Host **58/86/71**、worker **72**、client **23**、版本 **10** 全通过。**30 条是确定目标/ops 的契约夹具，不是模型一次成功率**。
- 本轮未安装/重启 DSH、未发起原生模型请求、未公开发布。原生 @ chip 的实际刷新/发送/官方引用共存、真实模型 3+ 轮与 ≥95% 一次成功率及 M1–M5 用户联合验收仍待授权安装窗口。宿主 source 缺失时旧 chip 不会自动转普通文本，需删除旧 chip 后粘贴「引用」入口的 token；此真机路径待验。
- **下一阶段是 M6 发布硬化**，不是直接发布 1.0.0：长片/内存/取消失败、升级迁移与回滚、原生全链路用户验收、发布说明与明确发布授权。旧 staging、worktree、分支和用户作品保留。

## M4 交付时的历史记录（当前候选以上文为准）

- **M4 开发完成**：音频导入/生成、3 音轨、波形、音量/淡化/静音/增益、视频原声、带 AAC 的混音导出；轨道 UI 已按用户要求重做为轻量剪辑台。[PR #20](https://github.com/heswy/dsh-video-editor/pull/20)，按本会话既有授权选择合码。实现与证据见 [M4 任务卡](tasks/V1-M4-audio.md)。
- 当前唯一开发候选为 bundle `1.0.0-alpha.5` / client+worker `0.7.0`；runtime `81ffb1b104d6c781fabbe8d2f7ee668a5afe1acc`、root=engine、rootDirty=false；同级 worktrees 下 `artifacts/p2-b/staging-v1.0.0-alpha.5-81ffb1b`，INTEGRITY SHA256 `afbf1ac1d0314d8ec5fbade781cf56b1a918b4a7a1e2367daec88f0da7ce8eea`。初版 `e332611` 候选被默认音色版本号校验修复替代，保留追溯。
- 千问云旁白与音效真实生成通过；当前 key 音乐未开通（403），禁用重复生成并允许导入 BGM。本地 macOS say 旁白可用。凭据仅本机 0600 配置，不入仓库/模型/worker/staging；取消/超时可能仍计费，不自动重试。
- 固定候选真实 Chrome 音频工作区 **28 项**通过，含千问云生成→入库→上轨→精调→声音保持→22s/660 帧带音频导出；独立 21s/630 帧测试片 A/V 四点偏移 ≤1 帧，-16.01 LUFS，AAC 48k 双声道。1 GiB 流式/RSS/Range/引用删除保护与重启通过；其它回归与边界详见任务卡。
- 本轮按用户提供供应商凭据的要求做了必要短音频 API 验证；**未安装插件、重启 DSH、发起原生对话模型或公开发布**。本会话最后确认的已安装版本为 alpha.11，本轮未替换；M1–M4 的 DSH/用户素材联合验收在下一授权安装窗口执行。
- M5 原生 @ 与复杂协作尚未开发；本轮不扩到 M5。旧候选、worktree、分支和用户作品保留。

## M3 交付时的历史记录（当前候选以上文为准）

- 当前主会话负责 M3 及后续 V1 开发。用户本轮授权自行判断合码；M1 [#17](https://github.com/heswy/dsh-video-editor/pull/17)、M2 [#18](https://github.com/heswy/dsh-video-editor/pull/18) 已合入 main，开发基线 `00223dd`。
- **M3 时间线与视频轨**：开发完成，交付 alpha.4，包含时间线内核/原子操作/共享撤销、AI 场景、素材上轨、剪切/拖动/重排/trim、媒体+场景预览和静音导出；任务与验证见 [M3 任务卡](tasks/V1-M3-timeline.md)。不以 alpha.3 内核阶段作为终点。
- 版本为 bundle `1.0.0-alpha.4` / client+worker `0.6.0`。固定运行时代码 `0d5ccff`；候选 `artifacts/p2-b/staging-v1.0.0-alpha.4-0d5ccff`，INTEGRITY `1699378f796eff94415041642ab111886a74ad7774fe7bbc569d32eb1dd9865d`。按授权选择合码 [PR #19](https://github.com/heswy/dsh-video-editor/pull/19)；详细证据及限制见 M3 任务卡。
- 本轮没有安装插件、重启 DSH、请求真实模型或公开发布。M1/M2/M3 的真实 DSH 与用户素材联合验收仍待下次安装/重启窗口；这些待验项不冒充组件/真实引擎验证通过。
- M4 音频轨/音频生成尚未开发；M3 静音是明确阶段边界。M5 原生 @ 候选和复杂语义协作按计划继续。
- 0.3 alpha.11、M1 alpha.1、M2 alpha.2 固定候选、旧 staging 与用户工程全部保留。旧 0.3“手动编辑延期”不再限制已获用户授权的 M3 时间线。

## M2 交付时的历史记录（后续状态以上文为准）

- 用户已指派本会话负责 M2 及后续 V1.0.0 全部开发；规则见 DEVELOPMENT。main 稳定基线仍是 `1aabd6e`（PR #16），本轮没有改 main。
- **M2 开发 delivered，待真机验收**：素材库/流式上传/Range/缩略图/波形/兼容代理/AI `asset.list` 已实现；[M2 PR #18](https://github.com/heswy/dsh-video-editor/pull/18) 叠加 [M1 PR #17](https://github.com/heswy/dsh-video-editor/pull/17)，均为草稿、未合并。
- **唯一当前候选**：`artifacts/p2-b/staging-v1.0.0-alpha.2-939419e`（同级 worktrees/artifacts）；root=engine=`939419e10fe5e0b3b9c526d6bc580558d850c9cb`、rootDirty=false；bundle `1.0.0-alpha.2` / engine `0.5.0`；INTEGRITY sha256 `0ead5c6bf48b340dc6712fe457ee3c46cff46ce7603d05426a76b1a7ed3903fa`。
- 验证：check **58/58**、smoke **86/86**、Host **71/71**、stage-version **10/10**、worker **56/56**、client **23/23**、storage **21/21**、media **15 场景**、Chrome 素材 UI **13 项**。最终 staging 的 1 GiB 流式导入/重启/删除、引擎 frame/render/cancel、画布链通过；对话 **261/261**、预览 **164/164**、只读审计 same=true。
- 本轮未安装/重启/真实模型/合并/发布；M1/M2 真机验收在用户下一次授权重启窗口合并执行。素材进入作品和真实片段引用在 M3 接入；当前画布仍只读。详情、证据与未测边界见 [M2 任务卡](tasks/V1-M2-media.md)。
- 下一步：用户授权安装上述固定候选 → 核对实际 client → M1/M2 联合验收 → 当前会话继续 M3。0.3 alpha.11、M1 alpha.1、用户数据与旧候选均保留。


## 0.3 稳定线历史记录与回滚

更新：2026-10-21。**0.3.0-alpha.11 已通过真实 DSH Plugins 页安装并启用**（插件页 v0.3.0-alpha.11 / 1 of 1 运行中）；P3-028（darwin 收起侧栏顶栏居左）已随 PR #15 合并 main（merge `51b95dc`）。用户明确指示“**直接合码，这是 0.3.0 版本的最后一次改动**”，因此 alpha.11 **未等待重启后的最终视觉复核即合并**（组件/真 Chrome 几何/引擎/预览回归均通过，见下）；alpha.10 之前的用户 6 项验收结论继续有效。剩余为长期观察项（真实长片导出耗时/取消/失败、真实模型复杂多轮、极端窄窗/平台差异、宿主变量语义变化），见下。

## 当前基线

- **main是唯一长期主分支，代码与项目记忆均读origin/main。** 标准入口与路径规则见 [DEVELOPMENT](DEVELOPMENT.md)；未来bugfix从最新main建立独立codex/<问题名>分支，PR回main。
- 已合入 main：PR#1（规范/记忆整理）、PR#4（Client/Host/engine + UI 优化）、PR#5（UI 优化并入开发线）、PR#6（预览快照 CSP `'self'`）、PR#7（沙箱子资源公共 exact 路由）、PR#8（记录预览修复）、PR#9（P3-015 提速 / alpha.8）、PR#10（P3-016 面板/标题/移除显示设置）、PR#11（P3-017 预览稳定性/图片预览/产品导出 + alpha.9）、PR#12（alpha.9 收尾文档）、PR#13（P3-022 fileLink 本地预览修复 + alpha.10）、PR#14（alpha.10 收尾文档）、**PR#15（P3-028 darwin 顶栏窗口预留修复 + alpha.11）**。main 最新合并提交 **51b95dc**。
- 当前安装为 bundle **0.3.0-alpha.11**：固定 staging `artifacts/p2-b/staging-alpha11-51b95dc`（root=`engine`=`51b95dc`、rootDirty=false、bundle `0.3.0-alpha.11`、client/worker `0.4.0`；INTEGRITY.json sha256 `fd080d27086fa80bea8f4b0623d823c497c6281b8974ee1e0d0a2ac89db682ab`；目录约 203 MB）。通过真实 DSH Web GUI **Plugins → Add plugin（link staging bundle）→ Install → Enable now** 安装；插件页显示 **v0.3.0-alpha.11 / 1 of 1 运行中**。
- 回滚保留：alpha.10 staging `artifacts/p2-b/staging-alpha10-1cceb96`（INTEGRITY `6061004f…3e4f9`）、alpha.9 staging `artifacts/p2-b/staging-alpha9-573352e`（INTEGRITY `28f319b9…3b9e`）、alpha.8 staging `artifacts/p2-b/staging-alpha8-faster-turn-cf7e593`（INTEGRITY `988302e9…6857`）、alpha.7 staging 与用户原作品均未改动。
- 产品范围仍为右侧对话生成/续改、左侧自动只读预览/播放；手动编辑延期，无底部场景卡片。alpha.9 内容：A（右栏默认 42%/320–720px、可拖拽分隔条、双击/方向键/Home、比例持久化；`project.json` 可选 `title` + UI-only `project.rename` + 顶栏左对齐内联重命名；移除插件显示设置）+ B（预览 snapshot/ready 独立 30s 预算、1s revision 去抖、失败自动重试 1 次、旧画面保留、有界诊断；内嵌对话图片/文件点击插件本地 overlay；产品顶栏右侧“导出 MP4”真实阶段/百分比/已用时间/取消/下载、绑定点击时 revision；render 900000ms、frame 仍 120000ms）。alpha.10 增量：P3-022 修复宿主 ToolRow `fileLink` 折叠摘要点击（相对/绝对路径 → 插件本地 overlay，阻止原生 `openFile → sidebarRight`；img 分支优先）。alpha.11 增量（0.3.0 最后一次改动）：P3-028 修复 darwin 折叠侧栏时重复预留窗口控制区导致的顶栏右移——darwin 下 topbar leading clamp 到 16px，保留 top-clearance 下移，非 darwin/窄屏行为不变。

## 已验证与未验证

- **alpha.11 固定 staging 回归（2026-10-21，安装前）**：`test-stage-version` **10/10**；`test-ui-polish`（仓库 client）**27/27**、以 **staging client.js 字节** 再跑 **27/27**；`test-host-engine --staging <new>` **ok=true**（真实 Node/HyperFrames/Chrome/ffmpeg；frame PNG 273,055 B、demo 5s render MP4 137,707 B / 150 帧 / 30fps、取消→`cancelled`；integrityVerified）；`test-conversation-chain` **261/261 ok=true**；`test-conversation-preview`（real Chrome，fixed staging）**164/164 ok=true**（B1–B5 全 true、staging 只读审计 same=true）。独立 verifier P3-028 **PASS**。darwin 几何（真 Chrome、staging client 字节）：topbar `paddingLeft=16px`（旧 160px）、`paddingTop=56px`、返回按钮 `left=16/top=56`、作品名 `left=58/top=56`；清除变量后非 darwin 与基线一致。证据：`artifacts/p2-b/evidence/engine-run-2026-10-21T05-48-17-925Z.json`，其余运行产物在 `/tmp/p3-031-alpha11/`（未入仓）。详见 [P3-028 任务](tasks/P3-028-topbar-left.md)。
- **alpha.11 安装与“直接合码”决定（2026-10-21）**：真实 Plugins 页安装/启用成功，插件页 **v0.3.0-alpha.11 / 1 of 1 运行中**。用户明确指示“直接合码，这是 0.3.0 版本的最后一次改动”；按此决定 **未等待重启后的最终视觉复核即合并**——折叠侧栏顶栏居左的真机视觉确认仍属未复核项（组件/真 Chrome 几何已通过，安装本身成功）。
- **alpha.10 用户最终验收（历史，2026-10-21）**：用户 6 项全部通过并反馈“非常好，现在我觉得没什么问题了”：①右侧面板可拖拽加宽/模型选择可看全；②作品名左对齐可内联重命名（revision 不变）；③预览超时自动恢复；④`read_image` fileLink 点击不再弹 sidebarRight；⑤显示设置/简化效果已移除；⑥产品态导出按钮可用。
- **alpha.9 / alpha.8 历史事实**：alpha.9 首轮真机 UI 验收通过（splitter 42%→50% 且 reload 持久、rename、5s 导出约 10s）；alpha.8 真机 2 次真实模型请求通过（3 步/44.2s、2 步/39.3s，对比基线 14 步/536s）；证据 `artifacts/p3-015/evidence/`。
- **剩余长期观察项（不阻塞 0.3.0 收尾，继续用真实使用确认）**：
  - **真实长片导出**：真机已验证 5s 工程（alpha.9 约 10s）；用户 20s/120s 复杂作品的实际耗时、取消、失败/重试路径与下载耗时仍需长时间使用确认（/tmp 同源代码曾实测 20s≈28s、120s≈160s，非真机用户作品）。
  - **真实模型复杂多轮修改**：多轮复杂修改下的左侧自动更新、预览去抖/失败恢复仍需持续观察（alpha.8 只验 2 轮简单修改）。
  - **极端窄窗口/宿主字体缩放**：320–720px clamp 与左保底、模型名完整显示在极端环境下未做真机压力。
  - **平台差异**：非 darwin（Windows/Linux）的窗口控制区/leading 行为未真机验证；宿主未来若改 `--dsh-frame-leading-clearance`/`--dsh-frame-top-clearance` 语义，需重新核对 P3-028 修复。
  - **alpha.11 未等待重启视觉复核**（用户直接合码）；未额外发起真实模型请求；未在真机复测 3–4 连发 revision 的 retention 行为。

## 下一步

1. 0.3.0 版本线按用户决定在 **alpha.11** 收尾（最后一次改动已合并/安装）；用户以已安装 alpha.11 在 Vedio Editor 中正常使用，上述长期观察项通过真实使用持续确认。
2. 出现具体问题再从最新 main 建 `codex/<问题名>` 分支修复并交 PR；安装/重启/发布/合并按当次授权，不 reset/clean/强推，不自动跨会话联系。
3. 回滚入口：重新安装 alpha.10 staging `artifacts/p2-b/staging-alpha10-1cceb96/bundle`（或 alpha.9/alpha.8 staging）；保留用户工程、旧 staging 与作品。

规则：[DEVELOPMENT](DEVELOPMENT.md)；当前入口：[handoffs/README](handoffs/README.md)；产品：[PRODUCT](product/PRODUCT.md)；预览修复：[预览管线修复](research/2026-10-19-preview-pipeline-fixes.md)；提速记录：[P3-015](research/2026-10-20-faster-video-turn.md)。

## V1 M1（1.0.0-alpha.1）实现会话自测（2026-10-21，待 Lead 复跑/提交/staging）

- 分支 `codex/v1-m1-storage`（base `1aabd6e`）；候选版本已 bump **`1.0.0-alpha.1`**；**已 commit，候选 staging 由 Lead 构建，未安装/未重启 DSH**。
- 已完成 M1-01…M1-06 实现：稳定数据根（`~/Movies/DSH Video`，config `dataRoot` > env `DSH_VIDEO_DATA_ROOT`；目录 0700、不 chmod 父目录）、数据根两文件布局（worker `registry.json` 5 键不变 + `projects.json` 工程表）、旧 staging 只读迁移（`migration.json`、幂等、失败重试、session 合并）、registry/session/ui-state 容错与单工程 quarantine（含 map 从磁盘扫描重建 source=scan）、UI-only `project.path`/`project.reveal`（argv spawn、跨平台、错误 `E_REVEAL_FAILED`）+ 顶栏可见文件夹按钮与菜单「在 Finder 中显示/复制路径」、UI-only `ui.state.get/set` + 启动恢复 lastProjectId/比例 + 保存状态指示。
- 门禁（临时 HOME/dataRoot；真实 `~/Movies/DSH Video` 未创建）：check **58/58**、smoke-client **84/84**、check-host **71/71**、test-stage-version **10/10**、新增 `scripts/test-v1-storage.mjs` **21/21**（无外部 env 与 `DSH_VIDEO_DATA_ROOT` 外部注入两种跑法均 21/21）。
- 迁移演练：alpha.11 staging 数据副本（只读）→ 数据根，demo + 真实工程 `proj-mvhq5nnj-3eb8e5db` 与会话映射迁移成功；重复激活幂等、旧目录未改写。
- L3（alpha.11 staging 旧快照回归 + dataRoot 能力门控）：`test-host-engine` ok=true、`test-conversation-chain` 261/261 ok=true、`test-canvas-chain` ok=true；真实数据根未被创建/修改；conversation-preview/canvas-browser 本轮未跑。
- 已评审/复跑并 commit：`99532f1`（M1 实现）+ `5d42b1f`（bump `1.0.0-alpha.1`）。候选 staging 已构建：`artifacts/p2-b/staging-v1.0.0-alpha.1-5d42b1f`（root=engine=`5d42b1f`、rootDirty=false、bundle `1.0.0-alpha.1`、client/worker `0.4.0`；INTEGRITY sha256 `55e61ebbabee4df92b44d5ba6c3429a7bea5f7c58e2c27e8f9b58c50f55f958c`）。
- M1 候选 L3（真 staging）：`test-stage-version` 10/10；`test-host-engine --staging` **ok=true**（real Chrome/ffmpeg，frame/render/cancel）；`test-conversation-chain --staging` **261/261 ok=true**（stagingReadOnly.same=true）；`test-canvas-chain --staging` **ok=true**；`test-conversation-preview --staging`（real Chrome）**164/164 ok=true**；真实 `~/Movies/DSH Video` 全程未创建（harness 隔离断言）。
- 待用户授权安装 alpha.1 并做 M1 真机验收：重启≥3 次数据在、旧工程迁移、可见文件夹按钮/菜单、保存状态、上次打开恢复、registry 单条破坏演练；回滚 = 重装 `artifacts/p2-b/staging-alpha11-51b95dc/bundle`。
- 已知限制：迁移在首个业务请求同步执行（大工程可能拖慢首次 project.list，M3 评估后台化）；非 darwin 默认数据根与 reveal 命令未验证；v1 默认数据根以 macOS 为准。
