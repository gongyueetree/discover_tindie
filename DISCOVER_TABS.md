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
- 应用方法：在 ezplm_partdata 仓库依次运行 `git am 0001-partner-filters.patch`、`git am 0002-ezplm-cad-files.patch`（第二个见 §9）。
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
- **非官方库的符号/封装**：KiCad 官方库没有、ezPLM 自建库有的，打上 0002 补丁后从 ezPLM 库加载（§9）；两边都没有时显示 "Not in the official KiCad library or ezPLM's library"。
- **GitHub 配额**：生产务必配置 `MAKER_GITHUB_TOKEN`。
- 进程内缓存与访客限流是每个实例各自一份（与原型相同）；访客总量由 partdata 的 `X-End-User` 限额兜底（每次访客操作只记 1 次，见 §9）。流量大时可换成 Upstash Redis（项目已有依赖）。

## 9. 第四轮调整（按测试反馈）

- **访客额度只按"查询"计**：partdata 对每个带 `X-End-User` 的调用都记访客次数，原来打开一次图谱就要扇出 20～40 个调用，
  每张设计卡片取图也各算一次，所以一天 300 次很快用完。现在访客在本站的一次操作（一次搜索、打开一次图谱、一次 BOM 匹配……）
  只把第一个上游调用记到访客头上，其余只计入合作方密钥的每天总数（默认 20000，可在 partdata 后台调高）；
  卡片图片、项目简介这类页面自己加载的请求完全不记访客。缓存命中（10 分钟）本来就不调用 partdata。
- **ezPLM 自建库**（需要 `docs/partdata/0002-ezplm-cad-files.patch`）：partdata 新增签名接口
  `GET /api/pub/v1/parts/{id}/cad/{symbol|footprint|model}`，物料详情带 `ezplm_library` 表示 ezPLM 库里有哪些文件。
  本站在 KiCad 官方库没有时改用 ezPLM 的符号 / 封装 / 3D：元器件页预览与下载、PCB planner 的器件列表和封装都适用，标注 "ezPLM:名称"。
  文件经本站转发（`/api/maker/cad/{id}/{kind}`），浏览器拿不到 partdata 的地址和密钥。
- **常用器件图谱**：Open hardware 选了电路模块后，子模块选择框右侧有 "Common parts"，弹出只针对该模块（含子模块）的图谱，
  顶部列出最常用的器件族及其在该模块设计里的占比。数据来自 partdata `rankings/functions/{id}/families`。
- **没有标题图的项目**：列表没有图时，读该仓库（或设计所在子目录）的 README，取第一张不是徽章的图片；再没有用 PCB 预览图。
- **项目简介**：项目详情页显示 README 开头的一两段（纯文本，最多约 700 字符），并链接完整 README。README 每个仓库每天只取一次。
- **链接可点**：卡片和详情里的描述中的网址可以直接点开（新标签页）。
- **BOM 匹配状态**：用图标代替文字——✓ 已匹配 MPN，! 有候选待确认，? 未匹配；鼠标悬停有说明。
- **刷新供应商价格**：现在会显示进度和结果，例如"找到 0/2 行的实时价格；DigiKey、Mouser 未在本站连接"。
  实时价格需要在 Vercel 配置 `DIGIKEY_CLIENT_ID` / `DIGIKEY_CLIENT_SECRET` / `DIGIKEY_ENV=production` 或 `MOUSER_API_KEY`；
  它们的每日额度用完时也会明确提示。和 partdata 的访客额度无关。
- **PCB 点器件不再移动**：右侧面板宽度固定，选中器件时画布尺寸不变。
- **图谱线型图例**：修复图例的小图标被画布样式撑大的问题。

## 10. 第五轮调整

