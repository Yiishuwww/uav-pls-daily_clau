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
│  ├─ static/                    # 前端 CSS / JS
│  ├─ http.js                    # 超时与重试
│  └─ text.js                    # 文本归一化与日期工具
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
