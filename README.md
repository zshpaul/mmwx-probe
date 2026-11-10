# MMWX Probe

妙妙屋 X（MiaoMiaoWuX）的独立服务器探针前端。项目将 React 静态页面、只读 API 代理和 WebSocket 代理部署到同一个 Cloudflare Worker，访客只接触探针域名，无需直接访问主控域名。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mmwx-group/mmwx-probe)

## 功能

- 卡片和列表两种服务器视图
- CPU、内存、硬盘、流量及实时网速
- CPU、内存、磁盘、网速与连接数的 1H / 6H / 12H / 24H 趋势图
- WebSocket 实时更新，断线后自动回退到 HTTP 轮询
- 基于 Emerald 的 React 页面，支持浅色 / 深色 / 跟随系统及手机 / 桌面布局
- 节点名称、地区和系统搜索，列表排序，独立详情页与图表悬停提示
- Worker Secret 保护主控探针接口，浏览器无法读取访问密钥

## 工作方式

```text
浏览器 ──HTTPS/WS──> Cloudflare Worker ──携带 PROBE_TOKEN──> 妙妙屋 X 主控
```

Worker 仅代理三个固定路径，不接受访客指定上游地址，因此不会形成开放代理：

| 对外路径 | 主控路径 | 用途 |
| --- | --- | --- |
| `/api/probe` | `/api/public/probe-servers` | 服务器状态 |
| `/api/series` | `/api/public/probe-series` | 24 小时延迟、丢包率及系统指标历史；追加 `metric=system` 获取 CPU、内存、网速和累计流量序列 |
| `/api/stream` | `/api/public/probe-ws` | 实时 WebSocket |

服务器列表中的每个 `servers[]` 对象还会返回当前计费周期的 `daily_traffic`，元素包含 `date`、`uplink`、`downlink` 和 `total`（字节）。周期汇总字段包括 `traffic_used_up`、`traffic_used_down`、`traffic_used_total`，周期边界为 `period_start`（含）和 `period_end`（不含）。兼容字段 `traffic_used` 仍表示按主控服务器统计模式计算的计费用量。

### Emerald 展示约定

视觉取值来自 `Tokinx/cf-server-monitor-theme-emerald` 的固定提交 `c80591198df4d2a0332b86b41e53e42fd341ed99`，对应 `CF-Server-Monitor` 提交 `612027cbdb248bc2df7e69f9d01b5cefb4d14fa8`。仅翻译前端，不接入对方后端、品牌、个人内容或第三方访客定位服务。

- `styles/main.css`：沿用前景色、灰度、字体和 `--radius: .625rem`；`rounded-md` 换算为 8px。
- `Background.vue`：1300 × 400px 的 emerald-500 → lime-300 渐变、40% 透明度、顶部径向蒙版、72 × 56px 倾斜网格。
- `Header.vue` / `NodeCard.vue`：1280px 最大宽度、16px 水平内边距、56px 导航、12px 卡片间距、300px 最小卡宽、60% 白底、12px 指标文字和 11px 辅助文字。
- `InstanceDetail.vue` / `LoadChart.vue`：价格四卡、2 列信息区、3 列图表、192px 绘图区；采用原图表珊瑚红、青绿、天蓝和紫色。
- `utils/helper.ts`：字节与速率按 1024 换算，沿用 B / KB / MB / GB / TB / PB 标签，B 和 KB 为整数，MB 及以上保留一位小数。

唯一视觉标准为 `https://ran.haru2s.com/#/`。首页默认显示总览六格、可拖动的地区地球、节点三网摘要及延迟/丢包两条采样条；列表保留三网入口，卡片采样条打开延迟历史弹窗，详情显示延迟历史与系统图表。只提供 Emerald 一套外观；右上角切换浅色 → 深色 → 自动。左上角与浏览器标签页显示 ZSH，图标不变。页面不渲染 passkey 登录入口，因此不能从本页发起 passkey 认证并跳转主控后台；组件、两个 POST 端点及 Worker 保留，直接访问主控的登录方式不受影响。

