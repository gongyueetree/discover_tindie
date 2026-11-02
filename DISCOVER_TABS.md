# Discover 页面升级：四个 TAB（说明文档）

> 适用于本仓库 `gongyueetree/discover_tindie`。原 Discover 资源页（`tindie-app`）的功能、后台和数据库全部保留；
> 在同一个页面里增加了三个工具 TAB。元器件、开源工程、知识图谱数据来自 **ezplm_partdata** 的对外接口（Partner API），
> 解析与绘图引擎来自 **eelib**。

---

## 1. 页面结构

页面顶部是一排 TAB（风格与原 Discover 页一致：Poppins 字体、青绿色 #22b8c4、1200px 内容宽度、#fafdfd 标题带）。
本应用嵌在 tindie.com 的 iframe 里，页头页脚由 tindie.com 提供，所以本应用**不渲染自己的页头/页脚**（与原来一致）。

| TAB | 路径 | 内容 | 数据 / 引擎 |
|---|---|---|---|
| **Resources**（默认） | `/`（`/embed` 相同） | 原 Discover 页面，原样保留：每日硬件发现、博客、资源目录、推荐横幅、收藏 | 原 Postgres 数据库 + 原后台 `/admin` |
| **Components** | `/tools/components` | 型号搜索 → 详情（分类、生命周期、参数及来源、数据手册）→ 符号/封装/3D 预览 → 使用该器件的开源设计 → 加入 PCB planner；"View related components" 打开知识图谱 | partdata `parts/*`、`designs?part=`；符号/封装取 KiCad 官方库，用 eelib 的 CAD 预览引擎绘制；3D 用 KiCad 官方 STEP |
| **Open hardware** | `/tools/circuits` | 按电路模块分类浏览开源设计，或按型号查找；打开设计 → 原理图 / PCB / 3D / BOM / iBOM / 文件下载；也可打开自己的文件或导入 GitHub 工程 | partdata `designs/*` + 电路模块分类；工程文件从 GitHub 按**固定提交**拉取，在浏览器里用 eelib/canon 引擎解析 |
| **PCB planner** | `/tools/planner` | 手动摆放封装、板框检查、2D/3D、BOM 估价、导出 KiCad | 封装：partdata 记录的封装名 → KiCad 官方库；protopcb 几何引擎 |

旧路径兼容：`/discover`、`/tools/resources` → `/`；`/tools/viewer` → `/tools/circuits`。

---

## 2. 数据流与安全

```
访客浏览器 ──▶ 本站 /api/maker/*（访客限流、缓存 10 分钟、匿名访客哈希）──签名──▶ ezplm_partdata /api/pub/v1、/api/kg/v1
                     │
                     ├──▶ GitHub（开源设计的工程文件，固定提交，只读公开仓库）
                     ├──▶ gitlab.com/kicad（官方符号 / 封装 / 3D 模型，固定 tag 10.0.0）
                     └──▶ DigiKey / Mouser（可选：数据库里没有的型号、BOM 报价）
```

- 密钥只在服务端：`PARTDATA_API_KEY` / `PARTDATA_API_SECRET` 不能加 `NEXT_PUBLIC_` 前缀，浏览器永远不直接调用 partdata。
- 签名按 `PUBLIC_API.md` 实现（HMAC-SHA256、base64url、5 个请求头）。`npm test` 里有用 partdata 自己的 Python 实现生成的签名对照用例。
- `X-End-User` = sha256(访客 IP + 当天日期 + 盐) 前 32 位，partdata 可以按访客限额，但拿不到访客 IP，且跨天不可关联。
- partdata 的响应按它的要求在服务端缓存 10 分钟；BOM 匹配按 10 行一批发送（partdata 每 10 行计 1 次调用）。
- partdata 的质量规则原样遵守：只显示它输出的字段；`withheld` 的字段明确提示"有冲突未输出"；BOM 匹配 `ambiguous` / `candidates` 一律让用户确认，不自动替换；厂商参考设计不显示 BOM，只给来源链接；替代候选标明"未核对引脚/封装/电气"。
- 中文分类、厂商名在页面上显示英文（`src/lib/partdata/glossary.ts`：完整 ezPLM 分类树对照表 + partdata `config/mfr_lineage.yaml` 的规范厂商名），原始值不改。

### 为什么"Open hardware"按模块 / 型号进入

partdata 出于防爬设计**没有"列出全部设计"的接口**（只能按物料 / 型号 / 器件族查，每次最多看前 100 条）。所以这个 TAB 以电路模块分类作为浏览入口（默认"嵌入式处理"），再加上按型号查找。

