# Tindie Resources 系统 — 使用与开发说明文档

> 这份文档分三部分:**日常使用**(怎么用后台运营)、**运维**(密码、部署、备份)、**后期开发**(怎么改功能、接真实 AI)。
> 大部分操作给了可直接复制的命令。不需要工程背景也能照着做。

---

## 0. 这个系统是什么

一个部署在 Vercel 上的网站,分两个部分:

- **前台**(`你的域名.vercel.app`):面向公众。首页有「每日硬件发现」+「资源目录」+ 三张合作方推荐卡;另有 `/archive`(按日期看历史发现)、`/directory`(完整 50 条资源目录)。
- **后台**(`你的域名.vercel.app/admin`):需登录。运营在这里审核发现、管理资源目录、管理抓取来源、审核用户投稿。

数据存在 **Neon Postgres 数据库**里,所有用户看到的是同一份数据(不是各存各的)。

**技术栈**:Next.js 14 + Neon Postgres + Drizzle ORM + Auth.js(邮箱密码登录)+ Vercel Cron(定时任务)。

---

## 1. 日常使用(运营)

### 1.1 登录后台

1. 打开 `你的域名.vercel.app/admin`
2. 自动跳转到登录页,输入管理员邮箱和密码(初始是 seed 时设的 `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`)
3. 登录后进入控制台

### 1.2 后台五个模块

| 模块 | 作用 | 常用操作 |
|---|---|---|
| **Dashboard** | 看今日发布进度、待审数量、失效链接数 | 只看,不操作 |
| **Discovery Inbox** | 审核 AI/抓取来的「待审发现」 | 点 Review → 可改标题/摘要/「为什么重要」→ Approve 发布 或 Reject 丢弃 |
| **Resource Directory** | 管理 50 条资源目录 | 编辑资源信息;链接失效的点「Fix link」重新核验 |
| **Sources** | 管理抓取来源 | Pause(暂停)/ Resume(恢复)某个来源 |
| **Moderation** | 审核公众投稿的资源 | Approve(进目录,默认隐藏待完善)/ Reject |

### 1.3 「每日发现」是怎么来的

- 系统每天定时(UTC 05:00,即北京时间下午 1 点)自动跑一次「发现管线」,生成约 12 条候选,放进 **Discovery Inbox** 等你审核。
- **目前这些候选是示例数据(mock)**,不是真实抓取。要接真实数据源,见第 3 部分。
- 你在 Inbox 点 Approve,它才会发布到前台首页。每天目标 12 条。

### 1.4 前台公众能做什么

- 浏览发现、资源目录、按分类筛选
- **收藏**发现(需登录普通账号)、**评论**、**分享**
- **投稿资源**(「Suggest a resource」)→ 进入后台 Moderation 等审核
- **订阅**周报邮件(邮箱存进 `subscribers` 表)

---

## 2. 运维

### 2.1 ⚠️ 首先要做:重置泄露的密码

部署过程中,数据库密码和后台密码在截图里出现过,**务必重置**:

