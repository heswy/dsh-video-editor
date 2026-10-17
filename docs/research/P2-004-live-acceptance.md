# P2-004 真机安装与验收记录

日期：2026-10-17。执行：用户（安装操作）+ 总调度（验收与记录）。范围：DSH Desktop `0.2.1-rc.1`、本机 profile。

## 安装事实

- 用户授权后，先在 Plugins 页面卸载已装 `dsh-video 0.1.3`（DSH 对第三方插件不支持原地升级），再以 **Add plugin → 本地目录 link** 方式安装 `0.2.0`。
- 安装目标：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p2-b/staging-54f4671-fa7b0e2-clean/bundle`
- profile 依赖：`"dsh-video": "link:/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/p2-b/staging-54f4671-fa7b0e2-clean/bundle"`；`node_modules/dsh-video` 为指向该目录的符号链接。
- staging 来源：代码 `fa7b0e2` + 已验收引擎 `54f4671`；`INTEGRITY.json` SHA-256 `cc4490da5285887b47868fe2e868560792e5cc690a9f8f037b6e1131c07a2f11`；staged Host `bundle/host/bridge.js` SHA-256 `07442c86a4c4bc072576719efe99be5615e7b55437d3e9183ec8ef0e5fde0fee`；源文件 bundle 16 / client 12 / worker 15；`rootDirty:false`。
- 回滚保留：0.1.3 固定包 `…/artifacts/p0-mode-shell/51c82a9/dsh-video-0.1.3.tgz`（SHA-256 `82def6de6129333179e015b9e841d967517ccc0def92cc48f677f0082a77f897`）及解包目录 `…/51c82a9/rollback-0.1.3/package`，可经 Add plugin 直接装回。
- 注意：staging 目录内含指向 engine-client/worker 的相对链接，**不可移动或删除**，否则插件失效。

## 已真机验证（2026-10-17 约 17:20）

事实来源：真实页面截图（用户提供，含私人侧栏信息，不直接入库）+ 本会话 Tool 实际返回。

1. **加载与入口**：插件在 profile 中启用；左侧导航「上下文洞察」之下、「工作区」之上出现并选中 **Vedio Editor**（细线条视频图标），工作区渲染为真实编辑界面。
2. **真实工程界面**：标题「让创意成为影像」；右上元信息 `1280×720 · 5.00s`；主画面显示真实渲染帧（深绿渐变、眉题、标题、副题、圆点、底部说明）；右侧「更新画面 / 导出 MP4 / 重新读取」、target 选择器 `hf-title · text, timing`、标题输入、开始/时长、保存修改、属性区。
3. **Tool 注入**：`video_engine` 已作为本会话可用 Tool 出现。
4. **Tool doctor**：Node `v24.21.0`、HyperFrames/SDK `0.8.167`、GSAP `3.15.0`、Chrome `155.0.8059.79`、FFmpeg/ffprobe `8.0.1`。
5. **Tool open**：受控 `demo` revision `135a529…`、1280×720、5s；7 个元素含 `hf-eyebrow`（仅 text，位于前）与 `hf-title`（text+timing），与 R1 的眉题在前结构一致；资产清单含字体/GSAP/入口及 SHA。
6. **Tool frame + status**：2.5 秒抽帧 job 成功，PNG 275,744 B、SHA-256 `efca929677830434624a262bc13b2f6e1dd39af70619e3455c6753ac079441db`、1280×720、frame 75、`survivors:[]`、`cleaned:true`；该 hash 与 P1 受控证据一致，说明真实链路确定性。
7. **安装状态**：`node_modules/dsh-video/package.json` 为 `0.2.0`；0.1.3 已移除（回滚目录保留）。

## 真机验收发现的问题

- **V1（视觉/对比度，2026-10-17，已在 0.2.1 修复）**：0.2.0 深色模式下主按钮「更新画面」白底白字。根因：`.dv-button-primary` 使用宿主不存在的 `--dsw-alias-label-on-brand`（fallback `#fff`），深色主题 `--dsw-alias-brand-primary` 为近白色。0.2.1 改用 `button-primary-fill/hover/dimmed` + `label-primary-foreground` 配对 token（R1 复审通过），用户 0.2.1 深色截图确认主按钮可读。待补：浅色实图、hover/focus-visible/disabled 视觉，及画面时间点输入是否可用的实际点击证据。
- **V2（取消导出显示错误，2026-10-17，0.2.1 实测，已排 P2-006 R2）**：导出进行中点「取消」后，job 终止 `cancelled`、状态显示「已取消」，但同时出现红色「操作失败。」。根因：`waitForJob` 终止态用 `state !== 'succeeded'` 设置错误，用户主动取消被误判为失败。应在 cancelled 时保持中性、不报错；failed/timed_out 才报本地化错误。
- **V3（时序越界透出英文原文，2026-10-17，0.2.1 实测，已排 P2-006 R3）**：开始 `4` + 时长 `5`（工程 5s）被 worker 拒绝，UI 原样显示英文 `Timing extends beyond composition`。引擎拒绝正确，但客户端缺 `start + duration <= duration` 的本地校验与本地化提示。
- **播放能力缺失（未解决）**：0.2.0/0.2.1 仍只有单帧预览 + 导出 MP4，没有插件内播放按钮；A1（隔离 iframe + 快照 + 固定 runtime）已证明可行但未实现，按已定优先级后置（P3 之后）。
- **抽帧时间点已验证（2026-10-17）**：真实 Host Tool 独立抽帧 0.1s / 0.5s / 2.5s，hash 分别为 `949350af…`（frame 3）/`0240f557…`（frame 15）/`efca9296…`（frame 75），互不相同且各自成功；UI 画面时间输入工作正常。

