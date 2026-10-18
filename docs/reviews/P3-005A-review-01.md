# P3-005-A 复审：原生创作会话接入调查

日期：2026-10-18。对象：`653d170`、`87c70a1`、补充`7daa039`，p0-mode-shell / PR#3。结论：**调查验收通过，可进入实际接线；不是嵌入UI真机通过。** 不再追加同类调查轮次，以下实现约束并入P3-006-A。

## 独立核对

- 工作树干净，差异4文件，仅probe/README、任务和研究记录，未改client/Host/engine。`node --check spikes/dsh-native-conversation/asar-read.mjs`通过。
- 总调度用独立ASAR header读取方式核对本机包内源码，不执行包代码或读取profile；重点验证renderer standardKit、ui-session bindingSource、ConversationContent/ConversationSession、ui-workspace mainReference与create、ui-approval takeover、Tool执行context调用点。与调查主体路线一致。
- `standardKit`始终提供renderFactorySlot；children有非root scope时提供SessionProvider；显式reference必须属于当前Controller generation。main默认不绑定Session，私有child+Provider是合理接法。
- 原生Factory拥有body/Composer，header在Factory外；hero触发宿主workspace导航，嵌入必须hero:false；`view:'chat'`确实由DefaultConversationViews读取，可选用该owner参数锁定Chat，不是猜测字段。
- 原生create只请求Host并发布Session列表，没有导航；必须使用返回id。模型/审批由宿主原生seat/chain提供，不另建key和模型接口。
- `retainInfo(id)`返回可订阅source，读取需要`.getSnapshot()`；必须订阅变化而非只在挂载检查一次。ready不等于openState成功，reference释放后不得继续交给Provider。
- 源码确认同binding共用编辑器，第二editable root会抢占；用户消息正文/附件的权限不可从任意attachment id推断。

调查中的live Inspect及运行进程身份为开发者证据；本轮总调度独立核对是随包源码，不升级成总调度live验证。部分Inspect超时、未知receipt通路与实际React清理时序保留未测。

## 实现澄清（直接带入下一任务，无需先返工调查）

1. **retain不是可见性。** `ui-workspace.replaceMain`持有mainView引用并只在clear/replace时释放；切换main keyed panel不会自然清掉该引用。仅判断`retainedBy.mainView>0`就拒绝视频嵌入会误锁返回路径。应结合当前panel可见性/同一React树先卸载后挂载的边界；主Conversation确已卸载时不能因保留引用而永远拒绝。对其它可见编辑occurrence仍需防双根。补“mainView计数非零但普通面板已隐藏→视频可用”和反向导航的回归。
2. **Agent身份以真实可信执行context为准。** 调查同时出现`exec.agent.id`和源码`exec.agent.session.id`两种写法；后者在随包dsh-tools调用点存在。接线时核实实际Agent契约、在Host adapter集中提取，测试缺失/不一致拒绝；不可用工具参数sessionId代替真实调用身份。
3. **元数据归Host。** 调查提到工程目录下自有文件仅为存储提案，不能因此让Host直接改worker的project.json、registry或revision输入。使用插件自有、配置明确的会话映射存储，队列化原子写。

## 已收敛的产品选择

- 工程会话可以被宿主正常搜索/历史发现，不承诺隐藏；不自动创建新Workspace，不archive来隐藏。插件自己的历史只列Host已登记到该工程的会话；标题可用工程名前缀。
- 工程专用会话用可信工程cwd创建，不能接受UI任意cwd；不修改宿主普通会话/工作区选择；模型选择对当前创作Session生效，不改全局普通会话。
- retain source统一`videoView`，不借mainView。普通视图与嵌入交替挂载同一编辑器；不同时创建两个可编辑根。
- 审批沿用原生takeover和拒绝/取消交互；首版不添加第二套独立Stop或绕过审批。审批期间编辑器/Stop隐藏是明确接受的宿主行为；若实测无法安全拒绝/取消则报阻塞，不能伪造按钮。宿主未读提醒也不hack抑制。
- 原生附件先按宿主处理；PNG/JPEG的工程导入另按资产任务落地。未知receipt取草稿通路不阻塞本轮原生对话接线，不默认将所有附件自动入片。

## 下一步与限制

下发 [P3-006-A](../tasks/P3-006A-native-creation-conversation.md)：实现右侧原生AI/会话历史/模型、持久映射、Tool工程范围与上下文、可审阅开发包；独立于进行中的P3-005-B画布spike。目标是实际可挂载候选，不是再一份接线提案。

实际插件激活、kit形状、嵌入渲染/焦点/审批/模型/新会话、HMR和真实模型请求尚未验证；开发先完成候选和自动检查再交安装验收。当前无安装授权，不在本轮启用live spike或创建真实Session。
