# 对话嵌入与模型选择：v0.3 初步核对

日期：2026-10-17。只读本机 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`；通过 ASAR header 定位并读取包内 README/已编译客户端，不执行包代码，不读取用户 profile、会话正文或凭据。不属于 live inspection。

## 已核对的随包文档事实

- `dsh/package.json` 版本为 **0.2.1-rc.2**；之前验收 rc.1 为历史。当前运行 Host 版本本轮未验证。
- `@deepseek-ai/dsh-client-ui-conversation/README.md` 的 Browser shell 描述：`conversation.content` Component Factory 拥有共享 body 与 Composer，嵌入 occurrence 可替换 views、去掉主区 width handles，且不渲染主 Header。
- 同文档明确 Factory 使用渲染位置的 Session；不能靠给 Factory 塞任意 sessionId 来独立绑定。一个 Session 不能同时有多个可编辑根。
- `@deepseek-ai/dsh-client-ui-session/README.md` 描述 `SessionProvider` 可继承外层绑定或绑定显式 `SessionReference`。因此插件全局 main 无 Session binding 的旧事实，不能单独作为不能嵌入对话的结论。
- `@deepseek-ai/dsh-client-ui-model-selection/README.md` 描述 `/model` 与 Composer 模型按钮共用 per-session 目录，`session.models` 获取目录、`session.selectModel` 提交选择；支持配置的 provider 分组与推理强度。完整选择对下次请求生效，当前运行 step 保留启动时模型。
- `@deepseek-ai/dsh-client-modules/README.md` 描述非 baseline 的浏览器模块需要 manifest 中声明精确 external；不能假定任意包可直接 require。

## 产品路线（提案）

右侧用工程关联的专用 DSH Session 作为真实对话，优先 SessionProvider + Conversation Factory 组合；沿用 Chat、Composer、附件、模型控件和权限反馈。工程仅持久关联 Session 标识和项目上下文，不复制消息日志/凭据。一次只挂载同一 Session 的一个编辑根。新对话继续同工程；选旧对话不回滚工程。

优先保留标准 body/composer，通过支持的 local positions 调整呈现，不 shadow 宿主主对话/导航，不读私有 store，不改主 Session 选择来伪造嵌入。

## 必须后续实测，尚未实现

1. 精确导出、Factory 渲染调用与 SessionReference 创建/保留/释放；插件模块 external 解析与 Slot scope。
2. 工程专用 Session 创建、列举、重开、关联持久化与权限；宿主侧栏导航和视频工程会话选择相互独立。
3. 模型选择在嵌入 Composer 中真实呈现、生效与重开保持；是否可保持精简工具栏而不破坏权限/审批。
4. 会话切换、刷新、插件停用/HMR 时草稿、流式消息、审批、附件、worker 状态的正确性。
5. 上传附件与工程资产转换：模型引用不等于资产导入，必须设计稳定 assetId 和允许的访问流程。

结论：有明确的原生复用线索，尚不能宣布右侧会话/历史/模型已接通。若目标运行版本不支持该组合，先报告限制与最小方案，不为赶布局重写整个聊天平台。
