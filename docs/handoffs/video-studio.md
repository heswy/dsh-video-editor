# video-studio：唯一当前交接

日期：2026-10-18。用户决定结束p0/p1分线，统一DSH会话开发。首次从协调分支STATUS/DEVELOPMENT读取规则，任务[P3-011](../tasks/P3-011-real-creation-loop.md)。不换目录/分支、不merge协调分支，不联系其它Agent。路径与分支见DEVELOPMENT。

代码已包含p0 fdb6bc2、p1 c31fde5及协调e01fb15；插件alpha.3、两包0.3.2。允许同一任务改Client/Host/engine并更新必要版本/打包，不再等另一开发者。旧p0/p1对话及树停止写入，原PR保留。

第一优先级是用户实测：鹈鹕骑车生成后左侧空白；demo球变黄两分钟查源码未完成。当前新预览入口与revision轮询被scenes.length>0误作开关；AI改成非模板HTML后新画布消失。legacy球没有style能力，Prompt缺少明确的模式/能力/交付与禁止查开发仓库指引。详见任务中的已确认事实，不重置用户作品重现。

先在任务副本跑原失败场景并补回归，再修复两条闭环，保留现有人工编辑/冲突/生命周期回归。不得把能播放说成全对象可编辑，不把模板能力当任意代码沙箱。明确根因及当前缺口后一次交完整候选与证据，不仅交调查。

旧alpha.3仍是用户当前安装依赖，鹈鹕/demo都是用户作品，只读；不改旧staging、不prepare-fixture。当前只授权开发及副本测试、普通push/草稿PR；不安装/启停/重启、不发新真实模型请求、不改profile/用户工程、不merge main。无安全定向通道时请用户短人工步骤，禁止全局键盘/坐标/剪贴板。

统一分支已推送origin/codex/video-studio。草稿PR创建请求在GitHub API超时，结果未确认；后续先按head=codex/video-studio查询并复用，避免重复创建。此状态不影响打开统一工作区开发，原PR#1/#2/#3未关闭。
