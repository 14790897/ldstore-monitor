# LDStore Monitor

监控 [LD士多积分商城](https://ldst0re.qzz.io/) 商品更新，部署在 Cloudflare Worker 上，通过网页配置监控关键词，支持浏览器推送和 Telegram 通知。

## 功能

- Cloudflare Worker Cron Trigger 每分钟自动扫描全部商品
- 网页界面配置匹配关键词和排除关键词
- 仅在商品**新上架、补货、信息更新**时通知
- 首次运行静默记录，不发送通知
- 浏览器 Web Push 通知 + Telegram Bot 推送双通道
- 配置存储在 Cloudflare KV，随时在线修改

## 部署

### 1. 安装依赖

```bash
npm install
```

### 2. 创建 KV 命名空间

```bash
npx wrangler kv namespace create MONITOR_KV
npx wrangler kv namespace create MONITOR_KV --preview
```

将返回的 `id` 和 `preview_id` 填入 `wrangler.toml`。

### 3. 生成 VAPID 密钥（浏览器推送通知需要）

```bash
npm run generate-vapid
```

将生成的公钥填入 `wrangler.toml` 的 `VAPID_PUBLIC_KEY`，私钥通过 secret 设置：

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
```

### 4. 部署

```bash
npm run deploy
```

### 5. 本地开发

```bash
npm run dev
```

访问 `http://localhost:8787` 查看页面，访问 `http://localhost:8787/__scheduled` 手动触发定时任务。

## 使用方法

1. 打开部署后的网页
2. 在「匹配关键词」区域添加想监控的关键词（如 谷歌、Google）
3. 在「排除关键词」区域添加想过滤的词（如 Google Pay）
4. 点击「保存配置」
5. 点击「开启浏览器通知」授权推送
6. 如需 Telegram 通知，展开填入 Bot Token 和 Chat ID

## 通知触发条件

| 场景 | 说明 |
|------|------|
| 新商品 | 首次出现的匹配商品 |
| 补货 | 库存从 0 变为有货 |
| 已更新 | 商品信息发生变化 |

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 获取当前配置 |
| PUT | `/api/config` | 更新配置 |
| POST | `/api/subscribe` | 保存浏览器推送订阅 |
| DELETE | `/api/subscribe` | 取消推送订阅 |
| GET | `/api/status` | 获取最近一次检查结果 |
| POST | `/api/check` | 手动触发检查 |

## License

MIT
