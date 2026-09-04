# easyScholar 期刊信息插件

> 本文件是 **easyscholar-journal 插件**的专属说明。插件开发总说明见[仓库主 README](../README.md)。

## 简介

自动识别当前文献的**期刊名称**，调用 [easyScholar](https://www.easyscholar.cc) 公开接口查询该期刊的**等级信息**（中科院分区、影响因子、SCI 分区、是否 Top 等），并显示在文献信息名称下方：

> 期刊名 → 年份 → 主题 → **easyScholar 返回的信息**

- 类型：`literature-enhancer`（文献详情页增强）
- 版本：1.0.0
- 作者：SgelinLog

## 安装方法

1. 打开 SgelinLog，点击顶部导航栏的「🧩 插件」按钮。
2. 在弹出的插件列表窗口中，把插件包 `easyscholar-journal.zip` **拖入**上方的虚线框（或点击虚线框选择文件）。
3. 安装成功后，插件会出现在下方列表中。

## 配置 SecretKey（必做）

easyScholar 接口需要通过 **SecretKey** 确认身份，首次使用前需要配置：

1. 在插件列表中，点击该插件右侧的「⚙️」设置按钮。
2. 在「easyScholar SecretKey」一栏填入你的 SecretKey。
   - SecretKey 在 [easyScholar 官网](https://www.easyscholar.cc) 获取（官网登录后进入个人中心可见），**无法更改，请勿透露给任何人**。
3. 点击「保存」。

> SecretKey 仅保存在本机插件目录（DPAPI 加密），不会上传到互联网或 git 仓库。

## 显示项说明

插件默认直接显示以下 4 项（按顺序）：

| 显示 | 含义 |
|---|---|
| 中科院分区 | 中科院升级版分区（如「工程技术4区」） |
| 影响因子 | SCI 影响因子（JCR，如「1.6」） |
| SCI分区 | SCI 分区（JCR，如「Q3」） |
| Top | 是否中科院 Top 期刊 |

其余字段（如 EI、ESI、SSCI、北大核心、五年影响因子、JCI 等）会折叠到「**更多…**」按钮，点击可展开查看。

你可以在插件设置里调整「直接显示的等级项数量」，控制直接显示几项、其余折叠。

## 本地缓存

- 每次查询成功后，结果会**保存到本地**（插件目录下的 `cache.json`）。
- 下次打开同一期刊的文献时，会**优先读取本地缓存**，不再重复调用接口（更快、更省请求次数）。
- 只有本地没有缓存时，才会调用 easyScholar 接口查询，并把新结果入库。

## 常见问题

- **显示「未配置 SecretKey」**：请先在插件设置里填入 SecretKey。
- **显示「查询失败 / 网络错误」**：请检查网络，或确认 SecretKey 是否正确。
- **显示「无数据」**：该期刊在 easyScholar 中暂无等级数据。
- **请求频率**：easyScholar 接口限速每秒最多 2 次，插件已通过本地缓存减少重复请求。

## 隐私说明

- 插件仅把**期刊名称**发送给 easyScholar 接口，不发送任何本地文献内容、笔记或个人信息。
- 查询结果仅保存在本机插件目录，不上传。

## 开发者信息

- 接口：`GET https://www.easyscholar.cc/open/getPublicationRank`（`secretKey` + `publicationName` 必填，每秒最多 2 次）
- 数据文件：插件目录下 `cache.json`（期刊名 → easyScholar 返回数据）
- 配置项：`secretKey`（secret）、`maxVisible`（number，默认 4）
- 入口：`main.js`（`onRender` 钩子 → 读缓存 → 调接口 → 写缓存 → `setDetailBadge` 渲染）