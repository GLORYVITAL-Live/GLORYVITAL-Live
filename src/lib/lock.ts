import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ทำงานภายใต้ล็อกชื่อ name (ตาราง sync_locks) ให้มีงานแบบเดียวกันทำได้ทีละหนึ่ง
 * รอได้ไม่เกิน waitMs ถ้ายังไม่ได้ล็อก คืน null (ไม่ทำงาน)
 * ล็อกหมดอายุเองใน 90 วินาที กันค้างถ้าคำขอที่ถือล็อกตายกลางทาง
 */
export async function withSyncLock<T>(name: string, fn: () => Promise<T>, waitMs = 25_000): Promise<T | null> {
  const db = createAdminClient();
  const holder = crypto.randomUUID();
  const deadline = Date.now() + waitMs;
  for (;;) {
    const { data, error } = await db.rpc("try_sync_lock", { p_name: name, p_seconds: 90, p_holder: holder });
    if (error) throw error;
    if (data) break;
    if (Date.now() > deadline) return null;
    await sleep(700);
  }
  try {
    return await fn();
  } finally {
    await db.rpc("release_sync_lock", { p_name: name, p_holder: holder });
  }
}
