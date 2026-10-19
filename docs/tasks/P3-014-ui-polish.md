# P3-014：克制的对话视频工作区

2026-10-19 用户明确指定当前 Codex 直接实现，并新开分支。此为本轮职责例外；不自动派发、不影响 video-studio 正在进行的真机验收。

- 基线：video-studio 19a7743；分支 codex/ui-polish，工作树 ../ui-polish。
- 风格：暖白/原生深色主题、作品为视觉中心、细分隔、紧凑导航、小面积玻璃播放条；不引入字体/CDN或装饰插画。
- 范围：合并顶部工程导航；名称替代技术 ID；新建收进选择菜单；居中预览舞台、播放条置底且图标化；原生对话铺满剩余高度并保持底部 Composer；减少重复标题；必要的真实加载/更新/失败反馈。
- 保留：Host/engine、原生 Session/模型/附件/权限、自动 revision 跟随、双实例失败保留、用户只读预览；不加手动编辑。
- 验证：现有检查、工程切换/显式新建/无技术ID/无障碍播放行为；真实 Chrome 布局与响应式、明暗主题、对话长内容及 Composer 底部；固定候选真实预览失败/更新链。
- 安装不在本轮范围：不改 profile、已安装 staging 或用户作品，不重启、不发模型请求、不 merge main。

## 执行记录

- 直接授权已执行；基线 npm run check 181/181、版本门禁10/10通过。
- 两项导航/播放行为回归先在旧实现失败（75 pass/2 fail），实现后通过；新增15秒预览等待超时回归在旧实现失败，加入只读超时结算后通过。保留原全部行为回归；旧三个可见 Session 标题断言按明确的标题简化需求改为检查可访问标题，绑定/历史/迟到切换断言保留。
- 实现：工程入口合并到56px顶栏；名称取 inspect 的场景标题/文本，未知工程以本地展示序号区分，ID仅作为请求身份；新建收进原生选择菜单。右栏只保留标题、图标新会话与历史，Session 标题保留在可访问名/历史。播放条置于画面下方并图标化，细进度条、轻玻璃效果。只读舞台统一底色、完整居中；未 ready 不显示空黑屏；候选更新保留旧画面并提示。
- 原生对话沿用 Provider/Factory 与全部交互，新增自身高度边界，仅用已核实的 data-conversation-* 属性约束布局，不引用宿主 hash 类/替换 Composer。无响应的预览请求/就绪握手15秒后可重试；使旧尝试失效并释放迟到快照，不发布迟到候选，不取消模型或写工程。
- 最终本地闸门：184/184（52静态+78Client+54Host）；版本门禁10/10。
- Chrome组件布局/交互15/15：明暗、长对话底部输入、窄窗/小窗、竖屏比例、SVG命名空间、键盘进度、简化效果和减少动态。真实产品源码/CSS/固定预览runtime；Host和原生会话DOM是明确的契约替身，非实际DSH/模型验收。截图/JSON在本树 artifacts/ui-polish/。
- 修复测试 renderer 的SVG命名空间与属性别名，解决测试截图控件不可见，不改变生产 React 或验收断言。
- bundle候选0.3.0-alpha.5，engine未改。固定候选结果见下；未安装/重启/改profile/发模型请求。


## 冻结交付

- 功能提交 `65dcac4`；[PR #5](https://github.com/heswy/dsh-video-editor/pull/5)，base 为 `codex/video-studio`，不直接合入 main；分支已普通 push。
- 固定 staging：同级 `artifacts/ui-polish/staging-alpha5`；root `65dcac4` / engine `0deef8f`，rootDirty=false，bundle `0.3.0-alpha.5` / 两引擎包 `0.4.0`。INTEGRITY SHA-256：`f25707f03eaf0b1e2a3f71df36162f9caa10d81d30dbfdb353948de3e79d9a82`，bundle22/client18/worker38条逐文件字节与摘要全部匹配。
- 固定包：同级 `artifacts/ui-polish/65dcac4/dsh-video-0.3.0-alpha.5.tgz`，117,401 bytes / 23 files；SHA-256 `236b9b79cbb82a08082ac9e510c6493885a1a07f74a36f778d6805f08ead40ec`，23/23与功能提交原文逐字节一致。
- 固定 staging 真实 Host/Tool/worker + Chrome：正常生成/续改链 **261/261**；`DSH_R2_STRESS=1` 预览 **159/159**，原失败保留/元数据/消息/释放断言全部保留，teardown通过，不可变源80/80未变。原始证据在同级 artifacts/ui-polish/{chain,preview}/。
- 组件 Chrome **15/15**，源码摘要、检查与6张截图在本树 artifacts/ui-polish/evidence.json；右侧原生对话DOM/Host为显式替身，截图不能当作DSH真机验收。
- 本轮只读核对本机包版本 `0.2.1-rc.2` 的官方 skill、ui-plugin参考及 conversation region 属性；没有更新宿主/读取凭据或个人会话。
- 最终已安装状态未改。实际 DSH 中的原生 Composer、审批 takeover、长会话滚动焦点与本轮CSS共存仍需安装后验证；主流程模型验收仍由P3-013跟踪。不以单会话自产测试称独立验收。
