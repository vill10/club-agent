// Intent extraction: free-text parent query (Russian / Kazakh / English) →
// structured Intent. Makes ONE Haiku call via the shared callHaikuJSON helper
// (zod-validated, retries once, returns a fallback rather than throwing).
// The required fields (category, age) are NEVER guessed — if the user did not
// state them, they come back present:false so the UI can prompt.

import { z } from "zod";
import { callHaikuJSON } from "@/lib/agent/haiku";
import type { Category, Intent } from "@/types";

const categoryEnum = z.enum([
  "sport",
  "art",
  "music",
  "language",
  "coding",
  "dance",
  "chess",
  "other",
]);
const confidenceEnum = z.enum(["high", "medium", "low"]);

function intentFieldSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    value: valueSchema.nullable(),
    present: z.boolean(),
    confidence: confidenceEnum,
  });
}

const intentSchema = z.object({
  category: intentFieldSchema(categoryEnum),
  activity: intentFieldSchema(z.string()),
  age: intentFieldSchema(z.string()),
  district: intentFieldSchema(z.string()),
  budget: intentFieldSchema(z.string()),
  schedule: intentFieldSchema(z.string()),
  hardRequirements: intentFieldSchema(z.array(z.string())),
});

// All-absent Intent. Used as the callHaikuJSON fallback and as a base we can
// safely return when extraction fully fails — the UI then asks for everything.
function absentIntent(): Intent {
  const field = <T>() => ({ value: null as T | null, present: false, confidence: "low" as const });
  return {
    category: field<Category>(),
    activity: field<string>(),
    age: field<string>(),
    district: field<string>(),
    budget: field<string>(),
    schedule: field<string>(),
    hardRequirements: { value: [] as string[], present: false, confidence: "low" as const },
  };
}

const SYSTEM = `You extract a structured search intent from a parent's free-text query for kids' clubs/activities in Astana, Kazakhstan. The query may be in Russian, Kazakh, or English.

Output ONLY a JSON object (no prose, no code fences) with EXACTLY this shape:
{
  "category":         { "value": <enum|null>,      "present": <bool>, "confidence": "high"|"medium"|"low" },
  "activity":         { "value": <string|null>,    "present": <bool>, "confidence": "high"|"medium"|"low" },
  "age":              { "value": <string|null>,    "present": <bool>, "confidence": "high"|"medium"|"low" },
  "district":         { "value": <string|null>,    "present": <bool>, "confidence": "high"|"medium"|"low" },
  "budget":           { "value": <string|null>,    "present": <bool>, "confidence": "high"|"medium"|"low" },
  "schedule":         { "value": <string|null>,    "present": <bool>, "confidence": "high"|"medium"|"low" },
  "hardRequirements": { "value": <string[]|null>,  "present": <bool>, "confidence": "high"|"medium"|"low" }
}

Rules:
- Extract ONLY what is explicitly present (or unambiguously inferable) in the query. NEVER invent or guess.
- category MUST be one of: "sport" | "art" | "music" | "language" | "coding" | "dance" | "chess" | "other". Pick the best fit. Robotics/programming/STEM → "coding". Swimming/football/etc. → "sport". Use "other" only if nothing fits. If the activity is not stated at all, set present:false.
- activity: the SPECIFIC discipline/activity the user named, in their own words, e.g. "плавание" (swimming), "робототехника" (robotics), "гитара" (guitar), "футбол" (football). This is the precise thing they want, distinct from the coarse "category" bucket. When the user names a specific activity → present:true, confidence:high (or medium if only inferable). When the user gives ONLY a broad category (e.g. "спорт", "что-нибудь творческое") with no specific discipline → present:false, value:null. NEVER invent an activity the user did not name.
- age: a single age like "8" or a range like "6-9", as a string. If not stated, present:false.
- For ANY field NOT stated in the query: set "present": false, "value": null (or [] for hardRequirements), "confidence": "low". Do this for category and age too — do NOT guess the required fields.
- For stated fields: "present": true. confidence "high" when explicit, "medium" when inferred.
- district: an Astana district/area as stated, e.g. "левый берег".
- budget: a short price constraint, e.g. "≤30000₸/мес" or "недорого".
- schedule: a short timing constraint, e.g. "вечером, будни".
- hardRequirements: an array of short must-have constraints, e.g. ["женский тренер", "рядом с метро"]. Empty/absent → present:false, value [].
- Preserve the user's wording (in its original language) for free-text values.`;

/**
 * Extract a structured Intent from a free-text parent query.
 * Makes one Haiku call. Never throws — on extraction failure returns an
 * all-absent Intent (every field present:false / low confidence).
 */
export async function extractIntent(rawQuery: string): Promise<Intent> {
  const parsed = await callHaikuJSON<z.infer<typeof intentSchema>>(
    SYSTEM,
    `Query:\n${rawQuery}`,
    intentSchema,
    absentIntent() as z.infer<typeof intentSchema>,
  );
  return parsed as Intent;
}
