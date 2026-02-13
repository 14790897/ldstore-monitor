import { buildPushPayload } from "@block65/webcrypto-web-push";

export interface Env {
  MONITOR_KV: KVNamespace;
  ASSETS: Fetcher;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  API_TOKEN: string;
  TELEGRAM_BOT_TOKEN: string;
}

interface ProductState {
  hasStock: boolean;
  updated_at: number;
}

interface Product {
  id: number;
  name: string;
  description: string;
  category_name: string;
  category_icon: string;
  price: number;
  discount: number;
  stock: number;
  availableStock?: number;
  updated_at: number;
  created_at: number;
  seller_name: string;
  seller_avatar: string;
  product_type: string;
  image_url: string;
  sold_count: number;
  view_count: number;
}

const API_BASE =
  "https://api2.ldspro.qzz.io/api/shop/products?pageSize=50&sortBy=updated_at&sortOrder=DESC";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function cors() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// --- Fetch Products ---

async function getToken(env: Env): Promise<string | null> {
  const userToken = await env.MONITOR_KV.get("api_token");
  return userToken || env.API_TOKEN || null;
}

async function fetchAllProducts(env: Env): Promise<Product[]> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    origin: "https://ldst0re.qzz.io",
    referer: "https://ldst0re.qzz.io/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };
  const token = await getToken(env);
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const firstRes = await fetch(`${API_BASE}&page=1`, { headers });
  if (!firstRes.ok) throw new Error(`API error: ${firstRes.status}`);
  const firstData: any = await firstRes.json();
  if (!firstData.success) throw new Error("API returned failure");

  const { totalPages } = firstData.data.pagination;
  const allProducts: Product[] = [...firstData.data.products];

  const pagePromises = [];
  for (let p = 2; p <= totalPages; p++) {
    pagePromises.push(
      fetch(`${API_BASE}&page=${p}`, { headers })
        .then((r) => r.json())
        .then((d: any) => (d.success ? d.data.products : []))
    );
  }
  const pages = await Promise.all(pagePromises);
  for (const products of pages) {
    allProducts.push(...products);
  }

  return allProducts;
}

// --- Subscription data stored in KV ---

interface KeywordFilter {
  keywords: string[];
  excludeKeywords: string[];
}

interface SubscriptionData extends KeywordFilter {
  subscription: { endpoint: string; expirationTime: number | null; keys: { p256dh: string; auth: string } };
}

interface TelegramSubscriptionData extends KeywordFilter {
  chatId: number;
}

function matchesKeywords(text: string, sub: KeywordFilter): boolean {
  if (sub.keywords.length === 0) return true;
  const lower = text.toLowerCase();
  const match = sub.keywords.some((kw) => lower.includes(kw.toLowerCase()));
  const exclude = sub.excludeKeywords.some((kw) => lower.includes(kw.toLowerCase()));
  return match && !exclude;
}

// --- Web Push ---

async function sendWebPushForUpdate(
  env: Env,
  update: { reason: string; product: Product; stockText: string }
) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;

  const productText = `${update.product.name} ${update.product.description} ${update.product.category_name}`;
  const payload = JSON.stringify({
    title: `LD士多 ${update.reason}`,
    body: `${update.product.name} | ${update.product.price} LDC | 库存: ${update.stockText}`,
    url: `https://ldst0re.qzz.io/product/${update.product.id}`,
  });

  const list = await env.MONITOR_KV.list({ prefix: "sub:" });
  for (const key of list.keys) {
    const raw = await env.MONITOR_KV.get(key.name);
    if (!raw) continue;

    try {
      const subData: SubscriptionData = JSON.parse(raw);
      if (!matchesKeywords(productText, subData)) continue;

      const message = { data: JSON.parse(payload), options: { ttl: 60, urgency: "high" as const } };
      const vapid = {
        subject: "mailto:ldstore-monitor@example.com",
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      };
      const { headers, method, body } = await buildPushPayload(message, subData.subscription, vapid);

      const pushRes = await fetch(subData.subscription.endpoint, { method, headers, body });
      if (pushRes.status === 410 || pushRes.status === 404) {
        await env.MONITOR_KV.delete(key.name);
      }
    } catch {
      // skip failed subscription
    }
  }
}

