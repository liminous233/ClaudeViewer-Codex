# 二次修改说明

修改日期：2026-10-04。版本：`v6.0.1-local`。

## 来源与署名

- 原项目：[crownleo/ClaudeViewer](https://github.com/crownleo/ClaudeViewer)。原作者：crownleo。
- 基于上游提交：`336fe39`（v6.0 网页核心）。
- 二改发起与发布：[liminous233](https://github.com/liminous233)。
- 二改实现：OpenAI Codex 辅助完成源码修改、说明整理与测试。
- 二改仓库：[liminous233/ClaudeViewer-Codex](https://github.com/liminous233/ClaudeViewer-Codex)。

这是独立二改版本，不代表原作者、Anthropic 或 OpenAI 官方发布、审计或背书。原版权声明与署名保留，衍生代码继续遵循仓库中的 GPL-3.0 许可证。内联第三方库保留各自的许可证声明。

## 修改内容

1. 通过构建脚本内联 DOMPurify 3.4.16，统一清洗聊天、记忆与打印路径的 Markdown HTML；失败时显示纯文本。
2. 单篇及批量 Markdown 导出取消工具结果和附件提取正文的字符截断。
3. PDF 保留完整思考，增加工具记录与附件正文选项；转义动态文本、禁止打印页脚本，并修正打印加载时序和长文本排版。
4. 增加网页核心浏览器回归测试和开发说明，保持终端用户只需一个 HTML 文件。

## 验证与限制

Windows Microsoft Edge 上，7 项网页测试和 10 项现有适配器测试通过；使用合成数据，在断网、本地文件模式下检查导入、渲染与导出。

尚未验证真实个人数据、Safari、Firefox 或 macOS 原生客户端。阅读导出不能恢复源数据中不存在的内容，也不等于原始附件备份。详细记录见 [docs/LOCAL_IMPROVEMENTS.md](docs/LOCAL_IMPROVEMENTS.md)，测试方法见 [tests/README.md](tests/README.md)。
