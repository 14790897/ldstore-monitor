import { buildPushPayload } from "web-push-browser";

export interface Env {
  MONITOR_KV: KVNamespace;
  ASSETS: Fetcher;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

interface Config {
  keywords: string[];
  excludeKeywords: string[];
  telegram: { bot_token: string; chat_id: string };
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
  price: number;
  discount: number;
  stock: number;
  availableStock?: number;
  updated_at: number;
  seller_name: string;
  product_type: string;
}

interface CheckResult {
  timestamp: number;
  totalProducts: number;
  matchedCount: number;
  updates: {
    reason: string;
    product: Product;
    hasStock: boolean;
    stockText: string;
  }[];
}

const API_BASE =
  "https://api2.ldspro.qzz.io/api/shop/products?pageSize=50&sortBy=updated_at&sortOrder=DESC";

const DEFAULT_CONFIG: Config = {
  keywords: ["谷歌", "google", "gmail", "Google Voice", "GV", "Google Play", "Google One", "谷歌账号", "谷歌邮箱"],
  excludeKeywords: [],
  telegram: { bot_token: "", chat_id: "" },
};

// --- Helper Functions ---

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function getConfig(kv: KVNamespace): Promise<Config> {
  const raw = await kv.get("config");
  if (!raw) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

async function getProductStates(kv: KVNamespace): Promise<Record<string, ProductState>> {
  const raw = await kv.get("products");
  return raw ? JSON.parse(raw) : {};
}

function matchKeywords(text: string, keywords: string[], excludeKeywords: string[]): boolean {
  const lower = text.toLowerCase();
  const included = keywords.some((kw) => lower.includes(kw.toLowerCase()));
  if (!included) return false;
  const excluded = excludeKeywords.some((kw) => lower.includes(kw.toLowerCase()));
  return !excluded;
}

async function fetchAllProducts(): Promise<Product[]> {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    origin: "https://ldst0re.qzz.io",
    referer: "https://ldst0re.qzz.io/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };

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

// --- Notification Functions ---

async function sendTelegram(config: Config, text: string) {
  const token = config.telegram.bot_token;
  const chatId = config.telegram.chat_id;
  if (!token || !chatId) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

async function sendWebPush(env: Env, payload: string) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;

  const list = await env.MONITOR_KV.list({ prefix: "sub:" });
  for (const key of list.keys) {
    const subJson = await env.MONITOR_KV.get(key.name);
    if (!subJson) continue;

    try {
      const subscription = JSON.parse(subJson);
      const data = await buildPushPayload(
        {
          subscription,
          jwt: {
            sub: "mailto:ldstore-monitor@example.com",
            privateKey: env.VAPID_PRIVATE_KEY,
            publicKey: env.VAPID_PUBLIC_KEY,
          },
          ttl: 60,
        },
        payload
      );

      const pushRes = await fetch(subscription.endpoint, data);
      if (pushRes.status === 410 || pushRes.status === 404) {
        await env.MONITOR_KV.delete(key.name);
      }
    } catch {
      // skip failed subscription
    }
  }
}

// --- Core Check Logic ---

async function checkProducts(env: Env): Promise<CheckResult> {
  const config = await getConfig(env.MONITOR_KV);
  const prevStates = await getProductStates(env.MONITOR_KV);
  const isFirstRun = Object.keys(prevStates).length === 0;

  const allProducts = await fetchAllProducts();

  const matched = allProducts.filter((p) => {
    const text = `${p.name} ${p.description} ${p.category_name}`;
    return matchKeywords(text, config.keywords, config.excludeKeywords);
  });

  const updates: CheckResult["updates"] = [];
  const newStates: Record<string, ProductState> = {};

  for (const p of matched) {
    const hasStock = p.stock === -1 || p.stock > 0;
    const stockText = p.stock === -1 ? "无限" : `${p.availableStock ?? p.stock}`;
    const prev = prevStates[p.id];

    const isNew = !prev;
    const restocked = prev && !prev.hasStock && hasStock;
    const updated = prev && prev.updated_at !== p.updated_at;

    newStates[p.id] = { hasStock, updated_at: p.updated_at };

    if (isFirstRun) continue;
    if (!isNew && !restocked && !updated) continue;

    const reason = isNew ? "🆕 新商品" : restocked ? "📦 补货" : "🔄 已更新";
    updates.push({ reason, product: p, hasStock, stockText });
  }

  // Save states
  await env.MONITOR_KV.put("products", JSON.stringify(newStates));

  // Send notifications for updates with stock
  for (const u of updates) {
    if (!u.hasStock) continue;

    const msg = `${u.reason} ${u.product.name}\n价格: ${u.product.price} LDC (${u.product.discount * 10}折)\n库存: ${u.stockText}\n卖家: ${u.product.seller_name}\nhttps://ldst0re.qzz.io/product/${u.product.id}`;

    await sendTelegram(config, `<b>LD士多 - 商品更新!</b>\n${msg}`);
    await sendWebPush(env, JSON.stringify({
      title: "LD士多 - 商品更新!",
      body: `${u.reason} ${u.product.name} | ${u.product.price} LDC | 库存: ${u.stockText}`,
      url: `https://ldst0re.qzz.io/product/${u.product.id}`,
    }));
  }

  const result: CheckResult = {
    timestamp: Date.now(),
    totalProducts: allProducts.length,
    matchedCount: matched.length,
    updates,
  };
  await env.MONITOR_KV.put("status", JSON.stringify(result));

  return result;
}

// --- Route Handlers ---

async function handleAPI(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // GET /api/config
  if (path === "/api/config" && method === "GET") {
    const config = await getConfig(env.MONITOR_KV);
    return json(config);
  }

  // PUT /api/config
  if (path === "/api/config" && method === "PUT") {
    const body = await request.json() as Partial<Config>;
    const current = await getConfig(env.MONITOR_KV);
    const updated = { ...current, ...body };
    await env.MONITOR_KV.put("config", JSON.stringify(updated));
    return json({ ok: true, config: updated });
  }

  // POST /api/subscribe
  if (path === "/api/subscribe" && method === "POST") {
    const subscription = await request.json();
    const id = crypto.randomUUID();
    await env.MONITOR_KV.put(`sub:${id}`, JSON.stringify(subscription));
    return json({ ok: true, id });
  }

  // DELETE /api/subscribe
  if (path === "/api/subscribe" && method === "DELETE") {
    const { endpoint } = await request.json() as { endpoint: string };
    const list = await env.MONITOR_KV.list({ prefix: "sub:" });
    for (const key of list.keys) {
      const raw = await env.MONITOR_KV.get(key.name);
      if (raw) {
        const sub = JSON.parse(raw);
        if (sub.endpoint === endpoint) {
          await env.MONITOR_KV.delete(key.name);
          break;
        }
      }
    }
    return json({ ok: true });
  }

  // GET /api/status
  if (path === "/api/status" && method === "GET") {
    const status = await env.MONITOR_KV.get("status");
    return json(status ? JSON.parse(status) : { timestamp: 0, totalProducts: 0, matchedCount: 0, updates: [] });
  }

  // POST /api/check
  if (path === "/api/check" && method === "POST") {
    const result = await checkProducts(env);
    return json(result);
  }

  // GET /api/vapid-public-key
  if (path === "/api/vapid-public-key" && method === "GET") {
    return json({ key: env.VAPID_PUBLIC_KEY || "" });
  }

  return json({ error: "Not found" }, 404);
}

// --- Worker Entry ---

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleAPI(request, env);
    }

    // Fallback to static assets
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkProducts(env));
  },
};
