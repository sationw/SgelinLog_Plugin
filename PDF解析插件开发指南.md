# SgelinLog PDF 解析插件开发指南（pdf-parser）

> 文档状态：设计规范，目标版本 P0/P1 尚未全部落地。
> 当前宿主基线：AI_Assistance_SgelinLog 现有插件系统。
> 更新时间：2026-09-07。

本指南定义 SgelinLog 将 PDF 解析器统一接入宿主的目标契约。它区分两类内容：

- **当前已实现**：现有插件系统已经提供的能力。
- **目标契约**：完成对应阶段开发后，第三方 `pdf-parser` 插件才能使用的能力。

在 P1 完成前，`type: "pdf-parser"` 不是当前宿主可安装即用的插件类型。现有 MinerU 插件仍是 `literature-enhancer`，由宿主代码直接调用，不应按本指南的目标 manifest 发布。

## 一、设计目标和非目标

### 1.1 设计目标

宿主统一完成以下工作：

1. 发现和注册内置解析器、API 解析器和本地解析器。
2. 为所有解析器提供一致的 `ResolveAsync` 调用入口。
3. 统一处理模式、超时、取消、缓存、错误码和失败回退。
4. 让解析器只负责 PDF 到 Markdown 的转换，不依赖 RaA/read_pre 内部实现。
5. 对网络访问、配置、文件和本地进程执行施加明确的权限和信任边界。

### 1.2 非目标

本规范不承诺：

- 第三方插件可以在普通用户权限下获得真正的操作系统级沙箱。
- 任意远程 API 都能通过一个简单 URL 模板接入。
- `process` 插件是低风险插件。
- API Token 会自动安全存储，除非宿主已完成密钥保护实现。

## 二、当前实现状态

| 能力 | 当前状态 | 说明 |
|---|---|---|
| `literature-enhancer` 插件 | 已实现 | 当前插件体系支持 zip、manifest、entry、config、插件目录读写 |
| `pdf-parser` 类型 | 未实现 | `PluginManager` 当前不会按该类型注册解析器 |
| `api` 解析器适配器 | 未实现 | 当前插件桥接只有 GET 网络代理，无 POST、PUT、上传和响应映射 |
| `process` 解析器适配器 | 未实现 | 当前没有受控进程启动能力 |
| 配置保存 | 已实现但未加密 | `secret` 目前只是密码输入框，不能视为安全存储 |
| 插件目录读写 | 已实现 | `readFile/writeFile` 应继续使用路径规范化和越界检查 |
| 内置 PdfPig 回退 | 已实现 | MinerU 失败时可回退到 PdfPig |
| MinerU 分级缓存 | 已实现 | 当前缓存按 PDF 文件名匹配，P0 应升级为内容身份匹配 |

当前代码中，manifest 的 `type/kind/capabilities/qualityLevel/api/process` 目标字段尚未被解析。因此本文件中的目标契约必须与宿主版本一起发布，不能仅更新文档后宣称已支持。

## 三、平台安全模型

### 3.1 权限不是装饰字段

manifest 的 `permissions` 必须由宿主强制校验。插件没有声明对应权限时，宿主不得执行相应桥接调用。

建议权限：

| 权限 | 能力 |
|---|---|
| `storage` | 读写当前插件自己的数据目录 |
| `network` | 使用宿主的受控网络代理 |
| `pdf-input` | 接收宿主提供的 PDF 输入 |
| `process` | 启动本地解析进程，属于高风险权限 |
| `literature` | 读取当前文献的非敏感元数据 |

权限检查必须发生在宿主桥接层，而不是只由前端 UI 隐藏按钮。

### 3.2 文件边界

API 型插件不直接读取用户 PDF 路径，宿主负责上传或把内容以受控流传给远端服务。

插件数据文件只能位于当前插件的数据目录。所有路径都必须：

- 拒绝绝对路径和 `..`；
- 使用 `Path.GetFullPath` 后进行目录前缀校验；
- 拒绝目录、符号链接和越界重解析；
- 限制单次读取、写入和总缓存大小。

manifest 的 `entry` 也必须使用同一套路径校验，不能只对 `readFile/writeFile` 校验。

### 3.3 网络边界

宿主网络代理至少应满足：

- 默认只允许 HTTPS；HTTP 必须由用户明确允许；
- 对 manifest 中的域名做安装时展示和用户确认；
- 解析 DNS 后拒绝回环、私有、链路本地和 metadata 地址；
- 每次重定向重新执行地址校验；
- 限制连接超时、整体任务超时、请求体大小和响应体大小；
- 不把 Authorization、Token、Cookie 和完整请求体写入普通日志；
- 对 POST、PUT、上传、轮询分别定义请求类型和大小限制；
- 对每个插件和每个解析器设置并发上限。

