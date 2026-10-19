> **已被用户最新范围取代，停止按本指南实现。2026-10-18：当前唯一任务为P3-012-conversation-first-mvp.md，用户手动编辑后期再加；以下仅历史。**

# P3-011：修通用户实际创作与画布闭环

日期：2026-10-18。执行video-studio，统一分支/工作树，DEVELOPMENT是唯一通用规则。用户已授权合码和单会话后续开发；收到本指南即开始实现，不重开同类调查。基线为统一集成提交（包含p0 fdb6bc2、p1 c31fde5及最新协调）；不切回旧树。

## 已确认故障事实

1. profile依赖已经指向staging-d383e3d-7d60312/bundle，安装目录client SHA ec2ff3ff067be7a522ec745d9b9ea392e4c39a8398b47c57c4006b631c268a2c；不能仅凭猜测让用户重启。浏览器内存中的模块身份尚未直接查询。
2. 用户的proj-mvdj6wfb-ee01ea55/index.html（只读）包含SVG/GSAP/__timelines，5秒1280×720，但没有data-scene-id，内容hash39ecc4e874d19c6d10d1013f93299b11845e42e55a486f5ec59acb691b33efed。前端VideoWorkspace只在scenes.length>0挂CanvasWorkspace、启revision轮询，其余退到旧PNG/表单；截图显示该旧分支。AI产物存在不等于左画布同步。
3. demo无Scene，hf-orb为div空叶子，CSS背景#b1ebcd，现legacy能力只有text/timing；托管模板的style不能直接作用于它。模型因此在旧工程上反复读README/Git，而非完成用户一句改色。
4. 当前snapshot writer按manifest拷贝项目，不要求template Scene；Host现有runtime硬编码main/timeline等假设须核对，demo根/时间线可能不同。不要只改scenes条件就宣称兼容。

## 目标与允许范围

同一会话可改根Client/Host、packages/video-engine-*、固定runtime、打包/配置/locale/README及任务回归，更新本任务/research记录；全局记忆总调度维护。不改宿主、不临时开放任意主进程代码/路径/网络权限，不绕过revision/资产归属。若需协议新字段/版本，同会话同步schema、Host/Tool/UI与锁版本；JSONL v1既有方法兼容。没有跨owner等待。

A. **合法composition的预览与播放不依赖template Scene存在。** 按真实可用的composition尺寸/时长/时间线与预览能力判定；使用现有私有快照+精确路由+sandbox/CSP，保留实例/TTL/清理。用户两类样例都可自动显示、播放、seek；文件变更/AI写入后重新inspect并更新画布，不强迫重开，不永久“画面尚未生成”。错误可见且可恢复。必要时PNG/MP4作为明确的只读降级，不能冒充直接可编辑画布或唯一修复。

B. **demo球真实改黄。** 给稳定id上的受支持基础形状提供typed背景色编辑（可选语义edit.ops style.styles.backgroundColor，先记录并统一schema/Host/UI/Tool）；inspect明确当前值与可写属性。CSS简单规则/inline处理不得把动画transform写死、改文案冒充改色、整工程改主题或扩展任意CSS。受控DOM元素而非所有SVG/Canvas对象自动有此能力。闭环包含写盘/revision/重开与真实帧黄色像素，球以外内容/GSAP动画不变。

C. **AI知道作品模式、能力和交付契约。** 注入当前项目身份/revision/可用目标和允许样式、精确编辑入口；一次inspect后用工具完成普通改色，不找开发仓库/README/Git，不把“运行命令调研插件”当用户创作流程。不支持的能力明确快速反馈，不两分钟空转。创作完成以绑定工程权威结果与可加载预览为依据，未能预览时不得声称左侧已可见；任意HTML生成与受模板管理结构的差别必须诚实，不能无声降级后继续宣称完全可编辑。

D. **创意生成与可编辑结构的缺口单独给结论。** 以鹈鹕SVG动画为真实样例，复用现有受控浏览器预览证明能播放；哪些对象能text/layout/style，哪些仅代码/只读明确到inspect能力。不把内置产品发布模板当最终创意生成上限，不把任意脚本安全执行误报为已解决。如新增生成发布入口需要超出现有安全边界，给最小可审协议提案及失败探针；先完成A/B/C可独立修复，不擅自执行无边界代码。

## 验证与交付

- 将公开legacy fixture或用户样例的必要结构**复制到任务自有临时工程**，复制只读源，不修改原件/用户staging。原图/完整用户对话不入库；可构造等价不含私密信息的SVG鹈鹕fixture。
- 真实组件浏览器：scenes=[]、合法composition，进入即出画面，播放/seek，AI等价写入后自动跟进；template→non-template转换不空白，失败与过期能恢复；旧受控Scene的原位编辑/letterbox/草稿/重试/消息回归保持。
- Host Tool→worker：inspect→hf-orb改背景黄→自动刷新/真实帧黄像素→close/reopen一致；GSAP字节保持、其它对象/人工覆盖不丢；非法颜色/属性/目标/跨工程拒绝；schema、版本一致。
- 比较不受控生成工程的预览失败与工具耗时，在本地副本给时间线，不用新增真实模型请求凑证据。AI prompt/工具shape用受控Agent/上下文测试；后续真机/模型另按具体授权。
- 新固定提交、统一source root/engine commit、新包与新staging/完整摘要；旧安装/旧作品不覆盖。版本按必要接口变化升级，不只改根版本掩盖旧引擎。普通push统一分支/更新草稿PR，任务与research写分项通过/失败/未测，一次交总调度。

不安装/启停/重启、不改profile/用户工程、不发新模型请求、不merge main、不自动联络/派发开发Agent。旧P3-007安装测试不自动继续；当前任务是修复其真实失败。
