import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Magic-link / OTP callback.
 * Cookies must be written onto the redirect response, or the browser never
 * receives the session even when exchange succeeds.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextPath = searchParams.get("next") ?? "/";

  const successUrl = new URL(nextPath, origin);
  successUrl.searchParams.set("signed_in", "1");
  const successResponse = NextResponse.redirect(successUrl.toString());

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            successResponse.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return successResponse;
    }
    console.error("[auth/callback] exchangeCodeForSession", error.message);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return successResponse;
    }
    console.error("[auth/callback] verifyOtp", error.message);
  }

  const failUrl = new URL("/", origin);
  failUrl.searchParams.set("auth_error", "1");
  if (!code && !tokenHash) {
    failUrl.searchParams.set("auth_reason", "missing_code");
  } else {
    failUrl.searchParams.set("auth_reason", "exchange_failed");
  }
  return NextResponse.redirect(failUrl.toString());
}
