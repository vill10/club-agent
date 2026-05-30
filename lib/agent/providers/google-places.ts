interface GooglePlace {
  displayName?: { text?: string };
  formattedAddress?: string;
  id?: string;
  location?: { latitude?: number; longitude?: number };
  nationalPhoneNumber?: string;
  websiteUri?: string;
}

export async function searchPlaces(
  query: string,
): Promise<
  {
    name: string;
    address: string;
    placeId: string;
    location: { lat: number; lng: number } | null;
    phone?: string;
    website?: string;
  }[]
> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("google places not configured");

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.id,places.location,places.nationalPhoneNumber,places.websiteUri",
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: {
        circle: {
          center: { latitude: 51.1605, longitude: 71.4704 },
          radius: 50000.0,
        },
      },
      languageCode: "ru",
    }),
  });

  if (!res.ok) throw new Error(`google places failed: ${res.status}`);

  const data = (await res.json()) as { places?: GooglePlace[] };
  const places = data.places ?? [];

  return places.map((p) => {
    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    const hasLocation = typeof lat === "number" && typeof lng === "number";
    // Defensive: phone/website fields may be absent on any given place.
    const phone =
      typeof p.nationalPhoneNumber === "string" && p.nationalPhoneNumber
        ? p.nationalPhoneNumber
        : undefined;
    const website =
      typeof p.websiteUri === "string" && p.websiteUri ? p.websiteUri : undefined;
    return {
      name: p.displayName?.text ?? "",
      address: p.formattedAddress ?? "",
      placeId: p.id ?? "",
      location: hasLocation ? { lat, lng } : null,
      ...(phone ? { phone } : {}),
      ...(website ? { website } : {}),
    };
  });
}