## 0.2.1 安装记录

- 2026-10-17 用户卸载 0.2.0 后以 link 安装 `staging-54f4671-bdcfd72/bundle`；profile 依赖指向该目录，`node_modules/dsh-video` 为符号链接；插件版本 `0.2.1`。
- 用户截图确认：深色模式下主按钮「更新画面」可读；右侧新增「画面时间（秒）」输入（默认 2.50）；工程/画面/元信息正常。

## 待验清单（继续真机验收）

- UI 编辑闭环：改标题/时序 → 保存修改 → 更新画面 → 新 revision 的帧（旧帧不冒充）。
- target 选择器切到 `hf-eyebrow`：仅显示 text、隐藏 timing；切回 `hf-title` 正常。
- 导出 MP4：真实状态/进度、成功产物可播放、取消行为。
- 修订冲突与错误就近显示（例如旧 revision 保存）。
- 返回对话保留会话/草稿；再次进入保留工程与播放位置。
- 明暗主题、窄窗、字号；插件停用/启用/重启、worker 启停与孤儿清理。
- Tool 的 edit/close 路径与 UI 共用 dispatcher（可在验收中另测，避免与用户手动编辑冲突）。
- artifact 路由浏览器字节读取（PNG/MP4）。

## 当前限制

- **0.2.0 没有插件内播放/时间线**：按本阶段任务范围，界面只提供单帧预览（固定 2.5s）与导出 MP4 下载，播放只能靠下载后的 MP4。用户 2026-10-17 提出希望在插件内播放——这是合理需求，属于后续「预览」能力，不进 P2-004 验收；候选方案 A（隔离预览面嵌入 HyperFrames Player/Studio，支持播放/seek，需先验证隔离）与 B（抽帧逐帧/时间点预览，轻量但非真播放），待用户定优先级后排任务。
- 真实链仍是受控 `demo` 工程，不含用户素材、多 Scene、AI 生成；P3 尚未开始。
- staging 为开发 link 快照，非可移植发行包；移动/删除目录会使插件不可用。
- 未做 OS 沙箱/多用户权限；不能宣称任意生成代码安全。