- 三网值复用 `tri_isp` 配置与 `ping[].isp` 映射，不拿任意三个目标冒充运营商；缺失运营商显示 `—`。
- 两条采样条遵循 Emerald `useNodePingDisplay` 的等高色块语义：上报目标同槽位均值，再按顺序分成最多十段，颜色表示段内平均延迟/丢包；摘要为有效采样均值。延迟阈值为 60/120/180/240 ms，丢包阈值为 1/3/6/9%。100% 丢包不当作有效延迟，缺测保留灰色；`buckets` 没有时刻，tooltip 只标采样序号，不编造“一小时”或时间戳。
- 延迟历史使用 `/api/series` 的 `all_series`、`generated_at`、`bucket_sec`、`buckets`；提供范围切换、目标全选/全不选、延迟/丢包开关和 tooltip。平滑采用 EWMA α=0.3，保留缺测断点，不补造原始样本；关闭即可查看原始值。
- 总览资源/速率只汇总在线有效上报值，累计流量使用 `cumulative_up/down`；没有累计计数时明确显示“计费流量”，按各节点自身计费周期合计。剩余价值从价格/周期/到期时间推导，缺项排除；价值弹窗按币种分别汇总，不请求或假造汇率。
- 地球使用国家级地理示意位置并显示实际地区聚合速率；可自动旋转、拖动和键盘旋转，尊重减少动画偏好。桌面端速率标签绘制限于总览区，卡片与工具栏位于球体前方，避免遮挡节点标题和点击；球体保持完整外观。
- Emerald `NodeEarthGlobe.vue` 的弧线由 COBE 绘制（`arcWidth: 0.8`、`arcHeight: 0.4`）：`from` 为每个节点国家聚合点，`to` 为访客国家代表坐标，并非节点互连或精确城市路径。这里将相同连接规则适配到现有 SVG 地球：复用国家代表坐标，线宽 0.8、沿大圆抬升系数 0.4，背面遮挡段不绘制。访客国家来自 `/api/visitor`；缺失或无法映射坐标时返回空连线，不使用 hub 或虚构位置。
- Emerald 原版 `VisitorInfoCard.vue` 通过浏览器直接请求 IP.SB 等第三方 GeoIP；本项目采用同源 Cloudflare 元数据方案，不复制其第三方请求或展开原始 IP 功能。
- 原站后台配置（分组、自定义标签、背景、地球模式、价格可见性等）不在本项目公开 API 的配置契约内，不创建无功能设置按钮；现有 passkey 实现保留，仅不渲染页面入口。GPU/Swap/进程等缺失字段不填假数据；回程路线没有对应原站区域，不额外混入卡片。
- 按当前用户要求，卡片底部“溢价 / 无溢价 / free”等灰框自定义标签及列表同类标签不展示。

### 访客信息与隐私

`GET /api/visitor` 在 `worker/index.ts` 独立路由到 `worker/visitor.ts`，不代理主控、不要求 `PROBE_TOKEN`、不请求任何第三方。只读取 Cloudflare 注入的 `request.cf.country/city/region` 和 `CF-Connecting-IP`，返回 `{ countryCode, city, region, maskedIp }`；缺失或无效值为空字符串。响应（包括 405）使用 `Cache-Control: private, no-store`，只接受 GET。IPv4 校验后遮盖第三段（星号数等于原段位数）；IPv6 校验并展开后仅保留前四段，后四段整体替换为 `*`，包括压缩与 IPv4 映射形式。接口不返回也不记录原始 IP，不读取其他 IP 转发头。

`VisitorInfo.tsx` 只请求这个同源接口；国家名称在前端由国家码转换，城市缺失回退到地区，完全未知时显示“网络访客 / 暂无法获取”。浏览器由 `navigator.userAgent` 本地识别。悬浮条没有显示完整 IP 的入口。访客国家只用于国家级示意连线，不代表精确位置或真实网络链路；监控指标仍来自原有 `/api/probe`、`/api/series`、`/api/stream`。

本地开发没有 Cloudflare 元数据时，空字段和无弧线是预期结果；截图可用明确标注的本地 mock。以后迁移自有服务器可保留接口契约，但应替换元数据来源（受信反代头或本地 GeoIP 数据库），不能把任意客户端提交的转发头当作可信定位。

详情按 `src/types.ts` 和系统序列接入实际字段，缺失的格子直接隐藏：

| 展示 | 本项目字段 / 规则 |
| --- | --- |
| 节点价格 | `renewal_price_cny` 优先；否则 `renewal_price` + `renewal_currency`，不请求外部汇率 |
| 月均支出、剩余价值 | 根据已上报价格、`renewal_cycle`、`expires_at` 推导；月/季/半年/年/两年/三年按 30/90/180/365/730/1095 天折算，月均按 30 天；提示标明估算，非账单或退款额 |
| 剩余时间 | `expires_at`；仅明确 `renewal_cycle=permanent` 才显示长期 |
| 硬件 | `cpu_model`、`cpu_cores`、`arch`、`kernel`；不额外添加原站没有的独立线程格 |
| 系统 | `os`、`uptime`；离线时才有 `last_seen`，不能用浏览器收包时间冒充在线节点最后上报时间 |
| 存储 / 网络 | `mem_total`、`disk_total`、`traffic_used`（回退 `traffic_used_total`）、`traffic_limit`、`upload_speed`、`download_speed`；未设置限额不冒充无限流量 |
| 系统历史 | `/api/series?metric=system` 的 `{t,value}` 序列：`cpu_pct`、`mem_used`、`disk_used`、`upload_speed`、`download_speed`、`tcp_connections`、`udp_connections` |

