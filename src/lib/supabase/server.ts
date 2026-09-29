import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// ใช้ใน Server Components / Route Handlers / Server Actions (ทำงานในสิทธิ์ของผู้ใช้ที่ login)
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // เรียกจาก Server Component ตั้ง cookie ไม่ได้ ไม่เป็นไร proxy.ts รีเฟรช session ให้แล้ว
          }
        },
      },
    },
  );
}

// ใช้เฉพาะฝั่ง server เท่านั้น ข้าม RLS ได้ ห้าม import ในไฟล์ที่ส่งไป browser
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
