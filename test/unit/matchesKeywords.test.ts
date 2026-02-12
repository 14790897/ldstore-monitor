import { describe, it, expect } from "vitest";
import { matchesKeywords } from "../../src/index";

function createSub(keywords: string[], excludeKeywords: string[] = []) {
  return {
    subscription: { endpoint: "", expirationTime: null, keys: { p256dh: "", auth: "" } },
    keywords,
    excludeKeywords,
  };
}

describe("matchesKeywords", () => {
  it("returns true when keywords array is empty", () => {
    expect(matchesKeywords("anything", createSub([]))).toBe(true);
  });

  it("matches keyword case-insensitively", () => {
    expect(matchesKeywords("Apple iPhone 15", createSub(["iphone"]))).toBe(true);
    expect(matchesKeywords("Apple iPhone 15", createSub(["IPHONE"]))).toBe(true);
  });

  it("returns false when no keyword matches", () => {
    expect(matchesKeywords("Samsung Galaxy", createSub(["iphone", "pixel"]))).toBe(false);
  });

  it("returns true when any keyword matches", () => {
    expect(matchesKeywords("Google Pixel 8", createSub(["iphone", "pixel"]))).toBe(true);
  });

  it("returns false when exclude keyword matches", () => {
    expect(matchesKeywords("iPhone 15 Pro", createSub(["iphone"], ["pro"]))).toBe(false);
  });

  it("returns true when keyword matches and exclude does not", () => {
    expect(matchesKeywords("iPhone 15", createSub(["iphone"], ["pro"]))).toBe(true);
  });

  it("handles Chinese characters", () => {
    expect(matchesKeywords("谷歌账号 Gmail", createSub(["谷歌"]))).toBe(true);
    expect(matchesKeywords("Steam 充值卡", createSub(["谷歌"]))).toBe(false);
  });
});
