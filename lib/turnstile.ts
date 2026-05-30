const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  token: string,
  ip?: string,
): Promise<boolean> {
  if (process.env.TURNSTILE_DEV_BYPASS === "true") return true;

  try {
    const body = new URLSearchParams();
    body.set("secret", process.env.TURNSTILE_SECRET_KEY ?? "");
    body.set("response", token);
    if (ip) body.set("remoteip", ip);

    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