只检查 URL 是 `http/https` 不能构成 SSRF 防护。

### 3.4 Secret 管理

当前 `config.json` 明文保存配置，因此现有 `secret` 字段只能视为“敏感配置提示”，不能视为安全存储。

目标实现应：

1. 使用 Windows DPAPI 或现有 `SecureStorage` 保存 Token。
2. 前端只能显示脱敏值，不能读取原始 Token。
3. API 适配器在宿主侧注入 Authorization，不使用字符串模板展开 Token。
4. 日志、异常、缓存和 curl 文本中不得出现 Token。
5. 更换 Token 后使旧凭据失效，并支持用户删除凭据。

### 3.5 process 型插件的真实信任级别

`process` 插件不是普通低权限插件。只要进程以当前用户身份运行，限制工作目录和传入 PDF 路径并不能阻止它读取当前用户有权限访问的其他文件。

因此：

- P2 默认把 process 插件标记为“高风险/受信插件”；
- 安装时展示入口文件、命令行、网络和文件风险；
- 使用 Windows Job Object 管理整个进程树；
- 限制运行时间、内存、CPU、输出大小和子进程数量；
- 使用独立临时目录，并在结束后清理；
- 超时、取消和异常退出都必须终止整个进程树；
- 不得把“工作目录限制”描述成完整文件系统沙箱。

## 四、统一解析器抽象

目标宿主接口示意如下：

```csharp
public enum PdfResolveMode
{
    Quick = 1,
    Deep = 2
}

public interface IPdfTextResolver
{
    string Id { get; }
    string DisplayName { get; }
    int QualityLevel { get; }
    Task<PdfResolveResult> ResolveAsync(
        string pdfPath,
        PdfResolveOptions options,
        CancellationToken cancellationToken);
}

public sealed class PdfResolveOptions
{
    public PdfResolveMode Mode { get; init; }
    public IReadOnlyDictionary<string, string> Config { get; init; }
        = new Dictionary<string, string>();
}

public sealed class PdfResolveResult
{
    public bool Success { get; init; }
    public string Markdown { get; init; } = "";
    public IReadOnlyList<PdfTable> Tables { get; init; } = Array.Empty<PdfTable>();
    public PdfResolveError? Error { get; init; }
    public IReadOnlyList<string> Warnings { get; init; } = Array.Empty<string>();
    public long CostMs { get; init; }
    public long? ConsumedQuota { get; init; }
}

public sealed class PdfTable
{
    public int Page { get; init; }
    public string Csv { get; init; } = "";
}

public sealed class PdfResolveError
{
    public string Code { get; init; } = "unknown_error";
    public string Message { get; init; } = "";
    public bool Retryable { get; init; }
}
```

### 4.1 模式和质量等级

| 模式 | 最低质量等级 | 目标用途 |
|---|---:|---|
| `Quick` | 1 | 摘要速览，允许少量页数和轻量解析 |
| `Deep` | 2 | 全文精读，需要正文、表格和公式的稳定结果 |

质量等级是解析器声明的能力，不是成功保证。解析器实际返回的 warnings 必须保留，不能因声明了 `formula` 就假定每个公式都能识别。

### 4.2 缓存身份

缓存键不得只使用 PDF 文件名。建议至少包含：

```text
sha256(pdf content)
+ resolver id
+ resolver version
+ quality level
+ normalized configuration hash
```

缓存记录还应包含创建时间、源文件大小、解析器版本、模型版本、结果大小和 warnings。旧版按文件名建立的 MinerU 缓存只能兼容读取，不能作为新缓存的唯一身份；无法确认文件内容时应失效重算。

### 4.3 调度规则

宿主负责：

1. 注册内置解析器和已启用的 `pdf-parser` 插件。
2. 验证插件权限、manifest 版本和配置后再调用。
3. 对单次解析设置整体超时，并把取消传递到底层。
4. 对同一解析器使用并发限制，避免远端服务过载或额度滥用。
5. 首选解析器失败时按策略回退 PdfPig，并返回机器可读错误码和用户提示。
6. 不因网络失败、超时或结果非法而把半成品写入成功缓存。

## 五、manifest 契约

### 5.1 最小 manifest

下面是目标契约的合法 JSON 示例，JSON 内不允许写注释：

