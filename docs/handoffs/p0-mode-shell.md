# p0-mode-shell：当前接手

更新：2026-10-18。当前LIVE交付 `2cd718a`，已安装功能 `b382686` / 0.3.0-alpha.1、engine54f4671/0.1.1，沿用本树、分支与PR#3。开工fetch读协调STATUS/DEVELOPMENT，不merge或新建tree。

## 当前动作：先P3-006-C，独立提交后直接P3-008

先读 [LIVE复核](../reviews/P3-006A-live-review-01.md)，再执行 [P3-006-C](../tasks/P3-006C-embedded-file-preview.md)。用户已实测图片卡报“sidebarRight: no session surface is mounted”，不能将嵌入体验标为全PASS。总调度已核源码：sidebarRight全局controller只在普通Conversation主面板设置onScreen，main视频面板下undefined；原生chat openFile仍调该service。

一次交付实际可工作的局部图片/文件预览候选和回归，不再完整调查。根alpha.2、engine仍54f4671；C仍不跨升级engine；其后P3-008使用新通过复审的74294e6/两包0.3.0。不要猴补全局服务/抢mainView/替换宿主，不开放任意路径读取、不常驻第三列。具体scope/验收/故障边界见指南。

不安装/启停/重启新候选，不新增模型请求，不修改已安装staging、用户图片或工程。保留当前回滚与测试会话。旧验收的用户授权不等于所有后续安装或全局输入权限。不得再用全局键盘/坐标、个人剪贴板或抢前台；无定向通道时给用户短人工步骤。

当前换黄色失败源于已装旧engine和legacy demo，需后续新engine/受控工程/Host/Tool/画布整合，不引导直接写index.html绕过工程入口，不把调色副产物说成工程修改。p1覆盖语义R1/R2已验收，下一步修BUG-001黑带，不交叉写。

普通commit/push PR#3交回代码/包/新staging/测试和未测项；功能候选审过后再安排安装验收。不要对用户已开始创作的demo执行prepare-fixture重置。


## C提交后直接进入P3-008，不等待额外启动轮次

读取[P3-006-B复审02](../reviews/P3-006B-review-02.md)与[P3-008](../tasks/P3-008-canvas-ai-integration.md)。C的alpha.2固定包独立保留，然后直接继续alpha.3开发：新engine74294e6/0.3.0、Host/Tool方法、受控新工程与持久目录、左实时播放/直接编辑/移动缩放/就近样式、右原生AI、素材抽屉。不能只升版本仍用legacy demo来声称可以换色；验收必须真revision写入、画布刷新、保存重开保留。无底部场景卡片，不保留旧右侧表单主路径。

74294e6包摘要和白名单见指南，不从p1移动HEAD自动安装包。BUG-001尚未修好，不阻止开始画布开发，但不能声称MP4画面质量通过。p1新固定提交审过再显式升级。一次交完整开发候选/新staging/真实受控链与证据；不安装alpha.2/alpha.3或重启、不新增真实模型请求、不改用户数据。C若已进行则继续，避免重新开始。
