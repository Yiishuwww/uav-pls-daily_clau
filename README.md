# UAV 物理层安全论文日报

每日自动汇总 **无人机通信物理层安全**（Physical Layer Security for UAV Communications）方向的最新论文，生成静态网站并部署到 GitHub Pages。

- 网站：`https://yiishuwww.github.io/uav-pls-daily_clau/`
- 更新：每天北京时间 **07:00**（GitHub Actions，UTC 23:00）
- 费用：零 API key、公开仓库零成本

## 功能

- 数据源：**arXiv API + OpenAlex + Crossref + DOAJ + Zenodo**，无需任何密钥
- 通过 Crossref 的 publisher member 精确覆盖 **IEEE / Elsevier / Springer / Wiley** 的期刊元数据
- 跨源去重：DOI → arXiv ID → 标题精确匹配 → 标题模糊匹配（≥94%）
- 相关性硬门槛：标题或摘要中必须同时出现 PLS 词与 UAV 词
- 自动打标签：RIS、NOMA、通感一体化、隐蔽通信、轨迹优化、波束成形、毫米波/THz、空天地网络等
- 中文界面，论文标题与摘要保留英文原文
- 顶部中文导读 + 随筛选变化的“本期概览”
- 预印本用灰色小标签标注，不抢视觉
- 搜索、时间范围、类型、月份、标签筛选，支持“最新发表 / 相关性”排序
- 支持 URL 参数分享；深色模式；手机适配；RSS 与 JSON 数据
- 内置 AI 问答（可选）：基于全部论文元数据回答，支持 `[n]` 引用定位，需部署一个 DeepSeek 代理（见下文）

## 检索覆盖

| 平台 | 接入方式 | 说明 |
|---|---|---|
| arXiv | 官方 Atom API | 无需 key，当日可见 |
| OpenAlex | REST API | 无需 key，覆盖全出版商元数据 |
| Crossref | REST API | 无需 key，按 member 覆盖 IEEE(263)、Elsevier(78)、Springer(297)、Wiley(311) |
| DOAJ | REST API | 无需 key，开放获取期刊 |
| Zenodo | REST API | 无需 key；可选 `ZENODO_TOKEN` 提高限额 |
| IEEE Xplore | 官方 Metadata API | 二期可接，需免费 key |
| Springer Link | Springer Nature Meta API | 二期可接，需免费 key |
| ScienceDirect / Elsevier | ScienceDirect Search API | 二期可接，需免费 key |
| Wiley | 无公开免费检索 API | 已由 Crossref 的 10.1002 前缀覆盖 |
| Web of Science | Starter API | 需机构订阅，暂不接入 |

> 没有 IEEE / Elsevier / Springer 的官方 key，也能拿到这些出版社论文的 DOI、标题、作者、期刊、日期等元数据；部分摘要可能缺失，此时仍可通过标题命中筛选。
>
> DOAJ 的复杂布尔查询不稳定，采集器会拆成多条单字段查询并在本地过滤；Zenodo 记录中会排除数据集/软件，只保留论文、预印本和会议论文。
>
> Zenodo 在部分网络环境（如国内部分宽带）可能无法解析；采集器会自动跳过并继续其他源。GitHub Actions 运行环境通常可以正常访问。

## 本地运行

需要 **Node.js 20+**。

```bash
npm install

# 首次回填 90 天（同时生成网站）
npm run backfill

# 日常增量（近 7 天）
npm start

# 不请求网络，只用现有数据重新生成网站
npm run render

# 本地预览 http://localhost:3000
npm run preview

# 校验生成的 JSON / RSS / 静态资源
npm run validate
```

然后打开 `http://localhost:3000`。

## 部署到 GitHub Pages

1. 在 GitHub 新建一个 **public** 仓库，例如 `uav-pls-daily_clau`。
2. 推送本项目：

   ```bash
   git remote add origin https://github.com/<你的用户名>/uav-pls-daily_clau.git
   git branch -M main
   git push -u origin main
   ```

3. 仓库 **Settings → Pages**：
   - Source 选择 **Deploy from a branch**
   - Branch 选择 **main**，目录选择 **/docs**
   - 保存后等待 1–2 分钟
4. 仓库 **Actions** 页面：
   - 如果提示工作流未启用，点击启用
   - 选择 **Daily update → Run workflow**，`days` 填 `7` 即可（仓库已带 90 天回填数据）
5. 之后每天 UTC 23:00（北京时间 07:00）自动更新。

