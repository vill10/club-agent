interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

export async function searchWeb(
  query: string,
): Promise<{ title: string; url: string; snippet: string }[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("tavily not configured");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 10,
      search_depth: "basic",
    }),
  });

  if (!res.ok) throw new Error(`tavily failed: ${res.status}`);

  const data = (await res.json()) as { results?: TavilyResult[] };
  const results = data.results ?? [];

  return results.map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}