---

## 3. 环境变量（服务端）

在 Vercel → Project → Settings → Environment Variables 配置；本地放在 `.env.local`（已被 git 忽略）。完整清单见 `.env.example`。

| 变量 | 必需 | 说明 |
|---|---|---|
| `PARTDATA_API_BASE` | 是 | partdata 平台地址，如 `https://xxx.up.railway.app`（不带末尾 `/`） |
| `PARTDATA_API_KEY` / `PARTDATA_API_SECRET` | 是 | partdata 后台「对外接口」页创建，勾选 `parts:read`、`designs:read`、`kg:read` |
| `MAKER_GITHUB_TOKEN` | 强烈建议 | GitHub 只读 token。不配时 GitHub API 每小时只有 60 次（每打开一个设计约用 3 次） |
| `AUTH_SECRET` | 是（原有） | 原有登录用；也用于签 GitHub 导入凭据（多实例部署时各实例必须一致） |
| `POSTGRES_URL` 等 | 原有 | Resources TAB 和后台用，与原项目相同 |
| `DIGIKEY_*` / `MOUSER_API_KEY` | 可选 | 数据库没有的型号和 BOM 报价 |
| `AZURE_TRANSLATOR_KEY` / `_REGION` | 可选 | 词表外的中文长描述机器翻译（非大模型） |

后台 `/admin` 的 Dashboard 顶部新增 **Parts database** 状态卡：显示是否已配置、连接的主机、延迟、知识图谱快照规模，可一键重新检查（只有编辑/管理员能看到）。

---

## 4. 本地运行与联调

```bash
npm ci
cp .env.example .env.local      # 填 PARTDATA_*；没有数据库时 Resources TAB 显示仓库里的资源目录
npm run dev                     # http://localhost:3000
```

### 用本地 partdata 做完整联调（不碰线上）

```bash
# 在 ezplm_partdata 仓库里
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
set -a; . ./.env.development.example; set +a; unset DATABASE_URL
.venv/bin/python -m ezplm_pilot.cli ingest --source sample            # 150 条样例物料
.venv/bin/python /path/to/discover_tindie/scripts/dev/seed_partdata_local.py
#   ↑ 加入若干真实器件、两个真实开源设计（tangent3D/z-fighter 固定提交）、
#     一个厂商参考设计、约 40 个标明为 fixture 的设计，构建知识图谱快照，并打印一把合作方密钥
EZPLM_NO_SCHEDULER=1 .venv/bin/python -m uvicorn ezplm_pilot.web:app --port 8080
```

把脚本打印的三行 `PARTDATA_*` 写进本仓库 `.env.local`，重启 `npm run dev`。

### 测试命令

```bash
npm test             # 18 组离线检查（签名对照、KiCad 名称解析、映射、路由、BOM、解析器、iBOM、PCB planner …）
npx tsc --noEmit     # 类型检查
npm run build        # 生产构建
npm run build:kicad-index   # （可选）重新生成 KiCad 官方库名称索引 src/data/kicad-index.json
```

---

## 5. 上线 / 切换到 tindie.com/discover

1. 在 Vercel 新建项目导入本仓库（框架自动识别为 Next.js），环境变量照第 3 节填写；数据库变量与原项目相同（可直接连原数据库）。
2. 用 Vercel 给的测试域名完整测试四个 TAB 和后台。
3. 测试通过后，把 tindie.com/discover/ 的 iframe 地址指向新部署（或把原域名切到新项目）。`next.config.js` 的 `frame-ancestors` 已允许 `*.tindie.com`。
4. Service Worker 缓存版本已升到 `tindie-v2`，老访客会自动拿到新页面。

---

## 6. 相对 GPT 原型修复 / 调整的问题

**数据与接口**
- 所有元器件、设计、知识图谱数据从 eelib 公共代理改为 partdata 签名接口；去掉了 eelib 专用的视图准备、模型清单、ZIP 下载授权等流程。
- 设计改为从 GitHub 固定提交导入并在浏览器解析（partdata 不提供工程文件下载）；GitHub 不可用时仍显示 partdata 的 BOM 和来源链接。
- 列表结果只有摘要，原型从不读取详情（参数、符号、封装都是空的）：现在选中时读取详情。
- CAD 预览原来按型号请求、改版后 404：现在按 partdata 的符号/封装名解析到 KiCad 官方库文件，用 eelib 预览引擎绘制（含派生符号、多单元符号），3D 用封装引用的官方 STEP。
- BOM 匹配原来一行一个请求：改为 10 行一批（配额省 10 倍）；"ST"、"TI" 等缩写先规范成 partdata 认识的厂商名，否则精确匹配会降成"需确认"。
- 知识图谱：按型号定位器件族时，族键比型号短（STM32F103C8T6 → STM32F103），原型的查找会静默退回全局图；已修复。图谱以族键而不是显示名关联设计。
- 设计列表翻页：partdata `offset ≤ 80`，原来每页 12 条会在第 8 页重复，改为每页 20 条。