- **原理图符号按型号匹配**：数据库没有记录符号时，在 KiCad 官方库里按型号找，支持 KiCad 用小写 x 表示变体位的命名（STM32F103CBT6 → `MCU_ST_STM32F1:STM32F103CBTx`），并允许最多 3 位包装后缀（…TR）。页面注明“按型号匹配，请对照数据手册核对引脚”。不跨封装后缀借用符号（LM358DR 不会用 LM358，以免引脚号不同）。
- **按器件族关联**：图谱用与 partdata 知识图谱相同的族规则（`familyOf`，同 `kg.family_of`）定位器件族，STM32F103CBT6 → STM32F103；不会再落到名字相近的板卡（STM32F103C8T6_BLUE_PILL）。
- **标题图兜底**：README 图片、PCB 预览都没有时，用 GitHub 仓库的社交预览图（仓库自设的图，否则 GitHub 生成的卡片）。
- **厂商发布的开源设计**：仓库属于厂商自己的 GitHub 组织（TexasInstruments、NordicSemiconductor、STMicroelectronics、AnalogDevicesInc、NXP、Microchip、Espressif、Raspberry Pi、Infineon、Renesas、Silicon Labs 等）时，卡片和详情标“Manufacturer design · 厂商名”。
- **PCB Planner**（板形与定位孔几何取自 eelib `lib/protopcb/outline.ts`、`holes.ts`，见 `src/vendor/eelib/protopcb/`）：
  - 板形：矩形 / 圆角（半径可调）/ 圆形 / L 形；器件只能放在真实板框内（圆角、圆、L 形缺口都检查）。
  - 定位孔：开关、孔中心到板边距离、孔径（1–8 mm）可调，按 eelib 规则贴合板形（圆形板无四角孔）。
  - 清空板上器件、重新排布未锁定器件、撤销 / 重做（按钮或 Ctrl+Z / Ctrl+Shift+Z；拖动一次算一步）。
  - 导出 KiCad 的板框圆角与孔径和画面一致，3D 预览随之变化。

## 11. 上线前只给自己看（预览开关）

新三个 TAB（Components / Open hardware / PCB planner）默认**只有你能看到**，其他访客看到的还是原来的 Discover 页面（没有 TAB 栏）；新 TAB 的页面会跳回首页，接口返回 404。

- **谁能看到**：登录了后台的管理员 / 编辑（用原来的后台账号登录即可）；或在浏览器打开过 `/tools/preview?key=<MAKER_PREVIEW_KEY>` 的人（写入 30 天的 Cookie，可发给同事测试）。
- **全部上线**：在 Vercel 加环境变量 `MAKER_TOOLS_PUBLIC=1` 并 Redeploy；想收回就删掉它再 Redeploy。
- `MAKER_PREVIEW_KEY` 至少 16 个字符，可用 `openssl rand -hex 16` 生成。
- 在 tindie.com 的 iframe 里，浏览器可能拦截第三方 Cookie，预览时请直接打开站点域名测试。

## 12. 第六轮调整

- **PCB planner 版面**：右栏收窄到 230px；控制条压成三行——视图 / 间距 / 撤销·重做 / 重新排布·清空（图标按钮，悬停有说明）/ 全屏；尺寸·形状·网格；安装孔。左栏去掉 KiCad 许可说明。
- **全屏画布**：画布右上角的全屏按钮把画布和控制条铺满窗口，再点或按 Esc 收回。用页面内铺满而不是浏览器 Fullscreen API，嵌在 tindie.com 的 iframe 里也能用。
- **离开确认**：板上有零件且未保存时，点站内链接（含四个 Tab）弹出「留下 / 不保存离开 / 保存并离开」，保存即下载 layout.json；关闭或刷新页面时由浏览器弹出它自己的确认框（浏览器不允许自定义）。`src/components/maker/LeaveGuard.tsx`。
- **搜索状态**：搜索进行中显示「Searching…」和占位卡片，只有确实没有结果时才显示「No matches」。
- **参考设计预览**：列表里带的图片加载失败时，卡片会再向服务器要 README 图片 / PCB 预览，最后用 GitHub 仓库的社交卡片；GitHub 查询失败（限额、故障）不再被当作「没有图片」缓存一天，只缓存 10 分钟。
- **知识图谱**：点击任一节点，右侧在标题下显示该器件的简介（零件库里的描述；本型号没有时用同族型号的描述并注明）。
- **「The parts database is unavailable right now」误报**：MPN variants 只看零件库本身的状态，DigiKey / Mouser 未配置不再被当作零件库不可用。