> GitHub 的定时任务在高峰期可能延迟 5–30 分钟。公开仓库的 Actions 分钟数免费；每日提交也会避免仓库因 60 天无活动而被暂停定时任务。

## AI 问答（可选，DeepSeek）

页面右下角的「问 AI」会基于 `data/papers.json` 回答论文相关问题。因为 GitHub Pages 是纯静态托管，API key 不能放在前端，所以需要一个很小的代理。

> **国内公开访问推荐下面的阿里云 FC 或腾讯云 SCF 方案**，自带国内可访问的 HTTPS 地址，不用买域名；Cloudflare Worker 适合海外访问或自己挂代理使用。

### 方案一：阿里云函数计算 FC Web 函数（国内推荐）

阿里云 FC 的 **Web 函数**支持 SSE 流式输出（事件函数不支持），并自带国内可访问的默认 HTTPS 域名，普通访客不需要代理。

#### 1. 生成部署包

```powershell
cd C:\Users\wsy\uav-pls-daily
npm run render
npm run build:alibaba
tar.exe -a -c -f "dist\uav-pls-chat-alibaba.zip" -C "dist\alibaba" .
```

#### 2. 创建 FC Web 函数

1. 登录阿里云 **函数计算 FC** 控制台，完成实名认证。
2. **函数 → 创建函数**，选择 **Web 函数** / **使用自定义运行时创建**（不要选事件函数，事件函数不支持 SSE）。
3. 地域选离你近的，函数名 `uav-pls-chat`，运行环境选 **Node.js 18**（或 20）。
4. 代码选择 **上传 ZIP**，上传 `dist/uav-pls-chat-alibaba.zip`。
5. 运行配置：
   - **启动命令**：`node server.mjs`
   - **监听端口**：`9000`
   - **执行超时**：**120 秒**
   - **内存**：512MB
   - 环境变量：
     - `DEEPSEEK_API_KEY` = 你的 DeepSeek key
     - `DEEPSEEK_MODEL` = `deepseek-chat`
     - `ALLOWED_ORIGINS` = `https://yiishuwww.github.io,http://localhost:3000`
     - `PAPERS_URL` = `https://yiishuwww.github.io/uav-pls-daily_clau/data/papers.json`
6. 创建 **HTTP 触发器**：
   - 认证方式：**无需认证**
   - 请求方法：勾选 **GET、POST、OPTIONS**（OPTIONS 必须勾，否则浏览器跨域预检会失败）
   - 复制控制台显示的公网访问地址。

> 如果控制台只允许用 `bootstrap` 文件启动，在代码里新建：
> ```bash
> #!/usr/bin/env bash
> export PORT=9000
> exec node server.mjs
> ```
> 并确保它有可执行权限；能用「启动命令」配置时优先用启动命令。

#### 3. 验证

浏览器打开：

```text
https://<FC公网地址>/health
```

看到 `"configured": true` 和 `"papers": 60` 就成功了。

#### 4. 让页面指向 FC

GitHub 仓库 **Settings → Secrets and variables → Actions → Variables**：

- `CHAT_API_URL` = `https://<FC公网地址>/api/chat`

然后 Actions → Daily update → Run workflow，等 Pages 更新后强刷页面。

#### 5. 说明

- FC 默认域名会自动加 `Content-Disposition: attachment`，对 `fetch` 调用的 API 没有影响；长期公开使用建议以后绑自定义域名。
- 函数 URL 是公开的，建议在 FC 控制台设置最大并发（如 10）并监控调用量；DeepSeek 按量计费。
- 与腾讯云方案一样：启动时用内置论文数据，后台每 10 分钟尝试从 `PAPERS_URL` 拉取最新数据；每天有新论文时重新 `npm run build:alibaba` 并上传一次即可。

### 方案二：腾讯云 SCF Web 函数（国内可选）

腾讯云 SCF 的 **Web 函数**原生支持 SSE 流式输出，并自带国内可访问的函数 URL，普通访客不需要代理。

#### 1. 生成部署包

```powershell
cd C:\Users\wsy\uav-pls-daily
npm run render
npm run build:tencent
tar.exe -a -c -f "dist\uav-pls-chat-tencent.zip" -C "dist\tencent" .
```

生成的 ZIP 里包含 `server.mjs`、`worker/src/chat.js`、`worker/src/prompt.js` 和 `papers.json`（打包时的论文库）。

#### 2. 创建 Web 函数

