import { NextResponse } from "next/server";
import { isFoundingForSession } from "@/lib/founding";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ isFounding: false, signedIn: false });
  }

  const isFounding = await isFoundingForSession(supabase);
  return NextResponse.json({
    isFounding,
    signedIn: true,
    email: user.email,
  });
}
