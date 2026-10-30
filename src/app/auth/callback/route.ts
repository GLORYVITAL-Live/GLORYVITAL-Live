import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * ที่อยู่เว็บที่ผู้ใช้เปิดอยู่ — หลังพร็อกซีของโฮสต์ (Render) request.url เป็นที่อยู่ภายในเครื่อง (http://localhost:10000)
 *   → ใช้ host ที่เบราว์เซอร์ส่งมา (x-forwarded-host / host) · localhost ตอนพัฒนา = ตาม request.url
 */
function publicOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return url.origin;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

// Google ส่งกลับมาที่นี่หลัง login แลก code เป็น session แล้วพากลับหน้าแรก
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = publicOrigin(request);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next.startsWith("/") ? next : "/"}`);
  }
  return NextResponse.redirect(`${origin}/?authError=1`);
}
