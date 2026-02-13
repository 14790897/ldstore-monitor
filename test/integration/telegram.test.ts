import { describe, it, expect, beforeEach, vi } from "vitest";
import { env } from "cloudflare:test";
import worker from "../../src/index";

async function clearKV() {
  const keys = await env.MONITOR_KV.list();
  await Promise.all(keys.keys.map((k) => env.MONITOR_KV.delete(k.name)));
}

function telegramWebhook(chatId: number, text: string) {
  return new Request("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: { chat: { id: chatId }, text },
    }),
  });
}

describe("Telegram Webhook", () => {
  beforeEach(clearKV);

  describe("/start", () => {
    it("creates subscription in KV", async () => {
      const res = await worker.fetch(telegramWebhook(111, "/start"), env);
      expect(res.status).toBe(200);

      const stored = await env.MONITOR_KV.get("tg:111");
      expect(stored).toBeTruthy();
      const data = JSON.parse(stored!);
      expect(data.chatId).toBe(111);
      expect(data.keywords).toEqual([]);
      expect(data.excludeKeywords).toEqual([]);
    });

    it("does not overwrite existing subscription", async () => {
      await env.MONITOR_KV.put("tg:111", JSON.stringify({
        chatId: 111, keywords: ["京东"], excludeKeywords: [],
      }));

      await worker.fetch(telegramWebhook(111, "/start"), env);

      const data = JSON.parse((await env.MONITOR_KV.get("tg:111"))!);
      expect(data.keywords).toEqual(["京东"]);
    });
  });

  describe("/subscribe", () => {
    it("sets keywords", async () => {
      await worker.fetch(telegramWebhook(222, "/start"), env);
      await worker.fetch(telegramWebhook(222, "/subscribe 京东 E卡 Steam"), env);

      const data = JSON.parse((await env.MONITOR_KV.get("tg:222"))!);
      expect(data.keywords).toEqual(["京东", "E卡", "Steam"]);
    });

    it("creates subscription if not exists", async () => {
      await worker.fetch(telegramWebhook(333, "/subscribe 谷歌"), env);

      const data = JSON.parse((await env.MONITOR_KV.get("tg:333"))!);
      expect(data.chatId).toBe(333);
      expect(data.keywords).toEqual(["谷歌"]);
    });
  });

  describe("/exclude", () => {
    it("sets exclude keywords", async () => {
      await worker.fetch(telegramWebhook(444, "/start"), env);
      await worker.fetch(telegramWebhook(444, "/exclude 测试 pro"), env);

      const data = JSON.parse((await env.MONITOR_KV.get("tg:444"))!);
      expect(data.excludeKeywords).toEqual(["测试", "pro"]);
    });
  });

  describe("/unsubscribe", () => {
    it("deletes subscription from KV", async () => {
      await env.MONITOR_KV.put("tg:555", JSON.stringify({
        chatId: 555, keywords: [], excludeKeywords: [],
      }));

      await worker.fetch(telegramWebhook(555, "/unsubscribe"), env);

      const stored = await env.MONITOR_KV.get("tg:555");
      expect(stored).toBeNull();
    });
  });

  describe("/status", () => {
    it("returns current settings", async () => {
      await env.MONITOR_KV.put("tg:666", JSON.stringify({
        chatId: 666, keywords: ["京东"], excludeKeywords: ["测试"],
      }));

      const res = await worker.fetch(telegramWebhook(666, "/status"), env);
      expect(res.status).toBe(200);
    });

    it("returns not subscribed message when no subscription", async () => {
      const res = await worker.fetch(telegramWebhook(777, "/status"), env);
      expect(res.status).toBe(200);
    });
  });

  it("ignores non-command messages", async () => {
    const res = await worker.fetch(telegramWebhook(888, "hello"), env);
    expect(res.status).toBe(200);

    const stored = await env.MONITOR_KV.get("tg:888");
    expect(stored).toBeNull();
  });

  it("handles missing message gracefully", async () => {
    const req = new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 123 }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
  });
});
