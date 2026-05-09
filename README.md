# OmO Configurator

桌面与浏览器双模式 GUI，用于可视化编辑 `opencode.json` 与 oh-my 的 agent 配置（`oh-my-openagent.json`，并兼容旧版 `oh-my-opencode.json`）。

**English:** [README.en.md](README.en.md)

## 创作动机

OpenCode 与 oh-my（agent 配置）往往是体积大、层级深的 JSON。纯文本手改容易出错：漏逗号、模型 ID 写错、MCP 段落不一致，都可能让工作流在不知不觉中坏掉。本工具希望把这类日常维护变得更稳、更快：用结构化表单替代盲改 JSON，一眼看清与官方推荐是否一致，换厂商时能批量调整模型，再配合快照在试错后快速回滚。它面向需要长期维护这些配置、又希望少踩坑的使用者。

## 技术栈

- **Runtime**: Tauri v2 (Rust + WebView)，也支持通过 Vite 运行浏览器模式
- **Frontend**: React 19 + TypeScript + shadcn/ui + Tailwind CSS v4
- **构建工具**: Vite
- **测试**: Vitest + Testing Library

## 开发

### 前置条件

- Node.js 20+
- **npm**（安装依赖与运行脚本请使用 npm；本项目不使用 tnpm）
- Rust 1.88+（仅 Tauri 桌面模式需要）
- macOS / Windows / Linux（Tauri 需要系统 WebView 运行时）

### 安装依赖

```bash
bash scripts/install.sh
```

也可以通过 npm 入口执行：

```bash
npm run setup
```

### 启动浏览器模式

在 WSL/Linux 或只需要查看 React 前端时，可直接运行浏览器模式：

```bash
bash scripts/start-web.sh
```

也可以使用：

```bash
npm run start
```

打开 Vite 输出的地址，通常是 `http://localhost:1420/`。浏览器模式会优先探测本地配置 API：如果检测到，就直接进入**服务器会话**并读写 WSL/Linux 上的真实配置文件；如果未检测到，则会明确进入**回退模式**，且以“未加载”状态启动，不会从 `localStorage` 伪造 `opencode.json`、oh-my 配置或 `auth.json`。支持 File System Access API 的浏览器可在回退模式下使用“打开配置目录”或“选择配置文件”；不支持时请使用“导入 JSON 文件”和“导出文件”。浏览器保存现代 oh-my 输出时写出 `oh-my-openagent.json`，读取时仍优先 `oh-my-openagent.json`，再回退到旧版 `oh-my-opencode.json`。回退模式不能自动读取 `~/.config/opencode`、`~/.local/share/opencode/auth.json` 或项目的 `.cursor/skills/`；只有显式导入/选择 `auth.json` 后才会尝试加载认证相关模型，且外部 provider 模型加载仍可能受 CORS 或网络策略限制。

### 启动 Tauri 桌面模式

```bash
bash scripts/start-desktop.sh
```

也可以使用：

```bash
npm run start:desktop
```

### 运行测试

```bash
npm run test
```

### 构建生产包

```bash
npm run tauri build
```

## 功能

### Agents & Categories 标签页
- 可视化编辑每个 agent/category 的模型和 variant
- 推荐模型指示器：绿色 ✅ 表示与官方推荐一致，橙色 ⚠️ 表示不同（悬浮可查看推荐链）
- 点击指示器一键应用官方推荐配置

### 批量替换
- 一键将所有使用某模型的 agent/category 替换为另一个模型
- 带确认对话框，防止误操作

### MCP 服务器管理
- 卡片列表展示所有 MCP 服务器（远程/本地）
- 点击展开内联编辑器：远程配置 URL + Headers，本地配置命令 + 环境变量
- 支持新增、删除服务器

### Provider 管理
- 左右分栏设计：左侧列表，右侧编辑表单
- 支持配置 name、NPM 包、Base URL、API Key（默认遮罩显示）
- 模型列表管理（添加/删除模型条目）

### Skills 管理
- 新增 Skills 标签页，面向 Cursor 项目级技能目录 `.cursor/skills/`
- Tauri 桌面模式会列出每个技能子目录，展示可编辑的顶层文本文件，并支持创建技能目录与 `SKILL.md`
- 为安全起见，编辑范围限制为技能目录顶层的 `.md`、`.txt`、`.json`、`.yaml`、`.yml` 和 `.toml` 文件
- 浏览器模式不会写入项目磁盘上的 `.cursor/skills/`，会明确提示限制，并把创建/编辑内容保存在独立的 `localStorage` 预览工作区

### 快照管理（侧边栏）
- 保存当前配置为带时间戳的快照
- 恢复快照（带确认对话框）
- 导出快照为 JSON 文件
- 浏览器模式中的快照是本地工作区检查点；恢复快照会加载为有未保存修改的导入会话，不会声称已写入磁盘

### 版本检查
- 顶栏显示当前 **oh-my-openagent** npm 插件版本（来自 `opencode.json` 的 `plugin` 字段）
- 一键检查 npm 最新版本，有更新时可一键升级配置中的版本号

## 配置文件位置

| 文件 | 路径 |
|------|------|
| opencode.json | `~/.config/opencode/opencode.json` |
| oh-my agent 配置 | `~/.config/opencode/oh-my-openagent.json` |
| 快照目录 | `~/.config/opencode/.snapshots/` |
| 项目技能目录 | `<项目根目录>/.cursor/skills/` |

**Oh-my 配置（agents / categories）：** 应用**优先读取** `oh-my-openagent.json`，若不存在再读同目录下的 **`oh-my-opencode.json`**。保存时**始终写入** `oh-my-openagent.json`。快照在存在时会同时包含上述两个文件名及 `opencode.json`。