```json
{
  "schemaVersion": 1,
  "minHostVersion": "2.6.0",
  "id": "example-pdf-parser",
  "name": "示例 PDF 解析器",
  "version": "1.0.0",
  "author": "DeveloperName",
  "description": "将 PDF 转换为 Markdown。",
  "type": "pdf-parser",
  "kind": "api",
  "permissions": ["storage", "network", "pdf-input"],
  "capabilities": ["text", "table", "formula"],
  "qualityLevel": 2,
  "config": [
    {
      "key": "token",
      "label": "服务 Token",
      "type": "secret",
      "default": ""
    }
  ],
  "api": {
    "allowedHosts": ["api.example.com"],
    "steps": [
      {
        "id": "parse",
        "method": "POST",
        "path": "/v1/parse",
        "body": "multipart-pdf",
        "response": "json"
      },
      {
        "id": "result",
        "method": "GET",
        "path": "/v1/tasks/{taskId}",
        "poll": { "intervalSeconds": 10, "timeoutSeconds": 600 },
        "response": "pdf-result-v1"
      }
    ]
  }
}
```

### 5.2 字段规则

| 字段 | 规则 |
|---|---|
| `schemaVersion` | 必填，未知版本不得静默安装 |
| `minHostVersion` | 必填，宿主版本不足时拒绝启用并说明原因 |
| `id` | 必须是安全标识符，只允许字母、数字、`.`、`_`、`-` |
| `type` | P1 仅允许 `pdf-parser` |
| `kind` | 只能是 `api` 或 `process` |
| `permissions` | 只能使用宿主支持的权限名，未知权限拒绝安装 |
| `capabilities` | 只能使用 `text`、`table`、`formula` |
| `qualityLevel` | 只能是 1、2、3 |
| `config` | 沿用现有插件的 `config[]`，不再引入 `options[]` |
| `entry` | process 必填，api 不使用；必须通过插件目录路径校验 |
| `api.allowedHosts` | 安装时展示并确认，运行时禁止访问列表之外的主机 |

配置值不得通过 `${token}` 这类字符串模板直接展开。认证信息应使用结构化声明，例如宿主内部保存 `config:token`，HTTP 层按 Bearer 认证注入。

### 5.3 API 型的限制

API 适配器必须支持有限的、可校验的步骤类型：

- `POST`/`PUT` 请求；
- PDF multipart 上传；
- JSON 任务提交和任务 ID 提取；
- 有最大次数和最大总时长的轮询；
- 结果下载和统一输出映射。

不允许 manifest 提供任意 C#、JavaScript 或 shell 表达式。复杂的供应商协议应实现为宿主内置适配器，或使用 process 型受信插件，不能用无限制模板规避安全校验。

## 六、统一输出契约

### 6.1 成功结果

process 型通过 stdout 输出一个 UTF-8、无 BOM 的 JSON 对象；api 型由宿主适配器映射为相同的内部对象：

```json
{
  "success": true,
  "markdown": "# 标题\n\n这是公式：$$\\int_0^1 x\\,dx$$",
  "tables": [
    { "page": 1, "csv": "Name,Age\nAlice,20" }
  ],
  "metadata": {
    "pageCount": 5,
    "parser": "example-pdf-parser",
    "parserVersion": "1.0.0",
    "modelVersion": "v1"
  },
  "warnings": []
}
```

### 6.2 失败结果

```json
{
  "success": false,
  "markdown": "",
  "tables": [],
  "error": {
    "code": "remote_timeout",
    "message": "解析服务在 600 秒内未完成。",
    "retryable": true
  },
  "warnings": []
}
```

宿主必须拒绝以下结果：JSON 无法解析、`success` 缺失、成功但 `markdown` 不是字符串、输出超过大小限制、进程退出码异常或在超时后才返回的结果。

### 6.3 传输和大小限制

- stdout 只承载最终 JSON；诊断日志写 stderr，不得混入 stdout。
- 宿主必须异步读取 stdout/stderr，避免大输出导致管道死锁。
- 默认限制最终 JSON 大小，例如 32 MB；具体值由宿主配置。
- 进度使用独立事件或宿主轮询，不把非 JSON 文本混入最终结果。
- `metadata` 中不得保存 Token、完整 PDF 内容或隐私信息。

## 七、ZIP、安装和供应链

安装插件时宿主应：

1. 解压到临时目录并验证 zip 条目路径，拒绝目录穿越和异常文件名。
2. 验证 manifest、版本、权限、入口路径和 API 域名。
3. 展示插件作者、版本、权限、入口、远程域名和数据出境提示。
4. 在用户确认后安装，并保存 zip SHA-256。
5. 升级时保留用户配置，但重新执行 manifest 校验和权限确认。
6. 支持停用、删除和回滚到上一个已验证版本。
7. 未来增加签名校验；在签名能力完成前，第三方插件应显示为未签名高风险插件。

