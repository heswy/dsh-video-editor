# P1-001 HyperFrames spike

独立引擎验证；没有 DSH 插件代码或安装步骤。只运行仓库自有的受控单场景。

## 本机要求与安装

验证环境：macOS arm64、Node 24.14.0（上游要求 >=22）、FFmpeg/ffprobe 8.0.1、Chrome 155.0.8059.79。固定 npm 包与全部传递依赖见 package-lock.json；`hyperframes` / `@hyperframes/sdk` 0.8.167、GSAP 3.15.0，浏览器验证工具 puppeteer-core 25.14.0。

从仓库根目录执行，无须切换 worktree：

```sh
npm ci --prefix spikes/hyperframes --ignore-scripts --no-audit --no-fund --cache "$PWD/spikes/hyperframes/.cache/npm"
npm run doctor --prefix spikes/hyperframes
npm test --prefix spikes/hyperframes
npm run prepare-scene --prefix spikes/hyperframes
npm run frame --prefix spikes/hyperframes -- before
npm run edit --prefix spikes/hyperframes
npm run reopen --prefix spikes/hyperframes
npm run frame --prefix spikes/hyperframes -- ordered
npm run frame --prefix spikes/hyperframes -- shuffled
npm run render --prefix spikes/hyperframes
node --test spikes/hyperframes/test/render-lifecycle.integration.mjs
```

`prepare-scene` 重置本 spike 的 artifacts/project/index.html。`edit` 仅接受尚未修改的原始标题；重复编辑会拒绝。两条 SDK 命令在不同进程执行，写回使用官方 fs adapter + flush，并读取文件核对 serialize()。元素 duration 快照在该 SDK 版本中读取 data-end，因此命令明确报告原生 data-duration 与 sdkSnapshotDuration，不掩盖差异。

所有安装脚本均禁用；锁文件中仅 esbuild 0.25.12 声明安装脚本，其平台二进制已随可选包安装，实测无需 postinstall。不要用 npm rebuild 作为额外安装步骤。

字体默认只读 `/System/Library/Fonts/STHeiti Medium.ttc`，复制进被忽略的工程资产目录；不把 Apple 字体再分发进 Git。Chrome 使用现有系统二进制。不同机器通过 `SPIKE_BROWSER_PATH` / `SPIKE_FONT_PATH` 显式指定本机文件，并重新验证 doctor 与全部结果；未验证跨平台像素一致。

## 真实 Studio 预览

上面的 CLI 命令结束后再启动预览，避免上游工程历史锁争用：

```sh
npm run preview --prefix spikes/hyperframes
```

打开 http://localhost:4567/#project/project 。这是上游 HyperFrames Studio，不是 DSH UI。播放、暂停与拖动时间轴可查看 5 秒场景；标题只在 1–4 秒可见。用 Ctrl+C 停止，仅操作本次启动的进程；附带 10 分钟超时。不要同时运行两个 preview 命令。

服务运行时，在另一终端执行：

```sh
node spikes/hyperframes/scripts/preview-check.mjs
```

此检查使用真实 Chromium 页面与 Studio 内的官方 Player：等待 runtime ready、精确 seek、读取字体/文字边界/可见状态、播放后验证形状位置变化，并保存真实 Studio 截图。浏览器请求限制在本地服务（data/blob 例外）。核心 GSAP 与 MotionPathPlugin 均从锁定 npm 包复制到工程，样例无 CDN 字体或资产。Studio 自身可能发起的非本地请求被检查阻断并记入报告。

停止预览后运行：

```sh
npm run verify --prefix spikes/hyperframes
```

验证 H.264 / 1280×720 / 30fps / 150 实际解码帧 / 5 秒（时长容差 1/30 秒），比较两次新浏览器进程内顺序和乱序 seek 的 8 张 PNG 字节完全一致，并校验预览与取消/超时报告。提取实际 MP4 的 2.5 秒帧供目视检查。`artifacts/verification.json` 记录 SHA-256；测试、截图、视频、缓存均不进 Git。

## 取消与超时

`process.mjs` 为每次官方 CLI 分配私有临时目录，跟踪子代（包括脱离进程组的 Chromium）和以私有临时路径标识的 helper，发送 TERM，宽限后 KILL，检查无存活者后删除临时目录。发信号前重新比较 PID、启动时间及命令，避免只按进程名终止；不调用全局 kill-all。合成测试含忽略 TERM 的 detached 子进程和必须保留的无关 sentinel。

真实集成测试在实际 streaming capture 开始后取消，另用 SDK 创建临时 60 秒副本迫使 20 秒 deadline 超时；5 秒交付工程保持原状。它验证两种结束状态、拥有进程清零和临时目录消失。此进程生命周期实现仅在本机 POSIX 受控样例验证，不能当作不可信代码沙箱。

## 文件与证据

- `fixtures/index.html`：5 秒、1280×720、30fps、7 个显式稳定 ID；中文、本地字体、基础形状和由绝对时间驱动的 GSAP 动画；无随机效果。
- `scripts/`：doctor、SDK 创建/编辑/重开、官方 CLI 抽帧/渲染、进程所有权、真实预览与验证。
- `test/`：跨进程 SDK 闭环、detached 子代取消/超时、真实渲染生命周期。
- `evidence/`：本轮可提交的版本、元数据、摘要；实际产物在 `artifacts/`。
- 接入契约与限制见 `../../docs/research/P1-001-engine-spike.md`。

上游来源：[SDK](https://hyperframes.heygen.com/sdk/quickstart)、[SDK 包](https://hyperframes.heygen.com/packages/sdk)、[引擎](https://hyperframes.heygen.com/packages/engine)、[仓库](https://github.com/heygen-com/hyperframes)。HyperFrames 仓库与 CLI 标注 Apache-2.0（SDK 包元数据未单列 license）；GSAP 许可按其包中的 LICENSE / https://gsap.com/standard-license/；系统字体不随本 spike 分发。