## 13. 加载速度与第七轮

**为什么慢（参考设计列表）**：一个电路模块的设计列表，Tindie 服务端要向 partdata 取最多 5 页（partdata 每页最多 20 条），原来是一页一页串行；而 partdata 每取一页都把整个结果（最多 2000 个设计）重算一遍再切出 20 条。另外 partdata 只跑一个 uvicorn 进程，Partner API 的处理函数是 `async def` 却做同步数据库查询，所有请求（列表、搜索、每张卡片的封面 / PCB 预览）排队一个个处理。

- Tindie：第一页之后其余几页并行取（`designPool`）。
- Tindie：与访客无关的浏览数据（模块树、按模块/族的设计列表、单个设计、单个零件、知识图谱排行、供应商连接状态、发现条目的工程链接）让 Vercel CDN 缓存 5 分钟（过期后一天内先给旧的再后台刷新）；按型号/关键字的搜索不缓存，仍按访客计次。预览开关的中间件在 CDN 之前执行，不受影响。
- partdata（ezplm_partdata `perf/partner-api`）：Partner API 处理函数改为普通 `def`（FastAPI 放进线程池并发执行）；`/designs` 同一筛选条件的计算结果缓存 5 分钟，后续翻页直接切片；Postgres 上为型号前缀搜索在后台建 `varchar_pattern_ops` 索引（`CONCURRENTLY`，不锁表）。

**刷新供应商价格**：本站没配 DigiKey / Mouser 时，按钮置灰并直接说明「DigiKey 和 Mouser 未接入，可手动填单价」，不再点了像没反应。接入需要 Vercel 环境变量 `DIGIKEY_CLIENT_ID`、`DIGIKEY_CLIENT_SECRET`、`DIGIKEY_ENV=production` 和/或 `MOUSER_API_KEY`。表格里「Unpriced」和「No live price found.」分两行显示。

**Today's Hardware Discoveries → View design files**：卡片出现在屏幕上时，服务端按发现条目 id 查它的来源：本身是 GitHub 仓库就用它，否则读文章页面里链接的 GitHub 仓库（按出现顺序最多查 3 个），只有仓库里有查看器能打开的工程文件（非 LFS 占位）才在卡片和详情抽屉里显示「View design files」。点击直接弹出 Open hardware 的在线查看器，自动扫描该仓库并打开推荐的工程。结果按条目缓存一天。只对能看到新 Tab 的访客显示。目前只支持 GitHub（查看器的导入只支持 GitHub）。

## 14. KiCad 导出：板子放在图纸中间

用 KiCad 10.0.1（官方 kicad/kicad 镜像，命令行 + 图形界面）实测：导出文件能正常打开（含 ezPLM 自建库的旧格式封装），只提示「旧版本文件，保存时转换」。macOS 上「一直转」多半是 KiCad 首次启动向导或系统权限对话框藏在主窗口后面。
导出时板子原点原来在 (0,0)，会压在 A4 图框左上角；现在整体平移到图纸中间（`shiftBoard` / `pageOffset`，整毫米，离图纸边至少 10 mm），封装内部坐标不动。

## 15. 第八轮：3D 预览位置、EasyEDA 工程

