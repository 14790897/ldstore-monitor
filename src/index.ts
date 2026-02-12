import { buildPushPayload } from "@block65/webcrypto-web-push";

export interface Env {
  MONITOR_KV: KVNamespace;
  ASSETS: Fetcher;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  API_TOKEN: string;
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

async function fetchAllProducts(env: Env): Promise<Product[]> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    origin: "https://ldst0re.qzz.io",
    referer: "https://ldst0re.qzz.io/",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };
  if (env.API_TOKEN) {
    headers.authorization = `Bearer ${env.API_TOKEN}`;
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

interface SubscriptionData {
  subscription: { endpoint: string; expirationTime: number | null; keys: { p256dh: string; auth: string } };
  keywords: string[];
  excludeKeywords: string[];
}

function matchesKeywords(text: string, sub: SubscriptionData): boolean {
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

  await env.MONITOR_KV.put("products", JSON.stringify(newStates));
  await env.MONITOR_KV.put(
    "status",
    JSON.stringify({ timestamp: Date.now(), totalProducts: allProducts.length, updates })
  );

  // Push updates to matching subscribers
  for (const u of updates) {
    await sendWebPushForUpdate(env, u);
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

  // GET /api/vapid-public-key
  if (path === "/api/vapid-public-key" && method === "GET") {
    return json({ key: env.VAPID_PUBLIC_KEY || "" });
  }

  return json({ error: "Not found" }, 404);
}

export { matchesKeywords, json, cors };

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