1. 注册/登录腾讯云，完成实名认证，进入 **云函数 SCF** 控制台。
2. **函数服务 → 新建**，函数类型选择 **Web 函数**。
3. 地域选广州/上海等，名称 `uav-pls-chat`，运行环境选 **Node.js 18**（或 20）。
4. 代码选择 **上传 ZIP**，上传 `dist/uav-pls-chat-tencent.zip`。
5. 高级配置：
   - 启动命令：`/var/lang/node18/bin/node server.mjs`
     （Node.js 20 则是 `/var/lang/node20/bin/node server.mjs`，以控制台提示为准）
   - 执行超时：**120 秒**
   - 内存：256MB 即可
   - 环境变量：
     - `DEEPSEEK_API_KEY` = 你的 DeepSeek key
     - `DEEPSEEK_MODEL` = `deepseek-chat`
     - `ALLOWED_ORIGINS` = `https://yiishuwww.github.io,http://localhost:3000`
     - `PAPERS_URL` = `https://yiishuwww.github.io/uav-pls-daily_clau/data/papers.json`
6. 触发器：添加 **函数 URL**（公网访问），复制生成的 HTTPS 地址。

> 如果控制台强制要求 `scf_bootstrap`，在在线编辑器里新建该文件，内容为：
> ```bash
> #!/bin/bash
> /var/lang/node18/bin/node server.mjs
> ```
> 保存后访问函数 URL；如果报 405，检查启动命令路径和 LF 换行符。

#### 3. 验证

浏览器打开：

```text
https://<函数URL>/health
```

看到 `"configured": true` 和 `"papers": 60`（打包时的论文数）就成功了。

#### 4. 让页面指向腾讯云函数

GitHub 仓库 **Settings → Secrets and variables → Actions → Variables**：

- `CHAT_API_URL` = `https://<函数URL>/api/chat`

然后 Actions → Daily update → Run workflow，等 Pages 更新后强刷页面。

#### 5. 说明

- 函数 URL 是国内域名，普通访客无需代理即可使用 AI。
- 函数启动时会立即使用内置论文数据，并在后台每 10 分钟尝试从 `PAPERS_URL` 拉取最新数据；拉取失败就继续用内置数据。每天有新论文时，重新 `npm run build:tencent` 并上传一次，就能更新内置数据。
- 函数 URL 是公开的，建议在 SCF 控制台设置最大并发（如 10），并监控调用量；DeepSeek 按量计费。
- 腾讯云 SCF 有免费额度，个人使用通常够，具体以控制台计费为准。

### 方案三：Cloudflare Worker（海外/自用）

仓库里已经包含完整实现：

- `src/static/chat.js`：聊天面板、流式输出、引用定位
- `worker/src/`：请求校验、提示词构造、DeepSeek SSE 转发
- `wrangler.toml`：Worker 配置

#### 1. 申请 API Key

