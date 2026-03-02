import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseJsonRequest } from "@/lib/utils/api";

const SA_PROVINCES = [
  "Eastern Cape",
  "Free State",
  "Gauteng",
  "KwaZulu-Natal",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
  "Western Cape",
] as const;

const verificationLocationSubmitSchema = z.object({
  province: z.enum(SA_PROVINCES, {
    message: "Invalid South African province",
  }),
  city: z.string().trim().min(1, "City is required"),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const parsed = verificationLocationSubmitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid location payload" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("seller_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: "Failed to load seller profile" }, { status: 500 });
    }

    if (!profile) {
      return NextResponse.json({ error: "Seller profile not found" }, { status: 404 });
    }

    const { province, city } = parsed.data;

    const { error: profileUpdateError } = await admin
      .from("seller_profiles")
      .update({
        location_province: province,
        location_city: city,
      })
      .eq("id", profile.id);

    if (profileUpdateError) {
      return NextResponse.json({ error: "Failed to save location" }, { status: 500 });
    }

    const { error: stepUpsertError } = await admin.from("verification_steps").upsert(
      {
        user_id: user.id,
        step_type: "location",
        status: "pending",
        submitted_at: new Date().toISOString(),
        location_province: province,
        location_city: city,
      },
      { onConflict: "user_id,step_type" }
    );

    if (stepUpsertError) {
      return NextResponse.json(
        { error: "Failed to submit location verification step" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