GPU 型号/使用率、Swap 总量/历史、进程数/历史、精确启动时间、在线最后上报时间、历史 CPU 负载及任意分组/自定义标签未在当前契约中提供，不创建虚假值。12H 使用现有 `range=24h` 响应按采样时间裁取最近 12 小时，保留原 30 分钟采样粒度；其他范围使用原生接口，缺样保留断点。详情每 30 秒刷新，切换范围取消旧请求，10 秒超时并自动重试。

## 准备工作

- 已部署支持独立探针访问密钥的妙妙屋 X 主控
- Cloudflare 账户及可用的 Workers 服务
- Node.js 22 或更高版本、npm 10 或更高版本
- 主控具有可由 Cloudflare 访问的 HTTPS 地址

先进入主控的“系统设置 → 探针”，启用探针、选择展示服务器和指标，然后生成“独立探针访问密钥”。密钥明文只显示一次，请立即保存，切勿提交到 Git。

## Cloudflare 网页部署（推荐）

整个过程由 Cloudflare 从 GitHub 拉取、编译和部署，不需要在本地 clone，也不需要安装 Node.js：

1. 点击上方 **Deploy to Cloudflare**。如果按钮暂时不可用，进入 Cloudflare Dashboard 的 **Workers & Pages → Create application → Import a repository**，选择 `iluobei/mmwx-probe`。
2. 保持以下构建设置：
   - Production branch：`main`
   - Build command：`npm run build`
   - Deploy command：`npx wrangler deploy`
   - Root directory：独立仓库留空；从主项目部署时填写 `mmwx-probe`
3. 首次部署后，进入 Worker 的 **Settings → Variables and Secrets**，添加运行时变量：

   | 名称 | 类型 | 值 |
   | --- | --- | --- |
   | `MMWX_ORIGIN` | Text | 主控 HTTPS 地址，例如 `https://panel.example.com` |
   | `PROBE_TOKEN` | Secret | 主控“系统设置 → 探针”生成的访问密钥 |

   注意这里是 Worker 的运行时 **Variables and Secrets**，不是 **Build Variables and Secrets**。保存后点击 Deploy，使变量进入当前部署。
4. 打开 Worker 地址，确认服务器列表、趋势图和实时更新正常。
5. 最后回到主控，开启“仅允许独立探针访问”。此后直接访问主控的探针接口会返回 `404`。

连接 GitHub 后，每次推送到 `main` 分支都会由 Workers Builds 自动构建和部署。

## Wrangler 命令行部署

1. 克隆项目并安装依赖：

   ```bash
   git clone https://github.com/你的用户名/mmwx-probe.git
   cd mmwx-probe
   npm ci
   npx wrangler login
   ```

2. 在 Cloudflare Dashboard 的 **Settings → Variables and Secrets** 添加文本变量 `MMWX_ORIGIN`。地址必须是固定的 HTTPS 源站，不要包含路径或结尾斜杠。

3. 将主控生成的密钥保存为 Worker Secret：

   ```bash
   npx wrangler secret put PROBE_TOKEN
   ```

4. 构建并部署：

   ```bash
   npm run deploy
   ```

5. 打开 Wrangler 输出的 `workers.dev` 地址，确认列表、趋势图和实时更新正常。最后回到主控，开启“仅允许独立探针访问”。开启后，未携带 Worker 密钥直接访问主控探针接口会返回 `404`。

### 绑定自定义域名

在 Cloudflare Dashboard 中进入 **Workers & Pages → mmwx-probe → Settings → Domains & Routes**，添加自定义域名。DNS、TLS 和 WebSocket 均由 Cloudflare 处理，无需修改前端代码。

## 本地开发

复制本地环境变量示例，填写主控地址和同一份访问密钥：

```bash
cp .dev.vars.example .dev.vars
```

在 `.dev.vars` 中填写：

```dotenv
MMWX_ORIGIN=https://panel.example.com
PROBE_TOKEN=主控生成的访问密钥
```

