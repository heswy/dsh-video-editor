# P3-005-B 复审：受控画布播放、选择与直接编辑

日期：2026-10-18。对象：`ea2d1a4`（包含4ad7b2e及后续修正），p1-engine / PR#2。结论：**spike验收通过（受控模板、独立浏览器，无阻塞项）**。不是DSH生产界面，不把暂态拖动算作可保存编辑；下一步直接补引擎持久化，不重复调查。

## 独立复跑

- `npm test --prefix spikes/editor-canvas`：**10/10**，exit0。
- `node spikes/editor-canvas/scripts/run-canvas.mjs --chrome '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --out '<同级artifacts>/reviews/2026-10-18/P3-005B-canvas'`：真实Chrome **41/41**，24.51s，exit0。未重写提交中的evidence。
- `node spikes/editor-canvas/scripts/capability-probe.mjs --out '<同级artifacts>/reviews/2026-10-18/P3-005B-capability'`：exit0、failures=[]，独立复现缺口：layout/style/move/resize/color均E_PARAMS；SDK副本可写但场景重生成会丢样式。
- `git diff --exit-code df4b74f -- packages`通过；开发树干净。仅spike与任务/研究记录变化。
- 独立看真实截图：所选标题在Host覆盖层描边，页面清楚标独立试验与暂态拖动，不当最终设计验收。场景卡片未引入。

## 关键行为与数字

- 9点seek（含4.99/5.0/9.0/10.99）落点、真实播放/暂停、加载完成后断网、字节路由/资源来源检查通过；现场runner无failures。
- 3采样点与worker抽帧双口径：

| 时间 | Δ≤2像素比例 | 精确逐像素相等 | MAE |
|---|---|---|---|
| 1.5s | 99.3018% | 99.2763% | 0.3581 |
| 5.5s | 99.1047% | 97.9291% | 0.2968 |
| 9.0s | 99.9262% | 99.9237% | 0.0415 |

不是逐帧parity，更不能把99%写成完全相同。

- 实际stableId命中、两尺寸letterbox/留白、隐藏对象/场景交界/重叠层级规则、结构容器排除通过。
- Esc不写，Enter经现有worker edit/revision/operationId写回，新快照和重启后持久；旧revision冲突不覆盖；E_PERSIST保留草稿与恢复重试通过。
- sandbox allow-scripts且无allow-same-origin，opaque origin null不作为认证；WindowProxy/instanceId/nonce/严格消息/序号检查和实例撤销通过。
- 销毁后剩余实例0、frame0、300ms命令/事件增量0，旧路由404、worker退出后快照树为空。

证据绝对目录：`/Users/orange/Orange Field/Matterhorn/dsh-video-editor-worktrees/artifacts/reviews/2026-10-18/P3-005B-canvas/`和`P3-005B-capability/`，均为本轮独立输出，不是开发者原JSON复述。

## 冻结的基础与生产化限制

1. composition CSS px为坐标；自然画布尺寸与Host缩放/letterbox分离；当前时刻的动画矩形不是可直接写回的静态left/top。生产拖动必须明确逆映射到基座，不能把GSAP位移烘焙进去。
2. 所选stableId由worker inspect目录确认，未支持编辑的对象不开放假手柄；写入仍由共享worker+revision/operationId完成。文本路线可复用，位置/样式未支持必须补后才开放。
3. 消息v1及WindowProxy/实例/nonce/序号骨架可作为生产实现起点；项目/revision绑定仍由Host会话状态校验，消息不是凭据。nonce不是完整沙箱。
4. **不要原样复制toy Host。** 它的来源白名单/精确文件核验是验证基础，真实Host还要会话/工程授权、realpath包含、snapshotId/manifest形态、过期时撤销。当前toy路由主要依赖worker删除和主动revoke，没有在每次服务前用expiresAt独立拒绝；生产必须检查TTL，即使清理失败留文件也不服务。
5. runtime对data-start时间窗做近似，三个时间点比对不足以承诺全片一致；宿主集成必须补Scene边界/字体/资源失败与主要动画时刻，范围仍为受控模板。
6. CSP的host script source与inline hash只证明这次受控文档可跑；真实DSH同源有其它端点，不应把整个宿主origin当成无限脚本白名单。生产精确资源/runtime策略另按路由实现核查；不宣称任意HTML/JS安全。

## 下一步

p1-engine进入 [P3-006-B](../tasks/P3-006B-layout-style-persistence.md)：统一edit加入受控layout/style、inspect能力、场景重生成保留、三方合并、undo/reopen/render。p0-mode-shell当前P3-006-A原生AI接线不受影响，不修改对方进行中的工作。

本轮没有安装、启停/重启、profile变更、模型调用或merge；DSH实际画布与右AI集成仍未交付。
