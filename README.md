# LDStore Monitor

监控 [LD士多积分商城](https://ldst0re.qzz.io/) 商品变动，部署在 Cloudflare Worker 上，支持按关键词过滤和浏览器 Web Push 通知。

## 功能

- Cloudflare Worker Cron Trigger 每分钟自动扫描全部商品
- Vue 3 + Tailwind CSS 前端界面，配置关键词实时过滤商品
- 每个订阅者独立的关键词/排除词，服务端精准推送
- 仅在商品**新上架、补货、信息更新**时通知
- 首次运行静默记录，不发送通知
- 商品状态和推送订阅存储在 Cloudflare KV

## 项目结构

```
src/index.ts          # Worker 入口（API + Cron）
frontend/src/App.vue  # Vue 前端单页应用
wrangler.toml         # Cloudflare Worker 配置
test/                 # Vitest 单元/集成测试
```

## 部署

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

公钥填入 `wrangler.toml` 的 `VAPID_PUBLIC_KEY`，私钥通过 secret 设置：

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
```

### 4. 设置 API Token

```bash
npx wrangler secret put API_TOKEN
```

输入 LD士多的 JWT token。

### 5. 部署

```bash
npm run deploy
```

### 6. 本地开发

```bash
npm run dev
```

访问 `http://localhost:8787`，访问 `http://localhost:8787/__scheduled` 手动触发定时任务。

### 7. 运行测试

```bash
npm test
```

## 通知触发条件

| 场景 | 说明 |
|------|------|
| 新商品 | 首次出现的匹配商品 |
| 补货 | 库存从 0 变为有货 |
| 已更新 | 商品信息发生变化 |

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/products` | 获取全部商品列表 |
| GET | `/api/status` | 获取最近一次检查结果 |
| GET | `/api/vapid-public-key` | 获取 VAPID 公钥 |
| POST | `/api/subscribe` | 创建推送订阅（含关键词） |
| PUT | `/api/subscribe` | 更新订阅的关键词 |
| DELETE | `/api/subscribe` | 取消推送订阅 |

## License

MIT
