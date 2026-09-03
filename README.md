# SgelinLog 插件仓库

[SgelinLog](https://github.com/sationw/AI_Assistant_SgelinLog) 文献阅读器的官方插件仓库。

本仓库存放 SgelinLog 的插件（`.zip` 插件包 + 源码），供用户下载安装，也供开发者参考实现自己的插件。

## 插件列表

| 插件 | 说明 | 安装包 |
|---|---|---|
| [easyScholar 期刊信息](./easyscholar-journal/) | 自动识别当前文献的期刊，调用 easyScholar API 获取期刊等级信息（中科院分区、影响因子、SCI 分区、是否 Top 等），显示在文献信息名称下方；查询结果本地缓存 | [easyscholar-journal.zip](./easyscholar-journal.zip) |

## 安装插件

1. 打开 SgelinLog，点击顶部导航栏的「🧩 插件」按钮。
2. 在弹出的插件列表窗口中，把下载的 `.zip` 插件包**拖入**上方的虚线框（或点击虚线框选择文件）。
3. 安装成功后，插件会出现在下方列表中，可启用/禁用、删除、配置。

## 开发插件

- 插件开发文档：[README.md](./README.md)（本文件下方）
- 插件设计原则：**插件适配软件**（而非软件适配插件），插件功能由插件本身实现，主程序只提供通用、最小化的宿主能力。

## 开源协议

本仓库采用 [MIT License](./LICENSE)。

---

# SgelinLog 插件开发文档

> 面向插件开发者。本文档说明如何为 SgelinLog 开发一个插件。

## 一、插件是什么

SgelinLog 插件是一个 **`.zip` 包**，内含：

- `manifest.json`（必需）：插件清单，描述元数据、类型、入口、权限、可配置项。
- `main.js`（可选）：入口脚本，实现插件逻辑。
- 其它资源（可选）：图片、样式、数据文件等。

安装后解压到 `user_data/plugins/<id>/`，由宿主（主程序）负责加载与调度。

**核心设计原则**：

> 主程序只依赖接口，插件只依赖接口。主程序通过接口调用插件而不关心其实现；插件通过接口使用宿主能力而不直接触碰内部对象。插件功能（如缓存、业务逻辑）应由**插件本身**实现，主程序只提供**通用、最小化**的宿主能力。

## 二、manifest.json 结构

```json
{
  "id": "easyscholar-journal",
  "name": "easyScholar 期刊信息",
  "version": "1.0.0",
  "author": "SgelinLog",
  "description": "……",
  "type": "literature-enhancer",
  "entry": "main.js",
  "permissions": ["network", "literature"],
  "config": [
    { "key": "secretKey", "label": "easyScholar SecretKey", "type": "secret", "default": "" },
    { "key": "maxVisible", "label": "直接显示的等级项数量", "type": "number", "default": "4" }
  ]
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 唯一标识，仅允许字母、数字、`-`、`_`、`.`（防路径穿越） |
| `name` | 是 | 显示名称 |
| `version` | 否 | 版本号，默认 `1.0.0` |
| `author` | 否 | 作者 |
| `description` | 否 | 描述 |
| `type` | 是 | 插件类型，决定挂载点（见下文） |
| `entry` | 否 | 入口脚本文件名（相对插件目录） |
| `permissions` | 否 | 声明能力：`network`（联网）、`literature`（文献） |
| `config` | 否 | 可配置项定义，`type` 支持 `text` / `secret` / `number` / `boolean` |

### 插件类型（type）

| type | 挂载点 | 说明 |
|---|---|---|
| `literature-enhancer` | 文献详情页 | 在文献信息名称下方注入内容（如期刊等级信息） |

> 未来可扩展 `assistant-tool`（AI 助手工具）、`reader-panel`（阅读面板）等。

## 三、入口脚本（main.js）

入口脚本以 IIFE 形式编写，接收受限桥接对象 `SgelinPlugin`：

```javascript
(function (SgelinPlugin) {
  "use strict";
  // 插件逻辑
})(SgelinPlugin);
```

### 桥接对象 API（SgelinPlugin）

| 方法 | 返回 | 说明 |
|---|---|---|
| `SgelinPlugin.id` | string | 插件 id |
| `SgelinPlugin.getCurrentPaper()` | object | 当前文献 `{topic, id, title, journal, year, author, ...}` |
| `SgelinPlugin.httpGet(url)` | Promise | 发起 GET 请求（宿主代理，避免 CORS），返回 `{ok, status, body}` |
| `SgelinPlugin.getConfig()` | object | 读取插件自身配置值（key → value） |
| `SgelinPlugin.readFile(fileName)` | Promise | 读取插件数据目录下的文件，返回 `{ok, exists, content}` |
| `SgelinPlugin.writeFile(fileName, content)` | Promise | 写入插件数据目录下的文件，返回 `{ok}` |
| `SgelinPlugin.setDetailBadge(html)` | void | 在文献详情页注入 HTML |
| `SgelinPlugin.onRender(fn)` | void | 注册渲染钩子（每次切换文献时调用） |

### 安全约束

- 插件脚本**不直接操作 DOM**，只能通过桥接对象访问能力。
- 联网请求由宿主代理（`httpGet`），仅允许 http/https，防 SSRF。
- 文件读写限定在**插件自己的数据目录**内（`user_data/plugins/<id>/`），防路径穿越。
- 配置（如 secretKey）由宿主保存到插件目录 `config.json`，前端仅回显脱敏值。

## 四、插件数据持久化（缓存等）

插件需要持久化数据（如查询缓存）时，**由插件自己实现**，使用通用的文件读写能力：

```javascript
// 读取缓存
SgelinPlugin.readFile("cache.json").then(function (res) {
  var cache = {};
  if (res.ok && res.exists && res.content) {
    try { cache = JSON.parse(res.content) || {}; } catch (e) {}
  }
  // 使用 cache
});

// 写入缓存
SgelinPlugin.writeFile("cache.json", JSON.stringify(cache));
```

> 主程序**不提供**「缓存」这类业务接口，只提供「读写插件数据目录文件」这一通用能力。插件自行决定存什么、怎么存（JSON、文本等）。

## 五、完整示例：easyScholar 期刊信息插件

见 [easyscholar-journal/](./easyscholar-journal/)：

- `manifest.json`：声明 `literature-enhancer` 类型 + `secretKey` / `maxVisible` 配置项。
- `main.js`：
  1. `onRender` 钩子监听文献切换；
  2. 取当前文献期刊名；
  3. 先查本地缓存（`readFile("cache.json")`），命中直接显示；
  4. 未命中调 easyScholar API（`httpGet`）；
  5. 解析 `officialRank` / `customRank`，新结果写入缓存（`writeFile`）；
  6. 默认显示中科院分区（sciUp）、影响因子（sciif）、SCI 分区（sci）、是否 Top（sciUpTop），其余折叠到「更多…」。
- `使用说明.md`：面向用户的使用说明。

打包：运行 `pack.bat` 生成 `easyscholar-journal.zip`，拖入软件「🧩 插件」弹窗即可安装。

## 六、easyScholar API 参考

- 接口：`https://www.easyscholar.cc/open/getPublicationRank`（GET）
- 参数：`secretKey`（必填）、`publicationName`（必填，需 `encodeURIComponent`）
- 返回：`{ code, msg, data }`，`code=200` 成功
  - `data.officialRank.all`：官方数据集（缩写 → 等级），如 `sciUp`（中科院升级版分区）、`sciif`（影响因子）、`sci`（SCI分区）、`sciUpTop`（是否Top）等
  - `data.customRank`：自定义数据集（`rankInfo` 缩写 + `rank` 等级）
- 限速：每秒最多 2 次请求

## 七、安装 / 卸载 / 配置

- **安装**：拖入 `.zip` 到「🧩 插件」弹窗的虚线框。
- **卸载**：插件列表点 🗑 删除（移除插件目录）。
- **启用/禁用**：插件列表点 ⏸/▶ 切换。
- **配置**：插件列表点 ⚙️ 打开设置表单（由 manifest 的 `config` 定义）。

## 八、开发建议

1. **插件适配软件**：不要假设主程序内部结构，只依赖桥接对象 API。
2. **最小权限**：`permissions` 只声明真正需要的。
3. **自行持久化**：缓存、历史等数据用 `readFile` / `writeFile` 存到插件数据目录。
4. **容错**：网络失败、无数据、配置缺失时给出友好提示（如 `setDetailBadge` 显示占位文案）。
5. **限速**：外部 API 注意限速（如 easyScholar 每秒 2 次），用本地缓存减少重复请求。