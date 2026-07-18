import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function signOutAndRedirect(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url));
}

export async function POST(request: Request) {
  return signOutAndRedirect(request);
}

export async function GET(request: Request) {
  return signOutAndRedirect(request);
}