分别启动 Worker 和 Vite：

```bash
# 终端 1
npx wrangler dev

# 终端 2
npm run dev
```

访问 `http://localhost:5173`。Vite 会把 `/api/*` 转发到本地 Worker 的 `8787` 端口。

### 无密钥模拟预览

使用独立的本地模拟服务，在 `127.0.0.1:8788` 提供符合上述契约的 `/api/probe`、`/api/series` 和 `/api/stream`（仓库不附带模拟后端）。然后启动：

```powershell
$env:VITE_PROBE_MOCK='1'
npm run dev
```

模拟模式代理到 `127.0.0.1:8788`；仅在开发环境、模拟模式且 URL 带 `?debug` 时显示“演示环境”提示，生产构建不包含该提示。正常开发不设置 `VITE_PROBE_MOCK`；模拟服务及其 `/__qa` 测试控制端点不会被打包进 Worker 或静态产物。页面按接口原始下标查询历史，筛选和排序不改变服务器编号；缺失信息隐藏，单个指标缺项显示 `—`，缺失采样保留断点。

WebSocket 收到有效帧时优先使用实时数据；断线后立即回退 HTTP（5 秒一次），以 1–30 秒指数退避重连。15 秒未收到有效帧也会关闭并重连，避免静默连接冻结页面；单次 HTTP 请求 10 秒超时。详情历史每 30 秒刷新，保留天数由主控决定。

## 常用命令

```bash
npm run dev        # 启动 Vite 开发服务器
npm run typecheck  # TypeScript 类型检查
npm run build      # 生成 dist 生产文件
npm run preview    # 本地预览生产构建
npm run deploy     # 构建并部署到 Cloudflare Workers
```

## 更新与密钥轮换

本 fork 已删除 `.github/workflows/sync-upstream.yml`，停止自动合并上游，以免覆盖重写的前端。上游更新需要人工审查后选择性合并；不要重新启用自动同步工作流。

手动更新仍可执行 `npm ci && npm run deploy`。轮换密钥时，先在主控生成新密钥，立即执行 `npx wrangler secret put PROBE_TOKEN` 并重新部署；在 Worker 更新完成前，探针可能短暂返回 `404`。主控只保存密钥的 SHA-256 哈希，无法找回旧密钥。

## 故障排查

- `503 Probe access secret is not configured`：尚未设置 `PROBE_TOKEN`。
- Worker 返回 `404`：Worker Secret 与主控生成的密钥不一致，或主控探针未启用。
- 页面无实时更新：检查 Cloudflare 与源站反向代理是否允许 WebSocket；页面会自动使用 HTTP 轮询。
- `MMWX_ORIGIN must use HTTPS`：生产源站不是 HTTPS。本地调试仅允许 `localhost` 或 `127.0.0.1`。
- 页面没有服务器：在主控探针设置中选择需要展示的服务器。

## 发布到 GitHub

如果当前目录尚未初始化为独立仓库：

```bash
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/你的用户名/mmwx-probe.git
git push -u origin main
```

提交前确认 `.dev.vars`、`wrangler.local.jsonc`、`node_modules/` 和 `dist/` 未被纳入版本控制。

## 许可证

当前页面设计适配自 Emerald（MIT），固定版本见“Emerald 展示约定”。保留的基础样式曾适配自 Nezha 默认前端 `nezhahq/user-frontend-backup`（源自 `hamster1963/nezha-dash-v2`），固定提交 `1dd038bea8f6c5143c3e8fb4077fead24994fe4e`，Apache-2.0。全部署名与改动说明见 [THIRD_PARTY_NOTICES](public/THIRD_PARTY_NOTICES.txt)，完整许可随静态产物一起分发。未使用其商标 logo。

2026-11-09 通过 GitHub API 核验的轻量服务器探针候选（并非全部可观测性产品）：Nezha 10,393 stars（WTFPL，默认前端 Apache-2.0），Komari 6,956（MIT），cppla/ServerStatus 4,683（MIT），zdz/ServerStatus-Rust 2,334（Apache-2.0），hamster1963/nezha-dash 1,692（Apache-2.0），BotoX/ServerStatus 824（WTFPL）。按探针项目主仓库 star 排序选择 Nezha；其前端独立仓库的 star 不等于主项目 star。WTFPL 并不禁止修改和再分发，因此没有跳过第一名。

本项目采用 [Miaomiaowu X Source Available License v1.0](LICENSE)。允许非商业使用、学习、修改和按许可证要求分发；商业使用需取得授权。
