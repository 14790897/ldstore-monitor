import { describe, it, expect, beforeEach, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/index";

async function clearKV() {
  const keys = await env.MONITOR_KV.list();
  await Promise.all(keys.keys.map((k) => env.MONITOR_KV.delete(k.name)));
}

function mockFetchProducts(products: any[]) {
  const originalFetch = globalThis.fetch;
  // @ts-ignore
  globalThis.fetch = vi.fn((url: string) => {
    if (typeof url === "string" && url.includes("api2.ldspro.qzz.io")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: { products, pagination: { totalPages: 1 } },
          })
        )
      );
    }
    return originalFetch(url);
  });
}

describe("Cron Job", () => {
  beforeEach(async () => {
    await clearKV();
    vi.restoreAllMocks();
  });

  it("stores product state on first run without updates", async () => {
    mockFetchProducts([
      { id: 1, name: "Product 1", description: "", category_name: "Cat", stock: 10, updated_at: 1000, price: 100, availableStock: 10 },
      { id: 2, name: "Product 2", description: "", category_name: "Cat", stock: -1, updated_at: 2000, price: 200 },
    ]);

    const ctx = createExecutionContext();
    await worker.scheduled({ scheduledTime: Date.now(), cron: "*/1 * * * *" } as ScheduledEvent, env, ctx);
    await waitOnExecutionContext(ctx);

    const stored = await env.MONITOR_KV.get("products");
    expect(stored).toBeTruthy();
    const states = JSON.parse(stored!);
    expect(states["1"]).toEqual({ hasStock: true, updated_at: 1000 });
    expect(states["2"]).toEqual({ hasStock: true, updated_at: 2000 });

    const status = JSON.parse((await env.MONITOR_KV.get("status"))!);
    expect(status.totalProducts).toBe(2);
    expect(status.updates).toHaveLength(0);
  });

  it("detects new products on subsequent runs", async () => {
    await env.MONITOR_KV.put("products", JSON.stringify({
      "1": { hasStock: true, updated_at: 1000 },
    }));

    mockFetchProducts([
      { id: 1, name: "Product 1", description: "", category_name: "Cat", stock: 10, updated_at: 1000, price: 100, availableStock: 10 },
      { id: 2, name: "New Product", description: "", category_name: "Cat", stock: 5, updated_at: 2000, price: 50, availableStock: 5 },
    ]);

    const ctx = createExecutionContext();
    await worker.scheduled({ scheduledTime: Date.now(), cron: "*/1 * * * *" } as ScheduledEvent, env, ctx);
    await waitOnExecutionContext(ctx);

    const status = JSON.parse((await env.MONITOR_KV.get("status"))!);
    expect(status.updates).toHaveLength(1);
    expect(status.updates[0].reason).toBe("🆕 新商品");
    expect(status.updates[0].product.id).toBe(2);
  });

  it("detects restocked products", async () => {
    await env.MONITOR_KV.put("products", JSON.stringify({
      "1": { hasStock: false, updated_at: 1000 },
    }));

    mockFetchProducts([
      { id: 1, name: "Product 1", description: "", category_name: "Cat", stock: 10, updated_at: 1000, price: 100, availableStock: 10 },
    ]);

    const ctx = createExecutionContext();
    await worker.scheduled({ scheduledTime: Date.now(), cron: "*/1 * * * *" } as ScheduledEvent, env, ctx);
    await waitOnExecutionContext(ctx);

    const status = JSON.parse((await env.MONITOR_KV.get("status"))!);
    expect(status.updates).toHaveLength(1);
    expect(status.updates[0].reason).toBe("📦 补货");
  });
});