**页面**
- 去掉原型自带的 "tindie / maker tools" 页头和页脚（tindie.com 已提供，iframe 内会重复）。
- Resources TAB 恢复为原页面：内容宽度改回 1200px，恢复登录用户的收藏状态（原型里总是未登录）。
- 统一字号（原型正文 8–12px）、按钮、卡片、标题带，与原 Discover 页一致；手机宽度下无横向滚动。

**稳定性**
- Service Worker：首次访问时会在加载后约 1 秒强制刷新整页（原线上版本也有），会吞掉访客刚做的点击或输入；现只在"更新版本"时刷新。
- GitHub 导入：扫描和导入两次请求在 Vercel 上可能落到不同实例，原型会随机报"导入已过期"；现凭据自带签名信息，任何实例都能重建。
- `package-lock.json` 指向 npmmirror 国内镜像，海外 CI / Vercel 安装会卡住；已改回 npmjs。
- 生产构建输出目录改回默认 `.next`（原型为预览沙箱改成 `.next-build`，会影响 Vercel 部署）。
- 规划器一次导入多个器件时，只要有一个没有封装就整体失败：现在跳过并列出未放置的器件。

---

## 7. 第二轮调整（按测试反馈）

**界面参照 eelib 已验证的实现**（保留 Tindie 的配色、字体和外框）
- 元器件 CAD 预览：采用 eelib `EcadPanel` 布局（符号 / 封装 / 3D 三格，每格下方是文件名和下载；管脚与焊盘按编号联动高亮；多单元符号可切换单元）。符号和封装支持**鼠标滚轮缩放、拖动平移**（缩放方式与 eelib 原理图查看器相同）。3D 用 eelib 的 `StepViewer`，固定在框内，不再显示"Solid model loaded…"。
- Open hardware：采用 eelib CircuitAtlas 布局（搜索框 + Designs / Circuit modules 两个视图），按 partdata 的**电路模块分类**浏览：顶层模块标签 + 子模块下拉；模块视图是分类树卡片。卡片样式同 eelib `DesignCard`。174 个模块名的英文对照在 `src/lib/partdata/modules.ts`。
- PCB planner 器件列表：每项显示型号 · 厂商、两行简介、封装和分类；**只列出有封装且封装在 KiCad 官方库里的器件**。

**设计列表规则**（元器件页"使用该器件的设计"、Open hardware、图谱里的设计都适用）
- **厂商参考设计**：可信，没有星数也全部显示，卡片上用金色标记"Reference design · 厂商名"。
  - 厂商名优先取 partdata 返回的 `vendor`（来自它的工程分类，如"TI 参考设计"），缩写自动展开为全称；没有时按来源网站识别（ti.com → Texas Instruments 等）。
  - 厂商设计只提供来源链接，不显示 BOM（partdata 的许可规则）。
- **开源工程**：只显示有完整工程文件、浏览器能打开的设计（KiCad、EAGLE、Altium、EasyEDA / JLCEDA），且至少 1 颗 GitHub 星。
- **标题图**：
  - 开源工程依次尝试三种：① partdata 记录的标题图（仓库自定义社交图或 README 首图）；② partdata 用工程 PCB 生成的预览图（`board.svg`，经本站签名转发）；③ 都没有时显示 "No preview"。
  - 厂商参考设计取厂商页面自己发布的预览图（`og:image`），只请求已知厂商网站、只走 HTTPS、缓存一天；没有时显示厂商名。
  - partdata 未打补丁时，设计列表里没有图片字段，每张卡片滚动到可见时再单独查询（服务端缓存）。

**CAD 格式**
- 解析引擎换成 eelib 最新版本（refir / canon-eda-ir **1.7.2**）。原型里带的是较旧的版本。
- 原理图按源文件绘制，用的是 eelib 的 `drawSchematics`：
  - KiCad：支持层次图，KiCad 5 的 `.sch` + `-cache.lib` 会自动转换（修复了只显示管脚、不显示符号的问题）。
  - Altium：带网络。
  - EAGLE：按源文件绘制。
  - EasyEDA / JLCEDA：原理图按解析结果显示，每个器件是一个带管脚的方框（解析器不提供符号原图）；PCB 和 3D 完整。
