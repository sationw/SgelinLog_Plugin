# MinerU PDF 解析插件（mineru-markdown）

> 为 SgelinLog 的 **AI 阅读 / 精读（RaA）** 提供 PDF → Markdown 的**解析工具与缓存**。v2.0.0
> 插件把解析好的 md 按文献缓存到插件数据目录，AI 阅读前可先命中本地缓存，避免重复解析。

## 它做什么

当用户希望用 **MinerU**（而非内置 PDFPig）解析 PDF 精读文献（尤其带公式）时，本插件负责把 MinerU 的解析结果整理成**按文献组织的 md 缓存**，并提供**缓存生命周期管理**：

| 能力 | 说明 |
|---|---|
| ① Agent 轻量解析 | 免 token；绑定任务后插件**自动轮询 → 自动下载 md → 写入缓存** |
| ② 精准解析（公式/表格） | API Token；`pipeline / vlm / MinerU-HTML`；生成可复制的提交命令，结果 `full.md` 可导入缓存 |
| ③ 手动导入 md | 把任意来源的 md（如精准 zip 里的 `full.md`）直接缓存到当前文献 |
| 缓存复用 | 同一文献再次打开即显示「md缓存」徽章，AI 阅读前可先读缓存 |
| 缓存清理 | 自动清理间隔（天，0=关闭）＋一键清理＋单条删除 |

## 两种解析模式怎么选

| | ① Agent 轻量 | ② 精准 API |
|---|---|---|
| Token | 免 | 需要（API 管理页创建） |
| 公式 / 表格 | 固定轻量模型 | `enable_formula` / `enable_table`（可开） |
| 文件限制 | ≤10MB / ≤20 页 | ≤200MB / ≤200 页 |
| 输出 | 单个 `markdown_url` | zip（含 `full.md`） |
| 适用 | 快速阅读 | 精读、扫描件、带公式图表 |

> 带公式的文献精读：用**精准模式**（`model_version: vlm`、`enable_formula: true`）。

## 为什么有些步骤要在插件外完成？

插件面板运行在宿主 WebView2 中，插件网络和文件访问都必须经过宿主桥接权限。当前手动面板仍只使用 GET 查询，不能直接完成带鉴权的 POST、文件上传和 zip 解压。因此：

- **提交解析（POST）** 由插件生成可复制的命令，用户在外部终端执行；
- **精准轮询（需 header）与 zip 解压** 前端无法自动完成，用户在外部拿到 `full.md` 后用插件「③ 导入」缓存。

> 这是当前插件面板的**诚实边界**。RaA 后台自动解析由宿主 C# 直接调用 MinerU，不经过前端面板。未来若开放插件 API，必须使用 manifest 声明的域名和宿主受控的多步骤请求，不能用任意 URL 模板。

## 安装

1. SgelinLog 导航栏「🧩 插件」→ 把 `minerU.zip` 拖入虚线框。
2. 插件列表点「MinerU PDF 解析」打开配置面板。

## 使用流程（在当前文献上操作）

1. 主界面选中一篇文献（打开详情）。
2. 打开「🧩 插件 → MinerU PDF 解析」。

### 方式 A：Agent 轻量（自动闭环）
1. 在面板「①」填 PDF 的**可访问 URL**，点「生成提交命令」→ 在外部终端执行；
2. 把返回的 `data.task_id` 粘贴回上框 → 「绑定并自动轮询」；
3. 插件自动查询 → 完成后自动下载 md 并缓存，详情页显示「📄 md缓存 · Agent自动 · 时间」。

### 方式 B：精准解析（公式精读）
1. 在面板「⚙️ 设置」填 Token 并保存；确认模型版本与 `enable_formula=true`；
2. 「②」填 PDF URL → 「生成精准提交命令」→ 外部终端执行（含 `Bearer <token>`、`model_version`、`enable_formula`）；
3. 外部轮询（`GET /api/v4/extract/task/{task_id}` 带 token）直到 `state=done`，下载 `full_zip_url` 的 zip；
4. 解压出 `full.md` → 用面板「③ 导入」选该文件 → 缓存完成，徽章显示「精准解析」。