// --- Telegram ---

async function sendTelegram(env: Env, chatId: number, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch {
    // Telegram API unreachable
  }
}

async function sendTelegramForUpdate(
  env: Env,
  update: { reason: string; product: Product; stockText: string }
) {
  if (!env.TELEGRAM_BOT_TOKEN) return;

  const productText = `${update.product.name} ${update.product.description} ${update.product.category_name}`;
  const message =
    `${update.reason}\n` +
    `<b>${update.product.name}</b>\n` +
    `💰 ${update.product.price} LDC | 📦 库存: ${update.stockText}\n` +
    `https://ldst0re.qzz.io/product/${update.product.id}`;

  const list = await env.MONITOR_KV.list({ prefix: "tg:" });
  for (const key of list.keys) {
    const raw = await env.MONITOR_KV.get(key.name);
    if (!raw) continue;

    try {
      const subData: TelegramSubscriptionData = JSON.parse(raw);
      if (!matchesKeywords(productText, subData)) continue;

      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: subData.chatId, text: message, parse_mode: "HTML" }),
      });
      if (res.status === 403 || res.status === 400) {
        await env.MONITOR_KV.delete(key.name);
      }
    } catch {
      // skip failed subscription
    }
  }
}

async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: "Telegram not configured" }, 500);

  const body: any = await request.json();
  const msg = body.message;
  if (!msg?.text || !msg?.chat?.id) return json({ ok: true });

  const chatId: number = msg.chat.id;
  const text: string = msg.text.trim();
  const [cmd, ...args] = text.split(/\s+/);

  switch (cmd) {
    case "/start": {
      const existing = await env.MONITOR_KV.get(`tg:${chatId}`);
      if (!existing) {
        const subData: TelegramSubscriptionData = { chatId, keywords: [], excludeKeywords: [] };
        await env.MONITOR_KV.put(`tg:${chatId}`, JSON.stringify(subData));
      }
      await sendTelegram(env, chatId,
        "✅ 已订阅 LD士多商品监控\n\n" +
        "当前设置：接收所有商品通知\n\n" +
        "可用命令：\n" +
        "/subscribe 关键词1 关键词2 — 设置匹配关键词\n" +
        "/exclude 关键词1 关键词2 — 设置排除关键词\n" +
        "/status — 查看当前设置\n" +
        "/unsubscribe — 取消订阅"
      );
      break;
    }

    case "/subscribe": {
      if (args.length === 0) {
        await sendTelegram(env, chatId, "用法：/subscribe 京东 E卡 Steam\n多个关键词用空格分隔");
        break;
      }
      const raw = await env.MONITOR_KV.get(`tg:${chatId}`);
      const subData: TelegramSubscriptionData = raw ? JSON.parse(raw) : { chatId, keywords: [], excludeKeywords: [] };
      subData.keywords = args;
      await env.MONITOR_KV.put(`tg:${chatId}`, JSON.stringify(subData));
      await sendTelegram(env, chatId, `✅ 匹配关键词已更新：${args.join("、")}`);
      break;
    }

    case "/exclude": {
      if (args.length === 0) {
        await sendTelegram(env, chatId, "用法：/exclude 测试 pro\n多个关键词用空格分隔");
        break;
      }
      const raw = await env.MONITOR_KV.get(`tg:${chatId}`);
      const subData: TelegramSubscriptionData = raw ? JSON.parse(raw) : { chatId, keywords: [], excludeKeywords: [] };
      subData.excludeKeywords = args;
      await env.MONITOR_KV.put(`tg:${chatId}`, JSON.stringify(subData));
      await sendTelegram(env, chatId, `✅ 排除关键词已更新：${args.join("、")}`);
      break;
    }

    case "/unsubscribe": {
      await env.MONITOR_KV.delete(`tg:${chatId}`);
      await sendTelegram(env, chatId, "已取消订阅，不再接收通知。\n发送 /start 可重新订阅。");
      break;
    }

    case "/status": {
      const raw = await env.MONITOR_KV.get(`tg:${chatId}`);
      if (!raw) {
        await sendTelegram(env, chatId, "未订阅。发送 /start 开始订阅。");
      } else {
        const subData: TelegramSubscriptionData = JSON.parse(raw);
        const kw = subData.keywords.length > 0 ? subData.keywords.join("、") : "全部（未设置）";
        const ex = subData.excludeKeywords.length > 0 ? subData.excludeKeywords.join("、") : "无";
        await sendTelegram(env, chatId, `📋 当前设置\n匹配关键词：${kw}\n排除关键词：${ex}`);
      }
      break;
    }

    case "/help": {
      await sendTelegram(env, chatId,
        "LD士多商品监控 Bot\n\n" +
        "/start — 开始订阅\n" +
        "/subscribe 关键词 — 设置匹配关键词\n" +
        "/exclude 关键词 — 设置排除关键词\n" +
        "/status — 查看当前设置\n" +
        "/unsubscribe — 取消订阅"
      );
      break;
    }
  }

  return json({ ok: true });
}