- **3D 预览跑到右下角**：上一轮为 KiCad 文件把板子平移到图纸中间，3D 预览用的是同一份导出，于是也被平移了。现在只有下载的 KiCad 文件居中（`plannerPcb(doc, { onSheet: true })`），页面内 3D 仍以板子原点取景。
- **EasyEDA（标准版）原理图**：eelib 没有 EasyEDA 绘图器，之前只能画出方框。新增 `src/lib/maker/easyeda-schematic.ts`，直接按 EasyEDA JSON 的图元（元件图形、引脚名/号、导线、结点、网络标识/端口、分区框、文字、图框）输出与 KiCad/EAGLE 相同的绘图数据；多页工程导出（docType 5）每页一张。
- **BOM 没有型号**：EasyEDA 元件属性是 key`value`key`value 交替写法，解析器只认 key=value，导致 Manufacturer / Manufacturer Part 全丢。已修正（`canon/lib/eda/easyeda.ts`），BOM 能显示 MPN。
- **打开设计时选错文件夹**：同一目录下有多个工程（如 hardware/pcb 下的 distro-v2 和 distro-v3.1）时，以前直接取第一个；现在优先选与设计名称末尾（「sesame-robot - distro-v3.1」）同名的文件夹。

## 16. EasyEDA 工程的 3D

EasyEDA（标准版）板子在 3D 里原来只有一块绿板：解析器保留 EasyEDA 原始单位（10 mil，却标成 mm）和层名（TopLayer / BottomLayer / Multi-Layer），3D 只认 KiCad 层名，焊盘全被跳过；EasyEDA 的 3D 模型按 EasyEDA 库 ID 引用、托管在 EasyEDA 服务器上，工程文件里没有。
现在（`src/lib/maker/easyeda-3d.ts`）3D 拿到换算成毫米、层名改成 KiCad 的副本，焊盘正常显示；每个元件文件里的 `outline3D` 节点给出模型在板上的占位，据此画灰色外形体，高度取自模型名（…-H0.8、D8.0-H8.0），没写的按封装类型取常见高度。状态栏注明这是近似外形。真实 EasyEDA 模型需要服务器去 EasyEDA 取，本环境连不上，未做。

## 17. EasyEDA 真实 3D 模型；同仓库多块板子的卡片

- **EasyEDA 3D 模型**：工程里每个元件的 `outline3D` 节点带 EasyEDA 模型 ID。新增 `/api/maker/easyeda-model/{uuid}` 由服务端转发 EasyEDA 自己的模型（`modules.easyeda.com/3dmodel/{uuid}`，OBJ，毫米；浏览器跨域取不到），CDN 缓存 30 天，不计访客查询。浏览器解析 OBJ（内嵌材质颜色），按 EasyEDA / easyeda2kicad 的放置规则：以 3D 外形中心为准，底面贴板面再加 `z` 偏移，`c_rotation` 旋转（Z 向取与外形尺寸吻合的方向）。模型尺寸与外形差 3 倍以上视为不符，保留灰色外形体。同一模型只取一次。状态栏写明加载了几个、其余是近似外形。本环境连不上 EasyEDA，真实模型的效果需在预览/线上确认；机制用模拟 OBJ 测过。
- **同一仓库里的多块板子**（如 greatscottgadgets/hackrf 的 hackrf-one 与 operacake）：卡片注明「In 仓库 · 文件夹」；图片先找仓库里以文件夹命名的图片（`docs/images/operacake.jpeg`，照片优先于框图），找不到再用仓库的图。

## 18. 一个仓库里有多个工程时默认选哪个；KiCad 10

- mlab-modules/STM32TQ6401 的 `doc/gen/STM32TQ6401.brd` 不是 EAGLE 板，而是另一种工具导出的 BRDOUT 文本（板框 + 网表），却排在第一个被默认选中，导入后提示「不支持」。现在排序优先真正的设计：有 `.kicad_pro`、原理图 + PCB 齐全的工程在前，`doc / gen / output / fab / gerber / production` 等输出目录里的放最后；分数相同时目录层级浅的（主板）在前。
- 实测 KiCad 10 格式（版本 2026xxxx）的板子能正常解析，提示文字和「Supported CAD formats」改为 KiCad 5–10；解析失败时提示 .brd 不一定是 EAGLE，可换列表里的其他工程。

## 19. 同一块板子的重复记录

零件库里 hackrf-one 有两条记录：一条从仓库文件夹 `hardware/hackrf-one` 导入（许可 CERN-OHL-P，取自硬件文件夹），另一条来自引用整个仓库的项目页面（标题「Opera Cake: DOPPLER DIRECTION FINDING…」，BOM 取到的仍是 hackrf-one 的 99 个零件，许可是仓库的软件许可 GPL-2.0）。图片、零件数、星数相同，许可不同。
`dedupeDesigns`（`src/lib/partdata/maker.ts`）：同一仓库、零件数和 EDA 工具都相同的开源设计视为同一份文件，只保留最具体的一条（文件夹名与设计名一致 > 有文件夹 > 星数多）。根源在零件库导入时没有按 BOM 去重，需要在 ezplm_partdata 侧清理。

## 20. 每日 AI 推荐开源设计（Open hardware → Fresh open hardware）

每天由大模型从后台管理的信息源里挑出值得推荐的开源参考设计，放在 Open hardware TAB 顶部，附简介，可直接在线查看工程文件，也可跳到 Resources 看详情。

**流程**（`src/lib/design-picks.ts`，Vercel Cron `/api/cron/design-picks`，每天 05:40 UTC，在 05:00 的每日发现之后）：

1. **候选**：最近 10 天已发布的每日发现（来自 /admin → Sources 里管理的信息源）中，能找到 GitHub 工程的（与「View design files」同一套判断：源链接本身是仓库，或文章里链接的仓库）；配了 `MAKER_GITHUB_TOKEN` 时，再加上 GitHub 近 7 天新建、带 kicad / open-hardware / pcb / easyeda 话题的仓库。只保留查看器能打开的（有支持的原理图 / PCB、不是 Git LFS 指针），且以前没评过的。
2. **事实取自 GitHub**：许可（GitHub 识别的 SPDX）、星数、创建 / 最近提交日期、README（设计文件夹优先）、工程文件列表。这些字段不由大模型生成。
3. **Claude 审阅**（默认 `claude-opus-5-5`，结构化输出，`DESIGN_PICKS_MODEL` 可改）：读文章 + README + 文件列表，判断是否推荐、打分，写标题、2–3 句简介、要点、注意事项（如「作者称尚未制板」「PCB 还没走线」「3D 模型另有许可」——只写来源里说了的）。文章和 README 作为不可信数据传入，提示词明确忽略其中的指令。
4. **发布**：推荐且分数 ≥ 60 的前 `DESIGN_PICKS_PER_DAY`（默认 3）个。只从 GitHub 找到、没有文章的设计，同时生成一篇 Resources 文章（来源 GitHub），保证「Read more」有处可去。没选上的记为 rejected，以后不再重复评（不重复花费）。

**页面**：Open hardware 顶部「Fresh open hardware」卡片（近两周，默认显示 3 个，可展开）：日期、许可、EDA 格式、星数、简介、要点、注意事项；「View design files」直接在查看器里打开该仓库/文件夹；「Read more」跳到 Resources 并打开该文章（新增 `/?d=<文章 id>` 深链接）；GitHub 图标打开仓库。卡片下注明摘要由 AI 撰写、未人工核对、Tindie 未制板验证。

**后台**：/admin → 🧩 Design Picks：近 30 天的推荐和被拒的设计（含分数、简介、注意事项），可隐藏 / 恢复，也可「Run today's selection now」立即跑一次（几分钟内完成）。

**数据表**：`design_picks`（`drizzle/0003_design_picks.sql`）。第一次使用时自动创建（`CREATE TABLE IF NOT EXISTS`），不需要手动迁移。

**环境变量**：需要 `ANTHROPIC_API_KEY`（每日发现已在用）和 `CRON_SECRET`；未配 `ANTHROPIC_API_KEY` 时什么都不写，不会生成没有依据的简介。建议配 `MAKER_GITHUB_TOKEN`（GitHub 搜索新仓库需要它）。费用：每天最多评 `DESIGN_PICKS_MAX_JUDGED`（默认 10）个候选，每个一次调用。

**验证**：本环境连不上 GitHub 和 Claude API，整条流程用本地 Postgres + 模拟 GitHub + 模拟 Claude API 跑通（`scripts/design-picks-checks.ts` 覆盖纯逻辑）；真实效果需在预览上用后台按钮跑一次确认。

补充：零件库还不支持按电路模块筛选时，模块列表由该模块最常见的几个器件族的设计拼成，原来只在每个器件族内部去重；同一块板子的两条记录分别从两个器件族进来时（hackrf-one 与 Opera Cake 那条），合并后的列表仍会出现两次。现在拼好之后再整体去重一次。

## 21. 上线前审计（2026-11-04）的修复

对照 GPT 的审计报告逐条核实代码后修复（`scripts/prelaunch-audit-checks.ts`，全部用模拟上游验证）：

| 编号 | 核实结果 | 修复 |
|---|---|---|
| A01 旧导入接口读私有仓库 | 属实（配了能读私有库的 `GITHUB_TOKEN` 时） | 旧卖家导入（`/seller/import-project`、`/api/project-import/*`）默认关闭，`PROJECT_IMPORT_ENABLED=1` 才开放；开放时公开模式也不列出私有仓库，用全站 token 读到私有仓库立即拒绝（不再读 README / 文件树）。Open hardware 的 GitHub 导入（`/api/maker/github/*`）本来就只收公开仓库，不受影响 |
| A02 安装回调未验证归属 | 属实 | 回调用 GitHub 返回的 `code` 换用户 token，确认该用户能访问这个 installation 才连接；没有 `code` 或未配 OAuth 一律拒绝（需在 GitHub App 上开启安装时请求用户授权） |
| A03 限流 | 属实 | 新的 `src/lib/maker/limits.ts`：配了 Upstash Redis 时跨实例共享计数，否则按实例；数据手册、器件库、3D 模型路由也纳入（每分钟 240 次，一块板要加载很多模型） |
| A04 BOM 放大 | 属实 | partdata 返回 429（访客额度用完）时不再改查分销商；同一请求里相同型号只查一次；分销商回落有 35 秒总时限 |
| A05 缓存 | 属实 | 分销商结果共享缓存（Redis + 内存，默认 1 小时，只缓存成功结果），同时到达的相同查询合并成一次；每次真实调用前预留全站 / 访客每日额度（Redis 出错时拒绝付费调用）；收到 429 后该分销商冷却 |
| A06 翻译费用 | 部分属实（只翻中文） | 翻译单独限流（每分钟 20 次）、单条 ≤500 字、按字符预留每日额度，超出时用术语表翻译；旧 AI 分析随旧导入关闭 |
| A07 大文件 | 属实 | 数据手册、KiCad 3D 模型改为流式转发（带字节上限，不整体读入内存）；GitHub 导入的 ZIP 分块发送。**4.5 MB 以上的文件需在 Vercel 预览上实测** |
| A08 长任务 | 属实 | GitHub 导入整体 45 秒期限；BOM 分销商回落 35 秒期限 |
| A09 旧 URL 导入重定向 | 代码属实 | 随旧导入默认关闭 |
| A11 | 属实 | 连接 Cookie 没有签名密钥时一律拒绝；`db:seed` 不再有默认管理员密码、不打印密码，`reset-admin` 不打印密码；后台页和 `/api/admin/partdata` 在服务端再查权限，且角色从数据库实时读取（撤销编辑权限立即生效）；生产环境缺 `MAKER_IMPORT_SECRET` / `AUTH_SECRET` 时 GitHub 导入直接报未配置 |

**未在本轮处理（需要单独安排）**：A10 Next.js 14 → 受支持版本的升级（牵涉 React / Auth.js，需完整回归）；A12 CAD 解析移到 Worker；匿名会话令牌 + 人机验证；partdata 侧按操作计量。

**上线前需要在 Vercel 确认**：配置 Upstash Redis（否则限额只按实例）；`DIGIKEY_DAILY_BUDGET` / `MOUSER_DAILY_BUDGET` 按实际配额设置；若用过 `db:seed` 的默认密码 `changeme123`，修改该账号密码；`PROJECT_IMPORT_ENABLED` 保持不设。
