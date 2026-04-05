# LD士多 商品监控

> 监控 [LD士多积分商城](https://ldst0re.qzz.io/) 商品变动，自动推送通知到浏览器和 Telegram。

[![Test](https://github.com/14790897/ldstore-monitor/actions/workflows/test.yml/badge.svg)](https://github.com/14790897/ldstore-monitor/actions/workflows/test.yml)

🔗 **在线地址**：[monitor.sixiangjia.de](https://monitor.sixiangjia.de)
| 📦 **GitHub**：[14790897/ldstore-monitor](https://github.com/14790897/ldstore-monitor)
| 🤖 **Telegram Bot**：[@ldstore_monitor_bot](https://t.me/ldstore_monitor_bot)

## 特性

- **自动监控** — Cloudflare Worker Cron 每分钟扫描全部商品
- **精准推送** — 每个订阅者独立关键词/排除词，仅推送匹配的变动（Web Push + Telegram）
- **智能过滤** — 仅在新上架、补货、信息更新时通知，首次运行静默
- **Token 共享** — 用户可提交登录 Token，解锁更多商品数据
- **轻量前端** — Vue 3 + Tailwind CSS，移动端友好

## 截图

```
┌─────────────────────────────┐
│     LD士多 商品监控  🐙 ✈️    │
│  ┌───────────────────────┐  │
│  │ 匹配关键词  [京东] [E卡] │  │
│  │ 排除关键词  [测试]      │  │
│  └───────────────────────┘  │
│  Token | 刷新 | 开启通知     │
│  ┌───────────────────────┐  │
│  │ 商品A  ¥100  有货       │  │
│  │ 商品B  ¥200  缺货       │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

## 项目结构

```
src/index.ts              # Worker 入口（API 路由 + Cron 定时任务 + Web Push + Telegram）
frontend/
  ├── src/App.vue          # 主页面（商品列表、关键词过滤、通知开关）
  ├── src/TokenPage.vue    # Token 管理页面（说明、提交、状态）
  └── public/sw.js         # Service Worker（接收推送通知）
test/
  ├── unit/                # 单元测试（关键词匹配、工具函数）
  └── integration/         # 集成测试（API 路由、Cron 逻辑）
wrangler.toml              # Cloudflare Worker 配置
```

## 快速开始

### 1. 安装依赖

```bash
npm install
cd frontend && npm install
```

### 2. 创建 KV 命名空间

```bash
npx wrangler kv namespace create MONITOR_KV
```

将返回的 `id` 填入 `wrangler.toml`。

### 3. 生成 VAPID 密钥

```bash
npm run generate-vapid
```

- 公钥 → `wrangler.toml` 的 `VAPID_PUBLIC_KEY`
- 私钥 → `npx wrangler secret put VAPID_PRIVATE_KEY`

### 4. 设置 API Token（可选）

```bash
npx wrangler secret put API_TOKEN
```

也可以部署后在前端 Token 页面提交，用户提交的 Token 优先级更高。

### 5. 设置 Telegram Bot（可选）

1. 在 Telegram 中找 [@BotFather](https://t.me/BotFather)，发送 `/newbot` 创建 Bot，获取 Token
2. 设置 secret：
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
```
3. 部署后设置 Webhook：
```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://monitor.sixiangjia.de/api/telegram/webhook"
```

用户通过 [@ldstore_monitor_bot](https://t.me/ldstore_monitor_bot) 管理订阅：
- `/start` — 开始订阅
- `/subscribe 京东 E卡` — 设置匹配关键词
- `/exclude 测试` — 设置排除关键词
- `/status` — 查看当前设置
- `/unsubscribe` — 取消订阅
- `/help` — 查看帮助

### 6. 部署

```bash
npm run deploy
```

### 7. 本地开发

```bash
npm run dev
```

- 前端：`http://localhost:8787`
- 手动触发 Cron：`http://localhost:8787/__scheduled`

### 8. 测试

```bash
npm test           # 运行所有测试
npm run test:watch # 监听模式
```
### 9.停止·

```bash
npx wrangler delete ldstore-monitor
```

## 通知触发条件

| 场景 | 触发条件 |
|:-----|:---------|
| 🆕 新商品 | 首次出现且有库存的商品 |
| 📦 补货 | 库存从 0 变为有货 |
| 🔄 已更新 | 商品信息（价格、描述等）发生变化 |

## API 接口

| 方法 | 路径 | 说明 |
|:-----|:-----|:-----|
| `GET` | `/api/products` | 获取全部商品列表 |
| `GET` | `/api/status` | 最近一次检查结果 |
| `GET` | `/api/vapid-public-key` | 获取 VAPID 公钥 |
| `POST` | `/api/subscribe` | 创建推送订阅（含关键词） |
| `PUT` | `/api/subscribe` | 更新订阅的关键词 |
| `DELETE` | `/api/subscribe` | 取消推送订阅 |
| `GET` | `/api/token` | 查询 Token 状态 |
| `POST` | `/api/token` | 验证并存储 Token |
| `DELETE` | `/api/token` | 移除 Token |
| `POST` | `/api/telegram/webhook` | Telegram Bot Webhook |

## 技术栈

| 层 | 技术 |
|:---|:-----|
| 运行时 | Cloudflare Workers |
| 存储 | Cloudflare KV |
| 前端 | Vue 3 + Tailwind CSS |
| 推送 | Web Push (VAPID) + Telegram Bot |
| 测试 | Vitest + @cloudflare/vitest-pool-workers |
| CI | GitHub Actions |

## License

MIT
