# P3-006-A LIVE 复核：基础闭环有证据，文件打开失败

日期：2026-10-18。对象：p0-mode-shell交付2cd718a，已安装b382686/0.3.0-alpha.1，旧引擎54f4671/0.1.1。结论：**安装、会话/历史/原生模型seat、受控标题写入有真机证据；文件/图片打开已被用户实测判定FAIL，不能把整个原生嵌入或v0.3标为通过。**

## 证据口径

- fetch后核对交付文档；本地live-state.json为19,300 B/SHA-256 e0feb47be21f9f322f8a0dc656af1a2dd3a7abbd2bf01162c774b8900fecad27，session-evidence.json为17,678 B/2fa78806016e13495e79d6af05081fcf2ee9a98323c2c8d7213f9c6b2cb81e12，均与交付一致。没有复制原始个人会话日志。
- 用户提供真实界面：左PNG、右原生AI已出现；文件交付卡点击显示“sidebarRight: no session surface is mounted”。该失败是用户直接实测，不能被先前mock/入口可见或交付卡出现覆盖。
- 会话创建/历史/两次请求/edit revision/PNG、标题恢复、用户手动重启等为开发者真机记录；本轮总调度没有重新操作GUI或调用模型。重启获得现场追加授权的说法按交付记录保留，不扩展成以后自动重启授权。
- 开发记录的“模型请求2次”指用户对话turn数，不等于2次底层LLM调用（记录还列17 steps），以后分别报告turn/step、工具调用与已知用量，避免误报计数。

## 文件打开根因（独立随包源码核对）

本机0.2.1-rc.2的dsh-client-ui-chat/lib/client.js约13243–13247：原生chat openFile经fileAddressFor绑定会话路径，再调ctx.sidebarRight.openResource；reference文件节点也调同一服务。

dsh-client-ui-sidebar-right/lib/client.js约4835–4838：只有layout.panelInfo.activePanelId===null时，show(selected.sessionId)，否则show(undefined)。其require()约2480–2482在mounted session或adopted actions不存在时抛出用户截图中的同一错误。RightbarRoot也只在普通Conversation主面板显示（约1607–1610）。**不是PNG损坏，也不应靠反复点重试解决。** 自己补render rightbar.session而未解决全局controller的主会话前提同样不足；不能抢占普通会话或冒用mainView来修补。

下一任务[P3-006-C](../tasks/P3-006C-embedded-file-preview.md)完成插件内会话归属正确的文件打开，不需要再做完整原生嵌入调查。

## “改成黄色”的产品缺口

当前已安装引擎固定54f4671，确实只有legacy fixture的text/timing编辑。P3-006-B的0.3.0尚未通过R1/R2复审，也未接Host；即使接通，当前legacy hf-scene也不会自动变成受控product-launch-v1多Scene工程。换色需同时接新engine方法/Host参数/Tool能力与受控工程创建或迁移，不能只改版本号。

当前生成两张调色PNG不改变revision，不能称工程换色；不能把“要不要允许直接写index.html绕过唯一入口”作为正式编辑流程。后续画布整合必须有“把背景改成黄色→受控scene级写入→新revision→刷新真实预览→保存重开仍黄色”的验收。原位文字/位置/样式仍按v0.3目标；不保留旧目标下拉表单作为最终主路径。

## 操作事故与恢复

开发记录确认全局输入误投递到企业微信并发送测试消息；还记录了个人剪贴板纯文本备份/恢复。这两种操作违反既有DEVELOPMENT中的定向输入/不使用个人剪贴板边界。记录声称现场另有授权，但本主会话不能仅凭开发者自述确认其具体内容；不继承为后续权限。用户已处理误发，不再操作该外部应用撤回/覆盖。

下一轮仅使用绑定目标的DOM/AX元素动作；无安全通道则给短人工步骤，禁止再次用全局键盘/坐标/剪贴板探路。文字restore不等于剪贴板富文本保真。全权授权本轮业务验收不等于允许误向第三方发消息。

演示标题已按测试计划恢复，用户后续看到原始revision有明确原因；以后不得在用户开始创作后继续prepare-fixture重置。当前staging已成为安装依赖，不能覆盖或清理；记录中的归一化是测试数据恢复，不证明真实用户工程重置安全。