到 [DeepSeek 开放平台](https://platform.deepseek.com/) 创建 API Key（`sk-...`）。

#### 2. 部署 Worker

在仓库根目录执行：

```bash
npx wrangler login
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler deploy
```

`wrangler.toml` 里已经配置了论文数据地址和允许的页面来源。如果仓库名/域名不同，修改 `PAPERS_URL` 和 `ALLOWED_ORIGINS`。部署成功后会得到类似 `https://uav-pls-chat.<你的子域>.workers.dev` 的地址。

#### 3. 让页面指向 Worker

在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 新增：

- `CHAT_API_URL` = `https://uav-pls-chat.<你的子域>.workers.dev/api/chat`

然后手动运行一次 **Daily update**（或本地 `npm run render` 后提交），让 `docs/index.html` 写入新的接口地址。

> 不设置 `CHAT_API_URL` 时，页面会请求同域 `/api/chat`，在 GitHub Pages 上会返回 404，聊天框会提示「AI 服务未配置」。

#### 本地预览

```powershell
$env:DEEPSEEK_API_KEY = "sk-..."
npm run preview
```

打开 `http://localhost:3000`。本地预览服务器会把 `/api/chat` 转发到 DeepSeek，不需要部署 Worker。

#### Worker 配置

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_MODEL` | `deepseek-chat` | 对话模型；换成 `deepseek-reasoner` 时自动不发送 `temperature` |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 兼容网关可改 |
| `PAPERS_URL` | 本仓库 GitHub Pages 的 `data/papers.json` | Worker 请求时带 10 分钟缓存 |
| `ALLOWED_ORIGINS` | GitHub Pages + localhost | 逗号分隔；只填协议 + 域名 + 端口，不要带路径 |

#### 说明与限制

- 每次请求会把论文元数据（标题、作者、摘要、标签等，约 2 万 token）作为 system 提示发送给 DeepSeek；论文清单前缀稳定，能命中 DeepSeek 的自动上下文缓存。
- 当前 56 篇不需要向量检索；论文超过约 300–500 篇后，建议在 Worker 里先做关键词/BM25 筛选，或改用 embedding 检索。
- 公开 Worker 建议在 Cloudflare 控制台加一条速率限制规则（例如每 IP 每分钟 10 次），并控制 `max_tokens`（代码里默认 1200）。
- 前端只发送问题、最近几轮对话和当前筛选；API key 只存在 Worker secret 里，不会进入 `docs/` 或 Git 仓库。

## 配置

### `config/keywords.yaml`

- `pls_terms` / `uav_terms`：相关性词表
- `weak_pls_terms`：单独命中不能通过硬门槛的词。默认把 `jamming` / `anti jamming` 等抗干扰方向降为弱词，保证主题纯度；如果要纳入抗干扰论文，把对应词从 `weak_pls_terms` 中删掉即可
- `proximity_chars`：强 PLS 词与 UAV 词的最大共现距离，防止摘要两端各提一次造成误收
- `exclude_title_patterns`：排除社论、勘误、征稿，以及区块链、认证、入侵检测等明显不属于 PLS 的方向
- `scoring`：排序权重，不影响是否收录
- `tags`：主题标签的正则规则

### `config/sources.yaml`

- `contact_email`：可选，填入后进入 OpenAlex / Crossref 的 polite pool
- 各数据源的开关、每页条数、回溯上限
- `doaj`：DOAJ 查询页数与每页条数
- `zenodo`：Zenodo 每页条数；如需更高限额，在仓库 **Settings → Secrets and variables → Actions** 中添加 `ZENODO_TOKEN`
- 二期要接 IEEE / Springer / Elsevier 时，在此添加配置并在 `src/collectors/` 下新增适配器

## 项目结构

```
uav-pls-daily_clau/
├─ .github/workflows/daily.yml   # 每天 07:00（北京时间）运行
├─ config/
│  ├─ sources.yaml               # 数据源配置
│  └─ keywords.yaml              # 检索词、标签、打分
├─ src/
│  ├─ main.js                    # 采集 → 去重 → 打分 → 入库 → 渲染
│  ├─ collectors/
│  │  ├─ arxiv.js
│  │  ├─ openalex.js
│  │  ├─ crossref.js
│  │  ├─ doaj.js
│  │  └─ zenodo.js
│  ├─ dedup.js                   # 跨源去重与字段合并
│  ├─ rank.js                    # 相关性门槛、打分、标签
│  ├─ store.js                   # JSON 持久化
│  ├─ render.js                  # 网站与 RSS 生成
│  ├─ static/                    # 前端 CSS / JS（app.js、chat.js、style.css）
│  ├─ http.js                    # 超时与重试
│  └─ text.js                    # 文本归一化与日期工具
├─ worker/                       # 共用 AI 代理逻辑（Cloudflare Worker 入口也在这里）
│  └─ src/
│     ├─ index.js                # Cloudflare Worker 入口
│     ├─ chat.js                 # 请求校验、DeepSeek SSE 转发
│     └─ prompt.js               # system 提示与论文清单
├─ tencent/
│  └─ server.mjs                 # 通用 Web 函数入口（阿里云 FC / 腾讯云 SCF 共用）
├─ wrangler.toml                 # Cloudflare Worker 配置
├─ data/
│  ├─ papers.json                # 论文库（Git 即数据库）
│  └─ status.json                # 各数据源运行状态
└─ docs/                         # 生成的静态网站（GitHub Pages 源）
```

## 数据说明

- 仅收录公开元数据，不存储论文全文。
- `data/papers.json` 保留每条论文的来源、首次发现日期、标签与分数，可直接用于二次分析。
- 若某天没有新论文，网站仍会更新时间戳并提交，保证定时任务持续运行。

## 二期可扩展

- 接入 IEEE / Springer / Elsevier 官方 API（免费 key）
- 微信推送（Server酱 / PushPlus / 企业微信群机器人）
- 中文一句话摘要（可选 LLM，自带 key）
- 周报与引用量排序
