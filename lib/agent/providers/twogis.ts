export class RateLimitError extends Error {}

interface TwoGisContact {
  type?: string;
  value?: string;
}

interface TwoGisContactGroup {
  contacts?: TwoGisContact[];
}

interface TwoGisItem {
  id?: string;
  name?: string;
  full_name?: string;
  address_name?: string;
  contact_groups?: TwoGisContactGroup[];
}

interface TwoGisResponse {
  result?: { items?: TwoGisItem[] };
}

export async function query2gis(
  category: string,
  district?: string,
): Promise<{ name: string; address: string; phones: string[]; url: string }[]> {
  const apiKey = process.env.TWOGIS_API_KEY;
  if (!apiKey) throw new Error("2gis not configured");

  const params = new URLSearchParams({
    q: [category, district, "Астана"].filter(Boolean).join(" "),
    key: apiKey,
    fields: "items.point,items.contact_groups,items.address,items.full_name",
    page_size: "10",
  });

  const res = await fetch(
    `https://catalog.api.2gis.com/3.0/items?${params.toString()}`,
  );

  if (res.status === 429 || res.status === 403) {
    throw new RateLimitError("2gis rate limited");
  }
  if (!res.ok) throw new Error(`2gis failed: ${res.status}`);

  const data = (await res.json()) as TwoGisResponse;
  const items = data.result?.items ?? [];

  return items.map((item) => {
    const phones: string[] = [];
    for (const group of item.contact_groups ?? []) {
      for (const contact of group.contacts ?? []) {
        if (contact.type === "phone" && contact.value) {
          phones.push(contact.value);
        }
      }
    }

    const url = item.id
      ? `https://2gis.kz/astana/firm/${item.id.split("_")[0]}`
      : "";

    return {
      name: item.full_name ?? item.name ?? "",
      address: item.address_name ?? "",
      phones,
      url,
    };
  });
}
