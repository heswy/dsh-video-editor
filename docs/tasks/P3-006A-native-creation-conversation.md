# P3-006-A：右侧原生 AI、创作历史与会话范围接线

日期：2026-10-18。执行：**p0-mode-shell**；基线 `7daa039`，沿用当前树、`dsh/p0-mode-shell`和PR#3，开工先记实际HEAD/工作状态。依据 [P3-005-A复审](../reviews/P3-005A-review-01.md)。通用规则仅引用DEVELOPMENT，产品和设计读最新v0.3。

## 目标与交付粒度

本轮进入实现，一次交付右侧真实原生Conversation、工程创作会话创建/历史/模型、Host映射持久化、Tool工程范围与动态上下文，以及可安装开发候选。不再另做长调查。不依赖尚未交回的P3-005-B画布spike；左侧暂保留诚实的实际PNG预览/导出，不新增假播放、假点选或未持久化拖动。

首版目标根包 **0.3.0-alpha.1**（开发候选，未发布）。本任务仍用已审 `54f4671` / engine-client+worker0.1.1，不在这里跨入多Scene引擎/画布资产路由；新引擎df4b74f0.2.1的接线随画布契约另发。`--bundle-version 0.3.0-alpha.1`应可直接生成staging，引擎固定不放松。

## 范围

允许：`client.js`、`index.js`、`host/**`、`package.json`/locale、scripts中相关check/smoke/Host/版本与stage/真实链检查（含必要lib与新增会话回归）、README、本任务和`docs/research/P3-006A-*.md`。不加运行时依赖，原生React来自模块表；manifest只按实际需要改，不为Slot调用随意加external。

不改两engine包、spikes、全局记忆/决策、其他树/PR；不自动安装/启停/重启、不改profile、不创建或编辑用户真实会话、不发模型请求、不merge。真实写入Session等仅在安装验收获明确授权后执行；本轮用受控adapter自动测试并交具体候选。不得改安装用旧staging，所有包和新staging放新提交目录。

## 1. 右侧真实会话与布局

- panel内左画面/右AI两区，AI常驻；旧右侧目标下拉/属性表单不能占据AI空间。当前不做场景卡片，不引入完整NLE。未接入画布的编辑能力可移到左侧按需操作，不宣传已原位编辑。
- 私有session-scope child取得kit，owned SessionReference +原生Conversation Factory（embedded、hero:false、Chat view、无宽把手/宿主Header），保留原生Composer/模型/权限/审批/附件/Stop。phase随loading/error/active正确表达，不能无条件active掩盖open错误。
- 使用`source:'videoView'`；reference.ready后检查openState/openError。快速工程/历史切换用generation防迟到，先卸载旧occurrence再release，禁止释放后Provider仍读引用。新/旧reference不得共享同一editable root。
- 单编辑根判断结合main panel可见性与挂载生命周期。mainView保留计数不能单独锁死视频页；针对其它实际可见occurrence保守处理并明确提示。反向切回普通会话也必须解除视频编辑根。
- 右上历史/新会话，输入区原生模型选择。无绑定时提供真实“开始创作”或新会话动作，不在render/effect重跑时悄悄重复创建会话。模型不足/无权限/打开失败沿用可见错误，不模拟回复。

## 2. 工程↔Session持久关系

- 一工程多创作会话、一Session仅属于一工程；Host为映射唯一权威，持久化`projectId/sessionIds/activeSessionId`，消息/模型/标题优先读宿主，不复制聊天日志或凭据。
- 插件新增明确可信配置（例如绝对`sessionStatePath`）存放版本化会话元数据，原子写+队列并发控制。可以使用核实的storageDomain；不得直接写worker project.json/registry或改变工程revision，不能用cwd/title当唯一身份证明。缺存储配置只禁用会话功能并准确提示，旧工程预览仍可用。
- Session创建由Host侧受支持controller接口统一协调（参数按已核实契约适配），使用可信配置/registry认可的工程cwd，不接受客户端任意路径。只接纳实际返回的新id；同一次请求/双击去重，写映射失败不能报告绑定成功。重启恢复历史；坏文件/未知版本不静默清空正常记录。
- 历史只列此Host登记的工程会话；不能通过UI任意sessionId绑定另一工程或普通个人会话。选择旧会话不回滚工程、不导航宿主、不清其他会话草稿。已有会话被宿主归档/删除时呈现不可用状态，不自动解除归档。
- 不创建独立Workspace、不archive隐藏，不承诺宿主侧栏不可见；标题可用`工程名 · 创作 N`，宿主可搜索到属于正常行为。

