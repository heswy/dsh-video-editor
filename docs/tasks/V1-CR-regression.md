# V1 M1–M5 CR 与验收前回归（2026-10-22）

用户要求在入场验收前完成 CR 与整轮回归。基线 `d2ddd5643b5d395f03c494b14adae61ebd05e40b`（M5 PR #21），隔离分支 `codex/v1-cr-regression`。沿用当前会话开发、修复、验证与自行判断合码授权。原生安装、重启、真实模型和公开发布仍按 DEVELOPMENT 执行。

## 审查修复

| 等级 | 触发与影响 | 修复与复现保护 |
|---|---|---|
| P1 | 旧工程复制中断会留下最终目录；重试遇到 EEXIST 后误注册半成品。未注册的已有目录也可能被混入文件 | cache 下完成副本后 rename 发布；失败只清理本次临时目录。已有目标完全保留，明确 `E_PROJECT_TARGET_EXISTS`，不宣告迁移完成。Unix socket 诱发真实 fs.cp 失败，验证无最终目录、重试成功、已有目录不混写、不注册 |
| P2 | 51 次编辑起回执 cursor=51，实际历史上限=50，导致定向撤销失败；撤销后无操作回执错误报告不能重做 | 回执使用截断后的游标，no-op 保留 redo。真实 worker 连续 52 次编辑、定向撤销、no-op、重做 |
| P2 | `loudnessTargetLufs` 接受但导出始终 -16 LUFS | 混音、两遍响度分析和导出元信息使用工程值；按本机 FFmpeg loudnorm 支持范围验证有限数值 -70…-5，缺省 -16。增加非法值与 -20 导出测试 |
| P2 | 隐藏视频轨时预览无声而导出保留原声 | 隐藏仅关闭画面，视频原声用 audio 标签继续预览；静音独立控制两端声音。隐藏轨不输出转场画面；单测验证隐藏/静音组合 |
| P2 | 有待恢复的编辑冲突时从素材库加入时间线，请求被消费但写入被阻止，素材静默丢失 | 保留排队素材，冲突处理完成后消费。真实 Chrome 用例先复现超时，再验证处理冲突后自动上轨 |

素材删除疑点复核：当前 `Timelines.read` 已仅检查片段引用的媒体，不构成新缺陷；增加删除未使用素材后的 inspect 回归保护。代码审查与自动化不能替代用户/原生宿主验收。

## 验证记录

证据目录：同级 worktrees `artifacts/v1/evidence/cr-20261022`。全部测试使用临时工程/HOME/dataRoot；不写用户作品、凭据、旧 staging。音频供应商测试使用本地/假供应商，不重复付费请求。

- 候选 bundle `1.0.0-alpha.7` / engine `0.8.1`；干净 runtime/root/engine `bfc34d13bb3398236d5ec0535049edc4e25358e3`。后续报告提交不改变运行时代码。
- 固定目录：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p2-b/staging-v1.0.0-alpha.7-bfc34d1`。INTEGRITY SHA256 `4cce9e034194646c3c75e785b25e56d2a845d47af4055abe5ea40d2e5013dfe8`。
- source：check/smoke/Host **58/86/71**，worker **74**、client **23**、版本 **10**；storage **21**、media **15**、协作 adapter/worker/Host/中文契约 **13/18/7/30**。新增 `npm run test:cr` 验证 52 次编辑、定向撤销/no-op/redo、删除未使用素材、真实复制失败/重试/目标目录保护。
- 真实转场渲染 120 帧：红→紫→蓝采样通过，取消重试/proxy 通过；混合场景渲染 600 帧通过。105 片段分页、107 内部文件及公开/inspect 上限通过。
- 固定候选：真实 Chrome 工作区 **38 项**（宽/340px 窄窗口、手势、音频生成/上轨/增益/淡化/静音、冲突预演/重试/素材排队、引用与导出），22s/660 帧 H264 + AAC 48k 双声道。默认混音重新测量 **-16.02 LUFS**。
- 固定候选真实 Host→worker、画布链、对话链 **261/261**、预览链 **164/164**、1 GiB 流式导入/硬链接快照/Range/引用删除保护/重启通过；候选源码只读审计 **91→91、same=true**。
- source 自定义 -20 导出：21s/630 帧，**-20.01 LUFS**，四点 A/V 最大偏差 **21.4ms < 1 帧**；候选包同项复测 **-20.01 LUFS**，630 帧、最大偏差 21.4ms，见 `audio-staged.log`。汇总 `verification-summary.json`。
- worker 真渲染取消、超时、stdin EOF、shutdown/SIGTERM 的自有进程清理用例通过。没有全局终止用户浏览器/进程。

## 安装与回滚卡

唯一新候选通过 DSH **Plugin Manager 的 link 安装流程**指向上述固定目录内 `bundle`，并使用同目录 `config.json`。这是本机开发候选，依赖相邻 engine 目录，不能只拷贝 bundle 当便携发布包。安装后必须核实 bundle alpha.7、Host 与实际 Client 的候选一致性，再按下方清单验收；出现旧 Client 时遵循 DEVELOPMENT 的重启授权规则，不修改候选文件。

本轮只准备候选，没有执行安装。回滚仍通过 Plugin Manager link 回上一固定包 `staging-v1.0.0-alpha.6-bed1f8d/bundle` 及其 config；历史 alpha.11 `staging-alpha11-51b95dc/bundle` 也保留。不要删除稳定数据根、用户作品或旧 staging。此版本无 timeline schema 升级；对已有未注册迁移目标仅报错并保留，需检查后人工恢复，绝不自动覆盖。


## 用户验收顺序

1. 新建/切换/重开工程，确认作品、Session 和面板状态正确归属；旧工程迁移后原目录仍在。
2. 导入图片、视频、音频，上轨、拖动/剪切/trim/复制/排序、撤销与重做；撤销后重做，连续编辑后定向撤销。
3. 旁白与原声、静音、音量、淡入淡出；播放、跳转、导出，核对音画和响度。
4. 原生 @ 与复制 token 引用，进行多轮续改；并发冲突先预演确认，网络响应丢失重试，确认不重复写入。
5. 宽/窄窗口、长素材列表，失败/取消后仍能继续编辑；关闭再打开，确认作品与音频仍可用。

真机仍待验：DSH 原生 @ chip 刷新/发送/官方引用共存、实际模型多轮与成功率、宿主升级 Client/Host 一致性。本轮不将中文 ops 契约或组件浏览器数量写成模型成功率。