- 上传和 GitHub 导入处都列出了支持的格式。
- GitHub 导入只抓所选 PCB 工程的文件：原理图各页、PCB、工程文件、工程里引用的本地符号 / 封装库和 3D 模型、许可证。固件、文档、其他板子、备份和 Git 历史都不抓。新增识别 Altium（`.PrjPcb` 及其列出的文档）、EasyEDA 导出的 JSON、JLCEDA Pro（`.epro` 等）。
- `npm test` 新增两组检查：`cad-format-checks`（用 eelib 自带的测试工程跑 KiCad / EAGLE / Altium / EasyEDA / JLCEDA Pro 的解析和绘制），`github-format-checks`（各格式的工程识别）。

**需要 partdata 配合的部分**：`docs/partdata/0001-partner-filters.patch`
- 这是给 ezplm_partdata 的补丁（含测试），需要你审核后在 partdata 仓库应用并部署。内容：
  - `designs?function=<模块 id>`：按电路模块查设计，包含子模块。
  - `min_stars`、`eda`：在分页**之前**过滤，所以数量准确；只约束开源工程，厂商参考设计一律保留。
  - 厂商设计带 `vendor` 字段（厂商名）。
  - 设计列表带 `cover_image_url`、`board_preview`；新增签名接口 `GET /api/pub/v1/designs/{id}/board.svg`（PCB 预览图）。
  - 物料列表带上 `footprint`；加 `with_footprint=1` 时只返回有封装的物料。
- **没部署前页面也能用**：
  - 按模块浏览会退而用该模块最常用的器件族找设计，并标注"近似"。
  - 星数和格式在本站过滤：最多看每个条件的前 100 个设计。
  - 规划器读前 12 个结果的详情，判断有没有封装。
- **部署后**这些自动换成精确结果，不用改本站代码。
- 应用方法：在 ezplm_partdata 仓库运行 `git am 0001-partner-filters.patch`。
- partdata 现有测试里有一条（`openapi.json` 列出路由）在未打补丁的 main 上本来就失败，与本补丁无关。

### 知识图谱里的"可替代"关系

图谱除了"同板使用"（实线），还画出两种**替代候选**（虚线），右侧面板单独列在 "Could replace it · candidates"：

| 线型 | 含义 | 来源 |
| --- | --- | --- |
| 实线（青色） | Used together：出现在同一块板上 | partdata `neighborhood` |
| 长虚线（橙色） | Alternative candidate：partdata 的替代候选，附相似度与已比对项 | partdata `families/{f}/alternatives`（每族至少 10 个设计才有） |
| 点线（蓝紫） | Same-series candidate：同系列候选，例如 RP2040 → RP2350 | 同厂商（任一方未知时不排斥）、同类型、型号主干相同，且在 partdata 里属于同一个电路模块 |

- 只对图中前 8 个器件族查找；每族最多 3 个同系列候选，替代节点总数不超过 12。
- 两种替代都标为**未验证**：页面提示上线前要核对引脚、封装和固件，不会推断成"可直接替换"。

## 8. 已知限制 / 需要 partdata 侧配合

- **设计数量**：partdata 只发布"解析成功、至少 5 个可识别器件、有明确许可"的设计。器件族的使用次数（知识图谱）因此会大于可打开的设计数，页面上已说明。
- **数据手册**：partdata 不转发 ezPLM 内的 PDF，只告诉"有没有"；没有公开链接时页面显示 "Datasheet on file (not public)"。
- **族键拆分**：partdata 已知问题，`AMS1117-3.3` 的族键是 `AMS111733`，与 `AMS1117` 分成两个族（见 partdata `KNOWLEDGE_GRAPH.md`）。
- **非官方库的符号/封装**（例如来自厂商库或某个开源工程）不在 KiCad 官方库里时，预览会显示 "Not in the official KiCad library"。如需覆盖，partdata 可在详情里增加库文件下载链接（目前公开接口没有）。
- **GitHub 配额**：生产务必配置 `MAKER_GITHUB_TOKEN`。
- 进程内缓存与访客限流是每个实例各自一份（与原型相同）；访客总量由 partdata 的 `X-End-User` 限额兜底。流量大时可换成 Upstash Redis（项目已有依赖）。
