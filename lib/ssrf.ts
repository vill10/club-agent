import { lookup } from "node:dns/promises";
import net from "node:net";

function isPrivate(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }
  // IPv6: block loopback, link-local, ULA
  const lo = ip.toLowerCase();
  return lo === "::1" || lo.startsWith("fe80") || lo.startsWith("fc") || lo.startsWith("fd");
}

export async function assertSafeUrl(raw: string): Promise<void> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("invalid url"); }
  if (u.protocol !== "https:") throw new Error("only https allowed");
  const host = u.hostname;
  if (host === "localhost") throw new Error("blocked host");
  const { address } = await lookup(host);
  if (isPrivate(address)) throw new Error("blocked private ip");
}