// --- Cron: detect product changes and push ---

async function cronCheck(env: Env) {
  const prevRaw = await env.MONITOR_KV.get("products");
  const prevStates: Record<string, ProductState> = prevRaw ? JSON.parse(prevRaw) : {};
  const isFirstRun = Object.keys(prevStates).length === 0;

  const allProducts = await fetchAllProducts(env);

  const newStates: Record<string, ProductState> = {};
  const updates: { reason: string; product: Product; stockText: string }[] = [];

  for (const p of allProducts) {
    const hasStock = p.stock === -1 || p.stock > 0;
    const stockText = p.stock === -1 ? "无限" : `${p.availableStock ?? p.stock}`;
    const prev = prevStates[p.id];

    newStates[p.id] = { hasStock, updated_at: p.updated_at };

    if (isFirstRun) continue;

    const isNew = !prev;
    const restocked = prev && !prev.hasStock && hasStock;
    const updated = prev && prev.updated_at !== p.updated_at;

    if (!isNew && !restocked && !updated) continue;
    if (!hasStock) continue;

    const reason = isNew ? "🆕 新商品" : restocked ? "📦 补货" : "🔄 已更新";
    updates.push({ reason, product: p, stockText });
  }

  if (updates.length > 0 || isFirstRun) {
    await env.MONITOR_KV.put("products", JSON.stringify(newStates));
    await env.MONITOR_KV.put(
      "status",
      JSON.stringify({ timestamp: Date.now(), totalProducts: allProducts.length, updates })
    );
  }

  // Push updates to matching subscribers
  for (const u of updates) {
    await sendWebPushForUpdate(env, u);
    await sendTelegramForUpdate(env, u);
  }
}

// --- API Routes ---

