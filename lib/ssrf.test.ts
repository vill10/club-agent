import { test, expect } from "vitest";
import { assertSafeUrl } from "./ssrf";
test("blocks private + metadata + non-https", async () => {
  await expect(assertSafeUrl("http://example.com")).rejects.toThrow();        // not https
  await expect(assertSafeUrl("https://169.254.169.254/")).rejects.toThrow();  // metadata
  await expect(assertSafeUrl("https://localhost/")).rejects.toThrow();
  await expect(assertSafeUrl("https://10.0.0.1/")).rejects.toThrow();         // RFC1918
});
test("allows a public https host", async () => {
  await expect(assertSafeUrl("https://2gis.kz/astana")).resolves.toBeUndefined();
});
