import { ok, requireMe } from "@/lib/api";
import { badgesFor } from "@/lib/badges";
import type { Badges } from "@/lib/types";

// ป้ายตัวเลขงานค้างบนเมนู (src/lib/badges.ts) — เว็บเรียกตอนเปิด / เปลี่ยนหน้า / กลับมาที่แท็บ / ทุก 5 นาที
export async function GET() {
  const r = await requireMe();
  if ("res" in r) return r.res;
  return ok<{ badges: Badges }>({ badges: await badgesFor(r.me) });
}
