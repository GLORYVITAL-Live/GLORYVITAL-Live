import { createBrowserClient } from "@supabase/ssr";

// ใช้ในฝั่ง browser (Client Components)
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
