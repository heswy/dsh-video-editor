# 插件安装与后续更新

V1 首轮发行渠道为公开仓库 `https://github.com/heswy/dsh-video-editor/releases`，不需要npm账号。不把本地link候选当作对外发行包。

## 用户体验

首次在DSH插件页安装对应设备的Release资产URL；目前验证macOS Apple Silicon，文件名为 `dsh-video-<version>-darwin-arm64.tgz`。之后在编辑器顶栏“插件更新”中检查/安装。GitHub Release必须为非草稿正式版，tag `v<version>`，并带对应平台架构的资产；缺包明确提示，不报告已是最新。不自动安装、不擅自重启。工程和素材保存在稳定数据根，更新只替换插件。

本机当前是link安装，显示“本地开发安装，由开发者更新”；不会将测试候选静默替换为公网包。转为正式发行安装时，使用官方插件管理器安装Release URL。未知来源/旧DSH不支持时提供明确状态，不猜测来源。已发布npm安装在支持版本API的DSH上走官方listVersions/updateBundle。

运行先决条件：DSH至少0.2.1-rc.2，系统可用Node22+、FFmpeg和Chrome；DSH自身Node/Electron进程不当作普通Node执行。首轮发行包带引擎及JavaScript依赖，不带这些系统程序，不宣称Linux、Windows或Intel实机验收。

## 开发者发布流程

1. 合并已验证的代码到main；根package.json升级semver。首次正式版1.0.0，后续修复1.0.1、功能1.1.0；不覆盖同版资产。
2. 用干净固定提交运行stage-dev，之后运行：

   `node scripts/pack-release.mjs /absolute/immutable-stage /absolute/new-output`

   输出对应平台tgz、SHA256SUMS；包内RELEASE.json记载源码提交、平台与固定包摘要。没有npm token，也不在包里放凭据、用户工程或本机配置。
3. 完成固定包工作区、更新单元/UI以及 `test-release-install.mjs <tgz>` 隔离实装验收。该测试用临时DSH_HOME，验证旧测试版安装→新版→同一工程revision保留→真实抽帧，不操作用户profile。
4. 在main对应提交创建 `v<version>` Release，可手动上传已验证的tgz及SHA256SUMS。启用Actions时先把工作流模板放入.github/workflows，并由具有workflow权限的账号提交。`docs/releases/release-workflow.yml.example`（待启用模板） 校验tag与版本、main归属，在macOS arm64构建验证并上传tgz/摘要。手动运行workflow只产生Actions产物，不发布。首次公开Release及网络下载链路需要发布后单独实测，未发布前不能声称公网升级验收通过。
5. 确认公网资产可下载，然后从上一正式版本通过更新按钮安装并核对版本、工程、渲染及回滚。若流水线失败/缺包，用户会看到该设备尚无安装包，不会装不完整Release。

## 管理器与恢复

新DSH的npm升级交给官方updateBundle。GitHub渠道兼容现有removeBundle/installBundle，保留来源和启用状态，失败重装原来源，失败信息保留；恢复失败时用户需在DSH插件页重装上一Release。安装/恢复由宿主管理器持有，插件卸载不取消该事务。导出中拒绝更新。客户端不能提交任意包名、URL或构建脚本授权，AI业务工具没有更新方法。

当前功能和隔离安装证据见 `docs/tasks/V1-plugin-updates.md`；首次公开发布状态以STATUS为准。