async function handleAPI(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "OPTIONS") return cors();

  // GET /api/products — proxy to upstream, return all products
  if (path === "/api/products" && method === "GET") {
    try {
      const products = await fetchAllProducts(env);
      return json({ success: true, products });
    } catch (err: any) {
      return json({ success: false, error: err.message }, 500);
    }
  }

  // GET /api/status — latest cron check result
  if (path === "/api/status" && method === "GET") {
    const raw = await env.MONITOR_KV.get("status");
    return json(raw ? JSON.parse(raw) : { timestamp: 0, totalProducts: 0, updates: [] });
  }

  // POST /api/subscribe — save push subscription with keywords
  if (path === "/api/subscribe" && method === "POST") {
    const { subscription, keywords, excludeKeywords } = (await request.json()) as {
      subscription: any;
      keywords: string[];
      excludeKeywords: string[];
    };
    const id = crypto.randomUUID();
    const subData: SubscriptionData = {
      subscription,
      keywords: keywords || [],
      excludeKeywords: excludeKeywords || [],
    };
    await env.MONITOR_KV.put(`sub:${id}`, JSON.stringify(subData));
    return json({ ok: true, id });
  }

  // PUT /api/subscribe — update keywords for existing subscription
  if (path === "/api/subscribe" && method === "PUT") {
    const { endpoint, keywords, excludeKeywords } = (await request.json()) as {
      endpoint: string;
      keywords: string[];
      excludeKeywords: string[];
    };
    const list = await env.MONITOR_KV.list({ prefix: "sub:" });
    for (const key of list.keys) {
      const raw = await env.MONITOR_KV.get(key.name);
      if (raw) {
        const subData: SubscriptionData = JSON.parse(raw);
        if (subData.subscription.endpoint === endpoint) {
          subData.keywords = keywords || [];
          subData.excludeKeywords = excludeKeywords || [];
          await env.MONITOR_KV.put(key.name, JSON.stringify(subData));
          return json({ ok: true });
        }
      }
    }
    return json({ error: "Subscription not found" }, 404);
  }

  // DELETE /api/subscribe — remove push subscription
  if (path === "/api/subscribe" && method === "DELETE") {
    const { endpoint } = (await request.json()) as { endpoint: string };
    const list = await env.MONITOR_KV.list({ prefix: "sub:" });
    for (const key of list.keys) {
      const raw = await env.MONITOR_KV.get(key.name);
      if (raw) {
        const subData: SubscriptionData = JSON.parse(raw);
        if (subData.subscription.endpoint === endpoint) {
          await env.MONITOR_KV.delete(key.name);
          break;
        }
      }
    }
    return json({ ok: true });
  }

  // POST /api/telegram/webhook — handle Telegram Bot updates
  if (path === "/api/telegram/webhook" && method === "POST") {
    return handleTelegramWebhook(request, env);
  }

  // GET /api/vapid-public-key
  if (path === "/api/vapid-public-key" && method === "GET") {
    return json({ key: env.VAPID_PUBLIC_KEY || "" });
  }

  // POST /api/token — validate and store user token
  if (path === "/api/token" && method === "POST") {
    const { token } = (await request.json()) as { token: string };
    if (!token) return json({ error: "Token is required" }, 400);

    const reqHeaders = {
      accept: "application/json",
      "content-type": "application/json",
      origin: "https://ldst0re.qzz.io",
      referer: "https://ldst0re.qzz.io/",
    };

    try {
      // Request without token
      const noTokenRes = await fetch(`${API_BASE}&page=1`, { headers: reqHeaders });
      const noTokenData: any = await noTokenRes.json();
      const noTokenTotal = noTokenData.success ? noTokenData.data.pagination.total : 0;

      // Request with token
      const withTokenRes = await fetch(`${API_BASE}&page=1`, {
        headers: { ...reqHeaders, authorization: `Bearer ${token}` },
      });
      const withTokenData: any = await withTokenRes.json();
      if (!withTokenRes.ok || !withTokenData.success) {
        return json({ error: "Token 无效，请求失败" }, 401);
      }
      const withTokenTotal = withTokenData.data.pagination.total;

      if (withTokenTotal <= noTokenTotal) {
        return json({ error: `Token 无效，商品数量未增加（${noTokenTotal} → ${withTokenTotal}）` }, 401);
      }

      // Check if new token has longer expiry than existing one
      let newExp = 0;
      try {
        newExp = JSON.parse(atob(token.split(".")[1])).exp || 0;
      } catch {}

      const existingToken = await env.MONITOR_KV.get("api_token");
      if (existingToken) {
        let oldExp = 0;
        try {
          oldExp = JSON.parse(atob(existingToken.split(".")[1])).exp || 0;
        } catch {}
        if (newExp <= oldExp) {
          return json({
            error: `新 Token 过期时间不晚于当前 Token（当前: ${new Date(oldExp * 1000).toLocaleString("zh-CN")}，新: ${new Date(newExp * 1000).toLocaleString("zh-CN")}）`,
          }, 400);
        }
      }

      await env.MONITOR_KV.put("api_token", token);
      return json({ ok: true, before: noTokenTotal, after: withTokenTotal, exp: newExp });
    } catch {
      return json({ error: "验证失败" }, 500);
    }
  }

  // GET /api/token — check if user token exists
  if (path === "/api/token" && method === "GET") {
    const token = await env.MONITOR_KV.get("api_token");
    if (!token) return json({ hasToken: false });
    // Decode JWT exp to check expiry
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      return json({ hasToken: true, exp: payload.exp });
    } catch {
      return json({ hasToken: true });
    }
  }

  // DELETE /api/token — remove user token
  if (path === "/api/token" && method === "DELETE") {
    await env.MONITOR_KV.delete("api_token");
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

export { matchesKeywords, json, cors, handleTelegramWebhook };

// --- Entry ---

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleAPI(request, env);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(cronCheck(env));
  },
};
