import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import worker from "../../src/index";

async function clearKV() {
  const keys = await env.MONITOR_KV.list();
  await Promise.all(keys.keys.map((k) => env.MONITOR_KV.delete(k.name)));
}

describe("API Routes", () => {
  beforeEach(clearKV);

  describe("OPTIONS", () => {
    it("returns CORS preflight response", async () => {
      const req = new Request("http://localhost/api/products", { method: "OPTIONS" });
      const res = await worker.fetch(req, env);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("GET /api/status", () => {
    it("returns empty status when no data", async () => {
      const req = new Request("http://localhost/api/status");
      const res = await worker.fetch(req, env);
      const data: any = await res.json();
      expect(data).toEqual({ timestamp: 0, totalProducts: 0, updates: [] });
    });

    it("returns stored status from KV", async () => {
      const status = { timestamp: 123456, totalProducts: 10, updates: [] };
      await env.MONITOR_KV.put("status", JSON.stringify(status));

      const req = new Request("http://localhost/api/status");
      const res = await worker.fetch(req, env);
      const data: any = await res.json();
      expect(data).toEqual(status);
    });
  });

  describe("POST /api/subscribe", () => {
    it("creates a new subscription with keywords", async () => {
      const body = {
        subscription: { endpoint: "https://push.example.com/1", expirationTime: null, keys: { p256dh: "k1", auth: "k2" } },
        keywords: ["google"],
        excludeKeywords: ["steam"],
      };

      const req = new Request("http://localhost/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(data.ok).toBe(true);
      expect(data.id).toBeDefined();

      const stored = await env.MONITOR_KV.get(`sub:${data.id}`);
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.keywords).toEqual(["google"]);
      expect(parsed.excludeKeywords).toEqual(["steam"]);
    });
  });

  describe("PUT /api/subscribe", () => {
    it("updates keywords for existing subscription", async () => {
      const sub = {
        subscription: { endpoint: "https://push.example.com/abc", expirationTime: null, keys: { p256dh: "k", auth: "a" } },
        keywords: ["old"],
        excludeKeywords: [],
      };
      await env.MONITOR_KV.put("sub:test-id", JSON.stringify(sub));

      const req = new Request("http://localhost/api/subscribe", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: "https://push.example.com/abc",
          keywords: ["new", "updated"],
          excludeKeywords: ["exclude"],
        }),
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);

      const updated = JSON.parse((await env.MONITOR_KV.get("sub:test-id"))!);
      expect(updated.keywords).toEqual(["new", "updated"]);
      expect(updated.excludeKeywords).toEqual(["exclude"]);
    });

    it("returns 404 when subscription not found", async () => {
      const req = new Request("http://localhost/api/subscribe", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "https://nonexistent.com", keywords: [], excludeKeywords: [] }),
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/subscribe", () => {
    it("deletes subscription by endpoint", async () => {
      const sub = {
        subscription: { endpoint: "https://push.example.com/xyz", expirationTime: null, keys: { p256dh: "k", auth: "a" } },
        keywords: [],
        excludeKeywords: [],
      };
      await env.MONITOR_KV.put("sub:del-test", JSON.stringify(sub));

      const req = new Request("http://localhost/api/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: "https://push.example.com/xyz" }),
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);

      const deleted = await env.MONITOR_KV.get("sub:del-test");
      expect(deleted).toBeNull();
    });
  });

  describe("GET /api/vapid-public-key", () => {
    it("returns the VAPID public key", async () => {
      const req = new Request("http://localhost/api/vapid-public-key");
      const res = await worker.fetch(req, env);
      const data: any = await res.json();
      expect(data).toHaveProperty("key");
    });
  });
});