## 八、分阶段实施计划和验收标准

### P0：统一宿主内部抽象

内容：

- 建立 `IPdfTextResolver` 和注册表；
- 将 PdfPig 和现有 MinerU 接入统一结果对象；
- 保持 `read_pre` 与批量归档的现有行为；
- 缓存键升级为 PDF 内容身份；
- 完成错误码、取消、超时、并发和回退。

验收：

- 现有 MinerU 测试全部通过；
- 两个调用点均只依赖统一解析入口；
- 同名不同内容的 PDF 不会互相命中缓存；
- 解析失败、取消、超时均能回退或返回明确错误；
- 旧缓存无法确认来源时不会被当作新缓存使用。

### P1：API 型插件

建议拆分为两个子阶段：

- **P1a**：密钥保护、权限校验、HTTPS/SSRF 防护、POST/PUT/上传和大小限制。
- **P1b**：有限步骤模型、任务轮询、响应映射和 `pdf-parser` 注册。

验收：

- 一个本地 mock API 插件可以完成安装、配置、上传、轮询、结果缓存和失败回退；
- 未声明 `network` 的插件调用网络会被拒绝；
- mock API 返回恶意重定向、内网地址、大响应和超时时均被拦截；
- Token 不出现在前端、日志、错误和缓存中；
- MinerU 多步骤流程不需要复制 curl 或人工导入。

### P2：process 型插件

内容：

- Job Object 管理进程树；
- 限制超时、内存、CPU、输出大小和子进程；
- 临时输入目录、清理和取消；
- 明确高风险插件的安装确认。

验收：

- 主进程和子进程均能在取消/超时时结束；
- stdout 非法 JSON、超大输出、非零退出码都不会写成功缓存；
- 插件声明的入口不能越出插件目录；
- 安装界面明确显示 process 插件不是完整 OS 沙箱。

### P3：Agent 工具化（可选）

只有在 P0/P1 稳定后再暴露 `parse_pdf`。必须增加：

- 单次和每日额度；
- 允许的 resolver 白名单；
- 批量调用确认；
- Agent 取消和审计日志；
- 防止通过提示词诱导大量远程解析。

### P4：DLL 型插件（不建议优先）

不建议加载第三方 .NET DLL 作为普通插件。DLL 与宿主处于同一进程时无法提供可靠隔离，除非改为独立进程并采用明确的受信模型。

## 九、插件开发和测试清单

开发者提交插件前应确认：

- manifest 是严格合法 JSON，不含注释；
- `schemaVersion`、`minHostVersion`、权限、入口和域名填写完整；
- 不读取插件目录之外的文件；
- 不在日志、异常或 UI 中显示 Token；
- API 只访问声明的 HTTPS 域名；
- 轮询有最大时长和最大次数；
- 失败返回标准错误码，不把失败结果写入缓存；
- 成功结果包含 Markdown，表格和公式缺失时使用 warnings；
- 大 PDF、大 Markdown、空 PDF、损坏 PDF 和重复文件名均有测试；
- 取消、超时、断网、HTTP 4xx/5xx、非法 JSON 和服务端部分成功均有测试。

宿主侧至少应提供以下安全回归测试：

1. manifest `entry` 越界被拒绝；
2. zip 条目目录穿越被拒绝；
3. 未授权插件无法调用网络和文件桥接；
4. localhost、私有地址、重定向和 DNS 解析后的内网地址被拦截；
5. Token 不出现在日志、错误、前端消息和缓存；
6. process 超时能终止子进程树；
7. 同名不同内容 PDF 的缓存不会互相污染。

## 十、现有 MinerU 插件迁移说明

当前 `Plug_in/minerU` 使用 `type: "literature-enhancer"`，网络能力受 GET-only 桥接限制，精准解析需要复制 curl 或手动导入结果。因此它不能通过仅修改 manifest 的方式迁移为 `pdf-parser`。

迁移顺序应为：

1. P0 先让宿主内置 MinerU 使用统一 resolver；
2. P1a 完成安全网络代理和密钥保护；
3. P1b 为 MinerU 建立多步骤 API 映射；
4. 用端到端测试确认新插件结果、缓存和回退与旧行为一致；
5. 再决定是否将 MinerU 从内置 resolver 拆成独立插件。

在上述工作完成前，本指南只作为平台设计和实施依据，不作为当前版本的可安装插件 API 承诺。
