# V1 最后功能：插件更新与发行通道

2026-10-25，用户指定本会话实施。用户没有npm账号，首选GitHub Releases，npm渠道保留官方API适配。沿用未合并PR #33的完整V1候选，不能以尚不包含时间线能力的main重打发布包。通用规则见docs/DEVELOPMENT.md。本轮不擅自公开发布Release。

## 范围与规则

- 顶栏轻量“插件更新”入口，当前版本、更新说明、检查/安装/安装中/失败/需重启状态；点击外部和Esc关闭。启动延迟15秒检查、结果缓存10分钟、检查失败不打断创作。安装必须用户点击，不自动安装、不自行重启。
- 独立认证UI路由，不进入video_engine/AI方法表；客户端不能提交包名、来源或任意安装URL。只检查本插件可信安装来源。
- link/file本地开发不联网、不自动替换；来源不明或旧宿主能力不足明确提示。GitHub正式版从固定项目releases/latest取版本，拒绝预发布、草稿及非同仓库版本资产；按平台架构匹配包。
- 新宿主npm安装使用listVersions/updateBundle及其注册表、兼容性和恢复机制；实装宿主缺此API，GitHub使用已有removeBundle/installBundle，并在失败时重装原来源。保存启用选择，单任务防重复，卸载不取消管理器拥有的升级事务。不执行或批准依赖构建脚本。导出过程中拒绝更新。
- 发行tarball包含固定版本client/worker及完整运行依赖，去掉开发路径与link依赖；RELEASE.json记录源码提交、平台/架构及原包摘要。运行配置仅在发行标记存在时启用可迁移默认值，沿用用户稳定数据根。
- 首轮支持并实测当前macOS架构；系统Node22+/FFmpeg/Chrome仍需可用，发行包不冒充包含这些系统工具的跨平台安装器。

## 验收

版本/来源/兼容筛选、缓存、超时/离线、来源切换、重复点击、失败恢复及UI-only边界测试；真实浏览器深浅界面/关闭/更新按钮/重启提示；隔离安装实际tarball并启动引擎、保留工程数据升级；固定候选包回归与本机安装。公开发布和公网首次下载验证需要真实Release，单独报告，不把模拟feed或本地包当作公网已发布。

## 当前安装：1.0.0 插件更新候选（2026-10-25）

用户指定更新入口作为1.0.0最后功能；无npm账号，采用GitHub Releases首发，保留新DSH的npm版本API适配。顶栏“插件更新”提供当前版本、检查/新版说明/用户点击安装/失败重试/需重启提示。link本地开发安装不联网、不替换；正式版资产按平台架构匹配。独立认证UI路由，不对AI开放安装URL或更新方法。

固定运行时/root/engine `b45e28af184bfb1ac53e4232e1361ae8fc1d6827`，bundle1.0.0 / engine0.9.0；目录 `artifacts/p2-b/staging-v1.0.0-updates-verified`，INTEGRITY SHA256 `580ae822909bf4c3b72b8195380b4c242e19369e799efc0ce313aeb29006bbe8`。官方管理器安装启用并重启，实际worker路径核对；原生更新面板显示当前1.0.0及本地开发来源，Esc关闭通过。bb7829e旧包保留回滚。PR #33未合并，未公开发布。

12项更新/发行配置测试、8项真实浏览器UI检查、最终固定包工作区103项、源码门禁58/86/71通过。真实DSH CLI在临时DSH_HOME安装测试0.9.9→1.0.0 tarball，同一工程revision保留且新引擎真实抽帧成功；实际DSH额外临时插件从认证HTTP用户动作触发，自身卸载后继续安装新版成功（disposed=true），已通过官方管理器移除测试插件。启动apply的HMR事务内不能嵌套管理操作；生产安装仅走用户HTTP动作，后台只检查、不安装。

可迁移发行包 `artifacts/v1/release-updates-b45e28a/dsh-video-1.0.0-darwin-arm64.tgz`，SHA256 `99b82a48ce8737d29a71f20a7afc21d172f47b79d9bffa7b8cadc94fef3a6f26`，包含引擎及JS依赖，非本机link布局；仍需DSH>=0.2.1-rc.2、系统Node22+/FFmpeg/Chrome。目前只实测macOS arm64。GitHub发布工作流模板已准备，当前OAuth缺workflow scope，未启用/未在云端执行；首次公网下载/升级必须正式Release发布后验证，不能以本地包和模拟feed冒充公网已通。

证据 `artifacts/v1/evidence/plugin-updates-20261025`；[任务](V1-plugin-updates.md)、[更新通道说明](../releases/UPDATE-CHANNEL.md)。
