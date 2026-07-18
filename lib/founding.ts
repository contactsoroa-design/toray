import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export {
  FOUNDING_VISION_PROVIDERS,
  FREE_VISION_PROVIDERS,
  foundingVisionUnlockLabel,
  isVisionProvider,
  visionProviderToToolName,
  type VisionProvider,
} from "@/lib/vision-providers";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Server check via service role (webhook / offline email lookup). */
export async function isFoundingEmail(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  const admin = createAdminClient();
  if (!admin) return false;

  const { data } = await admin
    .from("founding_members")
    .select("email")
    .eq("email", normalizeEmail(email))
    .eq("status", "active")
    .maybeSingle();

  return Boolean(data?.email);
}

/** Prefer this for signed-in requests — uses RLS, no service role required. */
export async function isFoundingForSession(
  supabase: SupabaseClient,
): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return false;

  const { data } = await supabase
    .from("founding_members")
    .select("email")
    .eq("email", normalizeEmail(user.email))
    .eq("status", "active")
    .maybeSingle();

  return Boolean(data?.email);
}

export async function markFoundingMember(args: {
  email: string;
  stripeCustomerId?: string | null;
  stripeSessionId?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  if (!admin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  const email = normalizeEmail(args.email);
  const { error } = await admin.from("founding_members").upsert(
    {
      email,
      stripe_customer_id: args.stripeCustomerId ?? null,
      stripe_session_id: args.stripeSessionId ?? null,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email" },
  );

  if (error) throw error;
}

export async function readFoundingForUser(
  supabase: SupabaseClient,
): Promise<boolean> {
  return isFoundingForSession(supabase);
}
