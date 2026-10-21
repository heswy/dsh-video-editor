# V1 M3：时间线与视频轨

日期：2026-10-21。开发：当前主会话；用户明确指定继续负责 M3 及后续 V1，并授权自行判断合码。分支 `codex/v1-m3-timeline`，独立树 `v1-m3-timeline`，base `origin/main` `00223dd`（M1 #17、M2 #18 已按本轮授权合入）。本轮直接交付完整 `1.0.0-alpha.4`，不以 alpha.3 内核阶段作为终点。

遵守 [DEVELOPMENT](../DEVELOPMENT.md) 和 [V1 开发规范](../plans/V1.0-DEVELOPMENT-GUIDE.md)。用户继续开发的最新指令覆盖旧文档中 M1/M2 真机完成后才进入 M3 的执行顺序；安装、重启 DSH、真实模型请求和公开发布未在本轮执行。

## 实现与契约

- `timeline.json` 为 `dsh-video/timeline@1`：settings、assets、tracks/clips，整数帧 @30fps；content-addressed scene HTML 留在 `scenes/<sha256>.html`。原有 `project.json` 与 `index.html` 保留作 legacy/回滚入口，不接受其反向覆盖时间线。
- `_history`、`_cursor`、`_operations` 为同文件事务日志。真相与日志一次临时文件写入、fsync、rename，避免多文件提交中断造成历史/作品不一致。revision v2 对不含日志的规范化时间线求 SHA-256，包含媒体内容摘要及场景内容摘要。媒体字节和派生物不进入日志。
- 共享 API：`timeline.inspect/apply/resolve/undo/redo`、`scene.compose/inspect`。UI 与 AI 使用相同 expectedRevision、operationId、原子 batch 和历史；相同请求重放同一回执，复用 ID 改 payload 拒绝，冲突必须重新检查，不自动覆盖。
- 19 类操作：clip split/trim/delete/move/reorder/insert/duplicate/speed/replace/volume/fade/set/transition；track add/update/remove；timeline.settings；scene insert/replace（后两者由 scene.compose 封装）。音量/淡入淡出字段为 M4 契约占位，本阶段预览与导出为静音。
- 默认总长随片段终点自动计算；显式 timeline.settings.durationFrames 固定片尾，可用 durationMode:auto 恢复自动。ripple 删除/trim 会正确缩短自动总长。
- 同轨禁止重叠，跨轨按顺序合成；显式 ripple/overwrite；split 左段保留 ID，右段新 ID，sourceInFrame 按源 fps 换算。ID 不按序号生成。位置/label 引用先 resolve；歧义返回候选。
- 回执包含 revision、written、applied、lineage、受影响对象、中文变更摘要、undoHint。历史保留 50 步、幂等日志最多 2048 项，文件上限 32 MiB，满额明确失败而非删改用户记录。
- 105 场景以上的预览清单走 worker 私有 preview.files 分页；Host 注册完整路由，UI 返回限量文件元数据，避免 64 KiB 消息限制。
- 生成 composition 为可重建的只读派生物。媒体在 job/预览快照中 hardlink，跨盘 copy fallback；Host 使用流式 Range/HEAD/206/416。不会将 1 GiB 媒体读入文档快照 Buffer。
- 独立场景实例使用稳定 clip ID 注册到合并的 GSAP registry；生成副本调整旧场景注册，不改场景源。预览 sandbox 子场景通过受限 postMessage 同步时间；引擎通过 data-media-start 对齐源偏移。
- crossfade 用下一视频片段入点的确定性静帧叠化，边界后进入正常播放；无源前置 handle 时不会偷跳素材时间。支持视频/图片相邻片段；AI 场景转场不开放。全片时长不因叠化改变。
- 不兼容视频需先从素材库生成兼容副本；时间线使用该副本，缺少副本时明确提示，不提交不可播片段。媒体按流式摘要校验，外部同大小改写也会被拒绝。
- 预览支持媒体 play/pause/seek、黑场间隙、层叠和场景移位；时间线播放头每 33 ms 同步。导出时长按帧验证、30fps H.264；按帧数给出自适应超时（上限 6 小时），现有取消/重试/下载沿用。
- UI：标尺、轨道、片段选择、拖动/换轨、双边 trim（键盘逐帧）、S 切分、Delete 删除、重排、复制、速度、缩放、吸附、片条、共享撤销/重做；素材按钮/拖放上轨，持续保存和冲突反馈。
- 首次打开时间线惰性迁移旧整篇作品为一个场景。保留原 HTML/manifest 的按 revision 备份与 scene 内容副本，不覆盖既有备份；不批量迁移用户目录。legacy 工程继续支持旧动作；迁移后旧写动作明确返回 E_TIMELINE_MODE。
- 当前使用或撤销历史引用的素材拒绝删除；未使用的素材元数据不会被误判为片段引用。旧工程与固定 staging 不被删除。

## 验证

新增：`test-v1-timeline.mjs`（真实 JSONL 事务/重启）、worker `timeline.test.mjs`（操作/约束）、`test-v1-timeline-browser.mjs`（真实 Host/Chrome 手势/预览/Range）、`test-v1-timeline-migration.mjs`（真实引擎视觉/源时间/回滚）、`test-v1-timeline-render.mjs`（20 秒视频三段重排/混排输出）、`test-v1-timeline-large.mjs --large`（1 GiB 快照 RSS/引用保护/重启）。

旧 composition 预览保留测试通过 `timelineEnabled:false` 明确测试 legacy 路径；M3 新界面另走真实 Host/Chrome 测试，不以 legacy fixture 宣称时间线 UI 验证。

最终计数、固定候选和证据摘要在交付时填写；真实 DSH 激活/用户素材与真实模型语义操作仍待下一次安装和重启窗口，不与组件/引擎测试混称。
