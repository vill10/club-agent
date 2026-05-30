import { getDailyBudget } from "@/lib/budget";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getDailyBudget(), { status: 200 });
}
