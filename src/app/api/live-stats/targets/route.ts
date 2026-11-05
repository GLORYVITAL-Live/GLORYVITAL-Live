import { fail, ok, requireAnalytics } from "@/lib/api";
import { PLATFORMS } from "@/lib/live-stats";
import { cleanTarget, type LiveTarget } from "@/lib/live-targets";
import { createAdminClient } from "@/lib/supabase/server";

// เป้า GMV รายเดือนต่อช่องไลฟ์ (หน้าสถิติไลฟ์ > ภาพรวม)
//   GET ?month=YYYY-MM                                        เป้าของเดือนนั้น (ready false = ยังไม่ได้รัน SQL)
//   PUT { month, items: [{ platform, accountId, name, monthly, days }] }   บันทึกเฉพาะช่องที่ส่งมา (monthly ว่าง = ลบเป้าของช่องนั้น)

const TARGET_SQL = "ต้องรัน SQL 20261122000000_live_targets ใน Supabase ก่อน";
const noSql = (msg: string) => /live_targets|schema cache|does not exist/i.test(msg);

export async function GET(request: Request) {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์ดูสถิติไลฟ์", "read");
  if ("res" in r) return r.res;
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return fail("เดือนไม่ถูกต้อง");
  const { data, error } = await createAdminClient().from("live_targets").select("platform, account_id, month, monthly, days").eq("month", month);
  if (error) return noSql(error.message) ? ok({ ready: false, targets: [] }) : fail(error.message, 500);
  const targets: LiveTarget[] = (data ?? []).map((t) => ({
    platform: String(t.platform), accountId: String(t.account_id), month: String(t.month), monthly: Number(t.monthly),
    days: Object.fromEntries(Object.entries((t.days ?? {}) as Record<string, unknown>).map(([d, v]) => [d, Number(v)])),
  }));
  return ok({ ready: true, targets });
}

export async function PUT(request: Request) {
  const r = await requireAnalytics("บัญชีนี้ไม่มีสิทธิ์ตั้งเป้าสถิติไลฟ์");
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const list: unknown[] = Array.isArray(body?.items) ? body.items.slice(0, 50) : [];
  if (!list.length) return fail("ไม่มีช่องไลฟ์ให้บันทึก");

  const by = r.me.owner?.name || r.me.email;
  const now = new Date().toISOString();
  const saves: Record<string, unknown>[] = [];
  const removes: { platform: string; accountId: string }[] = [];
  const logs: string[] = [];
  let month = "";
  for (const raw of list) {
    const x = raw as { platform?: unknown; accountId?: unknown; name?: unknown; monthly?: unknown; days?: unknown };
    const platform = PLATFORMS.find((p) => p === x.platform);
    const accountId = typeof x.accountId === "string" ? x.accountId.trim().slice(0, 200) : "";
    const name = String(x.name ?? accountId).slice(0, 100);
    if (!platform || !accountId) return fail("ข้อมูลช่องไลฟ์ไม่ถูกต้อง");
    const c = cleanTarget(body?.month, name, x.monthly, x.days);
    if ("error" in c) return fail(c.error);
    month = c.month;
    if (c.monthly) {
      saves.push({ platform, account_id: accountId, month: c.month, monthly: c.monthly, days: c.days, updated_by: by, updated_at: now });
      const manual = Object.keys(c.days).length;
      logs.push(`${name} ${c.monthly.toLocaleString("th-TH")}${manual ? ` (ใส่เอง ${manual} วัน)` : ""}`);
    } else removes.push({ platform, accountId });
  }

  const db = createAdminClient();
  if (saves.length) {
    const { error } = await db.from("live_targets").upsert(saves, { onConflict: "platform,account_id,month" });
    if (error) return fail(noSql(error.message) ? TARGET_SQL : error.message, noSql(error.message) ? 409 : 500);
  }
  for (const x of removes) {
    const { error } = await db.from("live_targets").delete().eq("platform", x.platform).eq("account_id", x.accountId).eq("month", month);
    if (error) return fail(noSql(error.message) ? TARGET_SQL : error.message, noSql(error.message) ? 409 : 500);
  }
  await db.from("booking_logs").insert({
    email: r.me.email, role: "Owner", name: r.me.owner?.name ?? "",
    action: `ตั้งเป้า GMV ${month}: ${logs.join(" · ") || "ไม่มีเป้า"}`.slice(0, 500), result: "สำเร็จ",
  });
  return ok({ message: "บันทึกเป้าแล้ว" });
}