## 3. Tool与上下文（本轮只接现有引擎方法）

- 扩展Host现有受控dispatcher/route完成会话操作；UI只传工程/已登记会话标识，不能指定路径、任意Agent身份或可执行代码。Session管理操作不是模型自绑自己权限的Tool。
- `video_engine`对工程读写从可信exec.agent获得Session身份，按持久映射检验projectId；job类请求反查job所属工程。缺agent/未绑定/跨工程明确拒绝，不能信args.sessionId。不影响纯诊断doctor；原受控UI Fetch路径按自身连接/工程边界走，不伪装Agent。
- 集中adapter核实Agent.id与Agent.session.id的真实契约；不一致/无值失败。测试不是只给伪对象一个想当然字段；记录随包API依据。可全局Tool加验证，不要求立刻重构整个per-agent工具注册系统。
- 给已绑定Agent提供新鲜工程id/revision/支持的目标能力摘要；Host使用已有session/agent/systemPrompt受支持入口，生命周期可清理。上下文不是授权，真正范围检查在每个操作执行点。不能把工具一注册就当AI知道当前工程。
- 原生权限/审批策略保留，不自动允许，也不额外对每个普通UI动作弹一套审批。Tool写入按宿主策略进入审批；出现审批时原生拒绝/取消可用。首版不另造独立Stop，不能为追求菜单简洁隐藏权限提示。

## 4. 验证与候选

实现时先用受控Slot/controller适配器验证最小kit/Provider/Factory接线，再完成其余功能；这些都是本轮内部检查，不新增一次“调查交接”。如果实际导出与调查不符，先报告最小差异，能在本白名单解决则继续。

有意义的回归至少覆盖：正确child/hero:false/Chat渲染；ready但open错误；快速切换迟到丢弃与卸载清理；mainView retain非零而宿主会话面板已隐藏时可嵌入；反向导航不抢编辑根；双击创建只一条记录；实际返回id写回；历史重开/跨工程拒绝/持久失败；模型seat未被自造控件替换；Tool无身份/错工程/job错归属拒绝，正常绑定可操作；动态上下文与运行后清理。

旧Host/渲染/取消/时序行为不回归；UI测试随真实布局适配，不以删除旧语义测试来凑通过。根包版本与stage门禁检查同步alpha.1，新增配置在staging内声明，旧0.2.x安装保持。新候选必须包含只读原生会话接入预检/诊断（仅报必要kit存在/版本等，不记录个人消息或密钥），供之后真实激活最小验证。

交付：普通commit/push更新PR#3；新固定包/新staging与INTEGRITY、源码摘要、自动检查、运行时未变引擎真实链（如Host受影响则复跑）、README安装/回滚步骤与最小人工清单。明示本轮没有真实Session/模型/安装证据。总调度先审具体可安装结果，安装授权作为最后步骤；之后一轮验证嵌入/历史/模型/审批，而不是再交空提案。

## 素材与画布接口预留

保留“素材”入口设计与稳定工程assetId概念，原生会话附件可以原样使用；本任务不读未知草稿receipt，不自动将附件入片，不开放未实现SVG/音视频导入，不做假素材按钮。完整工程素材导入与实时画布按后续任务接；当前选择上下文使用已有工程/目标标识，未来接B的选择事件而非复制第二套选择状态。

## 开发记录（p0-mode-shell）

待填：实际HEAD/协调SHA、接口与身份依据、配置/生命周期选择、测试、包/staging/摘要、未测项、提交。