**重置数据库密码:**
1. 登录 [console.neon.tech](https://console.neon.tech) → 项目 `neon-celeste-village`
2. Settings / Roles → 找到 `neondb_owner` → Reset password
3. 拿到新连接串(`postgresql://neondb_owner:新密码@...`)
4. 去 Vercel → 项目 Settings → Environment Variables → 编辑 `APP_DATABASE_URL`,把密码换成新的(结尾保持 `?sslmode=require`)
5. Vercel → Deployments → 最近一次 → ⋯ → Redeploy

**重置后台登录密码:**
- 改 Vercel 里的 `SEED_ADMIN_PASSWORD`,然后重新跑一次 seed(见 2.4),或日后加「修改密码」功能。

### 2.2 环境变量清单

Vercel → 项目 → Settings → Environment Variables 里应有:

| 变量名 | 作用 | 谁提供 |
|---|---|---|
| `APP_DATABASE_URL` | 数据库连接(代码优先读这个) | 你手动加,Neon 连接串去掉 `channel_binding` |
| `DATABASE_URL` | 数据库连接(Neon 自动注入,带 channel_binding) | Neon 自动 |
| `AUTH_SECRET` | 登录加密密钥 | 你手动加(`openssl rand -base64 32` 生成) |
| `CRON_SECRET` | 保护定时任务接口 | 你手动加 |
| `SEED_ADMIN_EMAIL` | 初始管理员邮箱 | 你手动加 |
| `SEED_ADMIN_PASSWORD` | 初始管理员密码 | 你手动加 |

> **重要**:代码读取数据库连接的优先级是 `APP_DATABASE_URL` > `POSTGRES_URL` > `DATABASE_URL`。因为 Neon 自动注入的 `DATABASE_URL` 带 `channel_binding=require` 在 Vercel 运行时会连不上,所以我们用手动加的、干净的 `APP_DATABASE_URL` 来覆盖它。**改连接串时改 `APP_DATABASE_URL`。**

### 2.3 改了环境变量后必须重新部署

环境变量改完**不会自动生效**,要:
Vercel → Deployments → 最近一次 → ⋯ → **Redeploy**(弹窗里取消勾选 "Use existing Build Cache")。

### 2.4 重新灌数据 / 重置数据库

如果要清空重来或重新灌种子数据,在本地 `tindie-app` 目录:

```bash
# 把连接串作为环境变量临时传入(换成你的真实串,结尾 ?sslmode=require)
DATABASE_URL='postgresql://neondb_owner:新密码@ep-wispy-mud-atld4s08-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' npm run db:migrate

DATABASE_URL='同上' SEED_ADMIN_EMAIL='你的邮箱' SEED_ADMIN_PASSWORD='你的密码' npm run db:seed
```

- `db:migrate` = 建表(已建过则跳过)
- `db:seed` = 灌入 50 资源 + 7 来源 + 16 发现 + 管理员账号
- ⚠️ seed 会**追加**数据,不会先清空。要彻底重来,先去 Neon 控制台清空表,或找工程师加 reset 脚本。

### 2.5 查看线上报错

网站报错(白屏 / "server-side exception")时:
Vercel → 项目 → **Logs / Observability** → 看最新的红色错误行。
- `ECONNREFUSED 127.0.0.1` = 没读到数据库连接(检查 `APP_DATABASE_URL` 是否存在且重新部署过)
- 其他连接错误 = 连接串密码错 / SSL 问题

### 2.6 免费额度提醒

- **Neon 免费版**:有存储和计算时长限制,小规模够用。流量大了要升级。
- **Vercel 免费版(Hobby)**:个人/演示够用。商用需升级 Pro。
- 两者超额都会有邮件提醒,留意一下。

---

## 3. 后期开发

### 3.1 改代码的标准流程

所有代码改动都走这三步(在本地 `tindie-app` 目录):

```bash
git add .
git commit -m "简短描述改了什么"
git push
```

push 后 Vercel 自动重新部署。等几十秒,Deployments 显示 Ready 即生效。

> push 时若要账号:用户名 `eehubio`,密码处填 GitHub Personal Access Token(`ghp_` 开头那串)。

### 3.2 本地开发预览

改代码前先在本地跑起来看效果:

```bash
cd tindie-app
npm install                              # 第一次或换了依赖时
vercel env pull .env                     # 拉取环境变量(敏感值可能为空,需手动补 .env)
npm run dev                              # 启动本地服务器
```

打开 `http://localhost:3000` 看前台,`/admin` 看后台。改代码会自动热刷新。

> 注意:`vercel env pull` 拉敏感变量(如数据库串)时只给变量名不给值,需在本地 `.env` 手动填上真实的 `APP_DATABASE_URL`、`AUTH_SECRET` 等。

### 3.3 工程结构速查

```
tindie-app/
├── src/
│   ├── app/                    # 页面和接口
│   │   ├── page.tsx            # 前台首页
│   │   ├── archive/            # 每日发现归档页
│   │   ├── directory/          # 完整资源目录页
│   │   ├── admin/              # 后台控制台页
│   │   ├── login/              # 登录页
│   │   └── api/                # 后端接口(见下)
│   ├── components/             # 界面组件
│   │   ├── Chrome.tsx          # 顶部导航 + 页脚(真实 Tindie 风格)
│   │   ├── Discovery.tsx       # 发现卡片 + 详情抽屉
│   │   ├── HomeSections.tsx    # 首页的 Featured 卡 / Browse 卡 / 本周精选
│   │   ├── AdminConsole.tsx    # 后台控制台全部界面
│   │   ├── PublicWidgets.tsx   # 订阅框 / 投稿框
│   │   └── BrandLogo.tsx       # 品牌 logo 占位组件
│   ├── lib/
│   │   ├── taxonomy.ts         # 8 大分类、颜色、关联产品等常量
│   │   ├── seed-data.ts        # 种子数据(50 资源 / 来源 / 发现)
│   │   ├── queries.ts          # 所有数据库读写逻辑
│   │   ├── pipeline.ts         # 每日发现管线(目前 mock)
│   │   ├── auth.ts             # 登录配置
│   │   ├── auth.config.ts      # 登录基础配置(边缘安全)
│   │   └── auth.edge.ts        # 中间件用的登录实例
│   ├── db/
│   │   ├── schema.ts           # 数据库表结构定义
│   │   └── index.ts            # 数据库连接
│   └── middleware.ts           # 保护 /admin,未登录跳转
├── scripts/
│   ├── migrate.ts              # 建表脚本
│   └── seed.ts                 # 灌数据脚本
├── drizzle/                    # 自动生成的建表 SQL
├── package.json                # 依赖和命令
└── vercel.json                 # 定时任务配置
```

### 3.4 接口一览

| 接口 | 作用 | 权限 |
|---|---|---|
| `/api/discoveries/save` | 收藏/取消收藏发现 | 需登录 |
| `/api/discoveries/comment` | 发评论 | 任意 |
| `/api/discoveries/[id]/comments` | 读某发现的评论 | 任意 |
| `/api/submit` | 公众投稿资源 | 任意 |
| `/api/subscribe` | 订阅周报 | 任意 |
| `/api/admin/discovery` | 审核发现(批准/拒绝/编辑) | 仅 editor/admin |
| `/api/admin/source` | 暂停/恢复来源 | 仅 editor/admin |
| `/api/admin/resource` | 核验/编辑资源 | 仅 editor/admin |
| `/api/admin/submission` | 审核投稿 | 仅 editor/admin |
| `/api/cron/discover` | 触发每日发现管线 | 需 CRON_SECRET |
| `/api/auth/[...nextauth]` | 登录认证 | — |

### 3.5 数据库表

`users`(用户,含角色)、`accounts`/`sessions`/`verification_tokens`(登录用)、`resources`(资源目录)、`sources`(抓取来源)、`discoveries`(每日发现)、`submissions`(投稿)、`comments`(评论)、`saves`(收藏)、`subscribers`(订阅)。

改表结构的流程:改 `src/db/schema.ts` → 跑 `npm run db:generate` 生成迁移 SQL → 跑 `npm run db:migrate` 应用到数据库。

### 3.6 ⭐ 重点:把「每日发现」接成真实的

现在每日发现是示例数据。要接真实抓取 + AI 摘要,改 `src/lib/pipeline.ts` 里两个标了注释的函数(签名不要改,只改函数体):

**接入点 1 — `fetchCandidates()`**:
现在是从一个示例池随机取。改成真实抓取——从 GitHub / Crowd Supply / 厂商 RSS 等拉取新品。
- 注意各数据源的使用条款(ToS),图片只用有授权的(OG/press/repo)。

**接入点 2 — `summarize()`**:
现在返回固定文案。改成调用 Claude API,生成**原创**的「是什么」+「为什么对 Tindie 重要」。
- 文件里有注释掉的示例代码(用 `claude-haiku-4-5` 模型)。
- 需要在 Vercel 加环境变量 `ANTHROPIC_API_KEY`(你的 Claude API 密钥)。
- 提示词要求模型**原创改写**,不要照抄原文(版权)。

改完这两个函数,其余链路(审核、归档、前台展示)都不用动——抓来的内容会自动进 Inbox 等你审核。

### 3.7 调整每日发现数量

改 `src/lib/taxonomy.ts` 里的 `DAILY_TARGET`(现在是 12)。前台标题、后台配额会一起跟着变。

### 3.8 换真实品牌 logo

现在资源用首字母色块占位。两种方式换真 logo:
1. 把图标文件放进 `public/logos/`,然后在数据库 `resources.logo` 字段填路径(如 `/logos/kicad.png`)
2. `BrandLogo` 组件会自动:有 `logo` 就显示图片,没有就显示色块。代码不用改。

### 3.9 给别人开后台权限

数据库 `users` 表里,把某用户的 `role` 字段改成 `editor` 或 `admin`,他就能进 `/admin`。普通用户是 `user`。可在 Neon 控制台直接改,或日后加用户管理界面。

---

## 4. 常见问题速查

| 现象 | 原因 | 解决 |
|---|---|---|
| 网站白屏 / server-side exception | 数据库连不上 | 看 Logs;检查 `APP_DATABASE_URL` 存在且重新部署过 |
| `ECONNREFUSED 127.0.0.1` | 没读到连接串,用了占位 | 确认 `APP_DATABASE_URL` 已加且作用于 Production,Redeploy |
| 前台没数据 | 没灌种子数据 | 跑 `npm run db:seed`(见 2.4) |
| 改了代码没生效 | 没 push 或没部署 | `git push`,等 Vercel 自动部署 |
| 改了环境变量没生效 | 没重新部署 | Deployments → Redeploy(不用缓存) |
| `npm install` 报 ECONNRESET | 网络问题 | 换国内镜像:`npm config set registry https://registry.npmmirror.com` |
| push 报认证失败 | GitHub 不收密码 | 密码处填 Personal Access Token(`ghp_` 开头) |

---

## 5. 重要链接

- **GitHub 仓库**:github.com/eehubio/Tindie_resource
- **Vercel 项目**:vercel.com → maker_rsource
- **Neon 数据库**:console.neon.tech → neon-celeste-village
- **线上网站**:你的 `.vercel.app` 域名
- **后台**:线上域名 + `/admin`

---

*本系统当前状态:前后台完整可用,数据库已接入,登录可用。每日发现管线为示例数据(mock),接真实数据源见 3.6。*