### 方式 C：直接导入已有 md
任意已有解析结果（`.md`），用「③ 导入」缓存到当前文献即可。

## 配置项

| 配置 | 说明 | 默认 |
|---|---|---|
| `token` | 精准解析 API Token（Bearer 后内容） | 空 |
| `modelVersion` | 精准模型：`pipeline` / `vlm` / `MinerU-HTML` | `vlm` |
| `enableFormula` | 精准公式识别开关 | `true` |
| `cleanupDays` | 缓存自动清理间隔（天，0=不自动） | `30` |
| `pollInterval` | Agent 轮询间隔（秒，最小 5） | `10` |

## 数据与缓存目录（供 RaA / AI 读取的约定）

插件数据目录：主程序 `user_data/plugins/mineru-markdown/`

```
mineru-markdown/
├── config.json            # 插件配置（token / modelVersion / enableFormula / cleanupDays / pollInterval）
├── cache.json             # 缓存索引：key → {title, sourceFile, sourceHash?, mdFile, mode, source, modelVersion, updatedAt}
└── markdown/
    └── <文献名>_<key哈希8>.md  # 缓存正文（mode: agent | precise | import）
```

- `sourceFile` = 对应的 PDF 文件名，用于显示和兼容旧记录。
- `sourceHash` = 宿主 RaA 生成的 PDF 内容 SHA-256；宿主新写入的缓存必须同时匹配文件名和哈希，避免不同目录的同名 PDF 互相命中。旧记录没有哈希时会失效并重新解析。
- `key`：插件（文献详情页）写入为 `<主题topic>/<文献id>`；宿主 RaA 自动解析写入为 `raa/<PDF文件名>`。

## 与 RaA 集成（宿主已接入，软件 2.5.9+）

当用户通过 **`RaA -edt`** 把 RaA 执行方式改为「使用 MinerU 解析」后，宿主文献阅读 Agent 会：

1. **归档流程（`RaA`）** 与 **精读流程（`RaA -read_pre_M1/M2`）** 的 PDF 解析阶段改用 MinerU；
2. **先查本插件缓存**：按当前 PDF 文件名和内容哈希命中 `cache.json` → 直接读取对应 `.md`，不再重复解析；旧缓存缺少哈希时会重新解析；
3. **未命中再调 MinerU**，并把结果写回插件缓存（`source: "host-raa"`），下次复用；
4. 解析策略：**模式 1（摘要速览）→ Agent 轻量解析**（免 token）；**模式 2（全文精读）→ 精准解析**（需在插件配置 Token，公式/表格识别）；
5. MinerU 不可用（未装插件 / 缺 Token / 超限 / 网络失败）时**自动回退内置 PDFPig**，并在界面给出提示。

> 默认（RaA 未 -edt 或执行方式仍为 PdfPig）完全走内置解析，不影响原流程。


> 说明：手动解析（Agent/精准/导入）走插件前端面板；自动解析由宿主 RaA 在后台完成。两者共享同一份 `cache.json` 缓存，互相复用。

## 文件结构

```
minerU/
├── manifest.json   # 插件清单（id: mineru-markdown, v2.0.0）
├── main.js         # 入口脚本（缓存 + Agent 轮询 + 精准引导 + 导入 + 清理 + 配置面板）
├── README.md       # 本说明
└── 使用说明.md      # 面向用户快速上手
```

## 权限说明

- `network`：经宿主代理访问公开 HTTPS 地址（Agent 查询 / markdown CDN 下载）。
- `literature`：读取当前文献信息（topic / id / title）用于缓存 key 与命名。
- `storage`：读写当前插件自己的 `cache.json` 和 `markdown/` 缓存，不得越出插件目录。

> 安全提醒：当前 V2.5.9 的 `config.json` 仍是明文配置文件。Token 不应出现在日志、提交记录或截图中；宿主侧 API 自动调用的密钥保护将在后续版本单独实施。
