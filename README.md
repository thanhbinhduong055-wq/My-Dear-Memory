# 私语手札 · Private Journal

一个运行于 SillyTavern 的纯前端 UI 扩展。它借助当前已配置的模型，把当前聊天、角色卡、User Persona 与本次生成实际激活的世界书内容，整理成一本按聊天独立保存的私人日志。

## 当前功能

- 四种篇章：初印象、相处日记、情书、恋爱日记
- 每页包含正文、诗歌、歌曲与记忆锚点
- 使用当前 SillyTavern 模型后台生成，不打断角色回复
- 按“角色 / 群组 + 当前聊天”隔离保存
- LocalForage 本地持久化，支持 JSON 备份导出
- 桌面和移动端响应式手札界面
- 对诗歌出处、歌词长度与虚构经历做提示约束

## 安装

1. 将本目录发布为一个 Git 仓库。
2. 在 SillyTavern 打开“扩展 → 安装扩展”。
3. 粘贴 Git 仓库 URL 并安装。
4. 打开任意角色聊天，点击右下角酒红色 `❦` 按钮。

本地开发时，也可把整个目录放入 SillyTavern 的 `data/<user-handle>/extensions/`，或安装为所有用户后放到 `public/scripts/extensions/third-party/` 对应目录。

## 数据与隐私

- 日志只保存在浏览器侧的 SillyTavern LocalForage 中；卸载扩展前请先导出。
- 生成时，相关聊天与设定会发送给你当前在 SillyTavern 里选择的模型服务。扩展本身不配置、不收集 API Key。
- 其他前端扩展理论上也能访问浏览器侧数据；高度敏感内容不应仅依赖前端扩展实现强隔离。

## 版权策略

模型被要求优先选用公共领域诗歌；不确定时写明确标注的原创短诗。现代歌曲歌词仅允许极短摘录，不能确认原句时改为意译或氛围描述。模型仍可能犯错，公开发布前请人工核对作者、作品与歌词。

## 已知限制 / 下一阶段

- 当前为 MVP，暂未加入页面手工编辑、封面主题、全文搜索、自动按消息增量生成和 Markdown/PDF 导出。
- `generateQuietPrompt` 会使用 SillyTavern 当前生成链路中的上下文与世界书规则；具体进入模型的条目仍受扫描深度、触发词、预算和用户配置影响。
- 群聊目前以整个群组为一本手札，后续可增加“指定执笔角色”。

## 兼容性

面向提供 `SillyTavern.getContext()`、`generateQuietPrompt()` 与 `SillyTavern.libs.localforage` 的当前 SillyTavern 版本。建议使用最新稳定版。

