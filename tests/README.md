# 网页核心测试

运行查看器仍只需要根目录的 `claude_viewer.html`。Node.js 和 Playwright 仅用于开发测试，不是用户运行依赖。

## 安装与执行

使用 Node.js 20 或更高版本：

```sh
npm install
npx playwright install chromium
npm test
```

已有 Microsoft Edge 时，可跳过 Chromium 下载，在 PowerShell 中运行：

```powershell
$env:TEST_BROWSER_CHANNEL='msedge'
npm test
```

测试默认启动无头 Chromium。每项使用独立浏览器上下文，禁用网络，只导入合成数据，不读取个人聊天文件。测试输出放在 Git 忽略的 `_local/tests/`。

## 覆盖范围

- 原始 HTML 通过 `file://` 打开，旧版 ZIP 实际导入，单篇 Markdown 和批量 ZIP 实际下载并核对内容。
- 聊天、个人记忆和记忆文件中的危险 HTML 清洗；表格、代码、折叠内容与公式保留。
- PDF 选项与打印窗口，完整工具、附件和思考文本；禁止脚本的 CSP 在浏览器中执行验证。
- 499/500/501、799/800/801、3999/4000/4001 以及 20000 字符的导出边界。
- 清洗库缺失或抛错时降级为纯文本。
- manifest 和六个合成 ZIP 的文件夹导入，包括两片对话及项目、记忆、回顾、账户；缺片检测。
- 390px 窄屏、深色模式、对话框 Escape 与焦点恢复。

部分函数级测试使用 `_local/tests/instrumented.html`，只在该测试副本暴露内部函数；主文件不增加测试接口。实际下载、渲染和打印按钮测试使用未经注入的主文件。

生成的 `print-preview.pdf` 用于检查浏览器打印输出；测试验证自动调用打印，但不操作系统原生“另存为”窗口。

macOS 适配器结构检查可独立运行：

```sh
node --test macos/tests/adapter.test.cjs
```

本地版改变了主 HTML，macOS 伴侣的上游校验锁会过期；没有 Mac 实测时不更新该锁。
