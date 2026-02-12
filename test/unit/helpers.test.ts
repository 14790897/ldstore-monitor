import { describe, it, expect } from "vitest";
import { json, cors } from "../../src/index";

describe("json", () => {
  it("returns JSON response with default 200 status", async () => {
    const res = json({ success: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ success: true });
  });

  it("returns JSON response with custom status", () => {
    const res = json({ error: "Not found" }, 404);
    expect(res.status).toBe(404);
  });

  it("includes CORS headers", () => {
    const res = json({});
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
  });
});

describe("cors", () => {
  it("returns CORS preflight response", () => {
    const res = cors();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(res.headers.get("Access-Control-Allow-Headers")).toContain("Content-Type");
  });
});
