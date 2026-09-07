# SgelinLog 插件仓库

[SgelinLog](https://github.com/sationw/AI_Assistant_SgelinLog) 的官方插件分发仓库。

本仓库的插件目录**只提交可安装的 `.zip` 插件包**。插件源码、插件专属 README、用户使用说明和本地测试文件仅保存在开发者本机，不进入 Git。

## 插件列表

| 插件 | 类型 | 功能 | 下载 |
|---|---|---|---|
| MinerU PDF 解析 | `literature-enhancer`（V2.5.9 兼容） | PDF 转 Markdown、Agent/精准解析、缓存管理，并与 RaA 阅读流程共享缓存 | [下载 minerU.zip](https://raw.githubusercontent.com/sationw/SgelinLog_Plugin/master/minerU/minerU.zip) |
| easyScholar 期刊信息 | `literature-enhancer` | 查询期刊分区、影响因子、SCI 分区和 Top 信息 | [下载 easyscholar-journal.zip](https://raw.githubusercontent.com/sationw/SgelinLog_Plugin/master/easyscholar-journal/easyscholar-journal.zip) |

下载 zip 后打开 SgelinLog，进入导航栏「插件」，将 zip 拖入安装区域即可。

## 仓库结构

```text
Plug_in/
├── README.md
├── LICENSE
├── minerU/
│   └── minerU.zip
└── easyscholar-journal/
    └── easyscholar-journal.zip
```

本地开发者可以在上述目录暂存 `manifest.json`、`main.js`、插件说明和打包脚本，但这些文件由 `.gitignore` 排除。发布前只需更新对应 zip。

## 一、插件通用模型

插件是一个 zip 包，至少包含 `manifest.json`；可以包含入口脚本、资源文件和本地数据模板。宿主负责安装、启用、禁用、删除、配置存储和能力门禁，插件只依赖公开桥接 API。

插件脚本目前在 WebView2 页面上下文加载。桥接 API 是能力限制，不是操作系统级沙箱；不要把插件安装为低风险代码执行环境。尤其是 `process` 型插件必须按高风险、受信插件处理。

插件类型由 `type` 决定挂载点，适配器由 `kind` 决定执行方式：

| 类型/方式 | 用途 |
|---|---|
| `literature-enhancer` | 在文献详情页展示或增强信息 |
| `pdf-parser` | 将 PDF 转换为统一 Markdown 解析结果 |
| `assistant-tool` | 为 AI 助手提供受控工具（需单独实现宿主路由） |
| `reader-panel` | 提供阅读器面板或交互视图 |
| `api` | 宿主通过受限 HTTPS 代理调用远程服务 |
| `process` | 宿主启动本地解析进程，属于高风险能力 |

新增类型必须先有宿主挂载点和测试，不能只在 manifest 中填写新字符串。

## 二、通用 manifest

下面是适用于普通插件的最小合法 JSON。JSON 文件中不要写注释。

```json
{
  "schemaVersion": 1,
  "minHostVersion": "2.5.9",
  "id": "example-plugin",
  "name": "示例插件",
  "version": "1.0.0",
  "author": "DeveloperName",
  "description": "插件功能说明。",
  "type": "literature-enhancer",
  "entry": "main.js",
  "permissions": ["storage", "literature"],
  "config": [
    {
      "key": "enabled",
      "label": "启用功能",
      "type": "boolean",
      "default": "true"
    }
  ]
}
```

字段规则：

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | 建议 | manifest 契约版本；未知版本应拒绝安装 |
| `minHostVersion` | 建议 | 插件要求的最低宿主版本 |
| `id` | 是 | 仅允许字母、数字、`-`、`_`、`.` |
| `name` | 是 | 用户看到的名称 |
| `version` | 否 | 默认 `1.0.0`，建议使用语义化版本 |
| `type` | 是 | 宿主支持的挂载类型 |
| `entry` | 否 | 相对插件目录的入口脚本；路径不能包含目录穿越 |
| `permissions` | 否 | 只声明真正需要的宿主能力 |
| `config` | 否 | 配置字段数组，支持 `text`、`secret`、`number`、`boolean` |

当前宿主支持的权限包括：

| 权限 | 说明 |
|---|---|
| `storage` | 读写当前插件自己的数据目录 |
| `network` | 使用宿主受限网络代理 |
| `literature` | 读取当前文献非敏感元数据 |
| `pdf-input` | 接收宿主传入的 PDF |
| `process` | 启动本地进程，高风险 |

权限必须由宿主桥接层校验，不能只依靠前端隐藏按钮。

## 三、入口脚本和桥接 API

入口脚本使用 IIFE，并接收宿主传入的 `SgelinPlugin`：

```javascript
(function (SgelinPlugin) {
  "use strict";
  SgelinPlugin.onRender(function (paper) {
    SgelinPlugin.setDetailBadge("已加载");
  });
})(SgelinPlugin);
```

常用 API：

| API | 说明 |
|---|---|
| `id` | 当前插件 ID |
| `getCurrentPaper()` | 当前文献元数据 |
| `httpGet(url)` | 由宿主代理的受限 HTTPS GET |
| `getConfig()` | 获取当前插件配置；`secret` 只返回脱敏值 |
| `readFile(fileName)` | 读取插件数据目录文件 |
| `writeFile(fileName, content)` | 写入插件数据目录文件 |
| `setDetailBadge(html)` | 设置文献详情挂载内容 |
| `onRender(fn)` | 注册文献切换回调 |
| `saveConfig(values)` | 保存 manifest 已声明的配置 |
| `setConfigRenderer(fn)` | 注册插件配置界面 |

不要直接访问宿主 C# 内部对象、用户任意路径、注册表或系统命令。插件数据路径必须使用相对路径，宿主会拒绝目录穿越。

## 四、secret 配置

`type: "secret"` 的配置由宿主使用 Windows DPAPI 保存。插件前端只能得到脱敏值，不能依赖前端读取已保存的原始 Token。

开发要求：

- 不把 Token 写入日志、Markdown、缓存、截图或 Git；
- 不把 Token 拼入错误消息或普通 URL；
- 更新 Token 时由用户重新输入；
- API 适配器由宿主在进程内注入认证信息；
- `process` 型插件收到配置时应按高风险受信执行处理。

## 五、api 型插件

`api` 型插件适合远程 PDF 服务。宿主负责 HTTPS、允许域名、SSRF 防护、上传大小、响应大小、超时、取消和轮询次数。

多步骤服务应声明有限步骤，例如：

```json
{
  "type": "pdf-parser",
  "kind": "api",
  "permissions": ["network", "pdf-input"],
  "qualityLevel": 2,
  "api": {
    "endpoint": "https://api.example.com",
    "allowedHosts": ["api.example.com"],
    "steps": [
      { "id": "submit", "method": "POST", "path": "/v1/parse" },
      {
        "id": "poll",
        "method": "GET",
        "path": "/v1/tasks/{taskId}",
        "poll": { "intervalSeconds": 10, "timeoutSeconds": 600 }
      }
    ]
  }
}
```

不允许在 manifest 中执行任意 JavaScript、C#、shell 或无限制模板。远程响应最终必须映射为统一结果：

```json
{
  "success": true,
  "markdown": "# 标题",
  "tables": [],
  "warnings": []
}
```

## 六、process 型插件

`process` 型插件适合本地 exe、Python 或其他解析器。它不是完整操作系统沙箱，只有在用户明确同意高风险执行后才能使用。

标准调用约定：

```text
<runtime> <entry> --input <pdf-path> --options <json-config>
```

- exe 入口可以省略 runtime；Python 入口应声明 `runtime: "python"`；
- stdout 只输出最终 UTF-8 JSON；
- stderr 输出诊断信息；
- 非零退出码、非法 JSON、超时、取消、输出过大都视为失败；
- 宿主会终止整个进程树，但插件仍不得读取无关用户文件；
- process 插件必须声明 `process` 和 `pdf-input` 权限。

## 七、PDF 解析器统一结果

PDF 解析器的统一结果字段：

| 字段 | 说明 |
|---|---|
| `success` | 是否成功 |
| `markdown` | Markdown 正文；成功时必须是非空字符串 |
| `tables` | 可选表格数组 |
| `warnings` | 部分识别失败或降级提示 |
| `error` | 失败时包含 `code/message/retryable` |
| `metadata` | 页数、解析器版本、模型版本等非敏感信息 |

缓存身份应使用 PDF 内容 SHA-256、插件 ID、插件版本、质量等级和规范化配置哈希，不能只用 PDF 文件名。

## 八、开发、打包和提交

1. 在本地创建插件目录和源码文件。
2. 编写 manifest 和入口脚本。
3. 只使用声明的权限和桥接 API。
4. 为空配置、网络失败、超时、非法响应、重复文献和大文件编写测试。
5. 用 UTF-8 校验 manifest，并运行 JavaScript 语法检查。
6. 将 manifest、入口和资源打成插件 zip。
7. 在桌面版安装、启用、禁用、配置和卸载测试。
8. 将**只有 zip 的插件目录**提交到本仓库。

插件仓库不接收：源码、插件专属 README、用户说明、Token、缓存、日志、测试输出和临时文件。

## 九、与 PDF 专项指南的关系

本 README 是适用于 `literature-enhancer`、`assistant-tool`、`reader-panel`、`pdf-parser` 等插件的通用开发说明。

`PDF解析插件开发指南.md` 是本地保留的 PDF 解析专项设计文档，用于说明 `pdf-parser` 的质量等级、API 多步骤解析、统一结果和安全验收细节。它不上传插件仓库，也不限制其他类型插件采用各自的挂载点和结果契约。

## 开源协议

本仓库采用 [MIT License](./LICENSE)。
