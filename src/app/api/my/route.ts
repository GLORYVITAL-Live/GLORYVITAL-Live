import { fail, monthRange, ok, requireMe } from "@/lib/api";
import { withPlatformLabels } from "@/lib/platform";
import { getSettings, mySlots } from "@/lib/data";
import { framesForSlots } from "@/lib/live-frames";
import { isLiveRoom, roomForPlatform } from "@/lib/loans";
import { cleanTiers } from "@/lib/pay";
import { paymentsOf } from "@/lib/pay-months";
import { lockedRates } from "@/lib/pay-rates";
import { createAdminClient } from "@/lib/supabase/server";
import type { BriefView, FrameFile } from "@/lib/types";

// "ตารางของฉัน" รายเดือน (?role=mc|admin&month=YYYY-MM) — แทน action "mySlots" / "adminMySlots"
// + โปรไฟล์ของตัวเอง และค่าจ้างต่อชั่วโมง (ของคนนี้ ไม่ตั้ง = ค่าเริ่มต้นใน settings เหมือนหน้าสรุปของเจ้าของ)
export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const params = new URL(request.url).searchParams;
  const role = params.get("role");
  const { key, first, last } = monthRange(params.get("month"));

  const person = role === "mc" ? r.me.mc : role === "admin" ? r.me.admin : null;
  if (!person) return fail("บัญชีนี้ไม่มีสิทธิ์ดูตารางนี้", 403);

  const db = createAdminClient();
  const [settings, items, staff, rooms, locked, paid, shopeeRow] = await Promise.all([
    getSettings(),
    mySlots(role as "mc" | "admin", person.id, first, last),
    db.from("staff").select("name, email, phone, hourly_rate, commit_tiers, is_salaried").eq("id", person.id).single(),
    // ห้องไลฟ์ (ตำแหน่งอุปกรณ์ที่ชื่อขึ้นต้น "ห้องไลฟ์") ไว้บอกในรายละเอียด slot · โหลดไม่ได้ = ไม่บอกห้อง
    db.from("equipment").select("location").ilike("location", "%ห้องไลฟ์%"),
    // เรทที่ล็อกไว้ของเดือนนี้ (เปลี่ยนเรทภายหลัง / โอนแล้ว) + การโอน — ตัวเลขเดียวกับหน้าสรุปของเจ้าของ
    lockedRates(key, [person.id]),
    paymentsOf(key, [person.id]),
    // ค่าจ้าง Shopee (Mc · ยังไม่ได้รัน SQL 20261116000000_shopee_rate = ไม่มี)
    role === "mc" ? db.from("staff").select("shopee_rate").eq("id", person.id).maybeSingle() : Promise.resolve(null),
  ]);
  if (staff.error) return fail(staff.error.message, 500);
  const roomNames = [...new Set((rooms.data ?? []).map((x) => String(x.location)).filter(isLiveRoom))];
  // เฟรมไลฟ์ + บรีฟการแต่งตัวของช่อง + วัน (ชื่อช่องเดิม GLORY MALL) · อ่านชีตเฟรมไม่ได้ = ไม่แสดง
  const frames = await framesForSlots(items.filter((i) => !i.cancelled).map((i) => ({ platform: i.platform, date: i.date })))
    .catch(() => new Map<string, { frame: FrameFile | null; brief: BriefView | null }>());
  const defaultRate = Number(role === "mc" ? settings.default_mc_rate : settings.default_admin_rate) || 0;
  const lock = locked.get(person.id);
  const salaried = lock ? lock.salaried : !!staff.data.is_salaried;

  return ok({
    month: key,
    cancelMinHours: Number(settings.cancel_min_hours),
    adminChatUrl: settings.admin_chat_url,
    canCancel: role === "mc" || !!r.me.admin?.isExtra,
    // หาห้องจากชื่อช่องเดิมก่อน (GLORY MALL) แล้วค่อยเปลี่ยนเป็นชื่อช่องที่แสดง (ชีตยังใช้ชื่อเดิม)
    items: withPlatformLabels(items.map((i) => ({
      ...i, room: roomForPlatform(i.platform, roomNames), ...(frames.get(`${i.platform}|${i.date}`) ?? {}),
    }))),
    profile: {
      name: role === "mc" ? `Mc ${staff.data.name}` : staff.data.name,
      email: staff.data.email ?? r.me.email,
      phone: staff.data.phone ?? "",
      // Mc ประจำ / Admin ประจำ (เงินเดือน) ไม่คิดค่าจ้างรายชั่วโมง
      rate: salaried ? 0 : lock ? lock.rate : Number(staff.data.hourly_rate) || defaultRate,
      commitTiers: salaried ? [] : lock ? lock.tiers : cleanTiers(staff.data.commit_tiers),
      // ค่าจ้างคิว Shopee ที่ตั้งแยก (null = เท่ากับ TikTok) — ตัวเลขเดียวกับหน้าสรุปของเจ้าของ (src/lib/pay.ts platformRates)
      shopeeRate: salaried ? null : lock ? lock.shopeeRate : Number(shopeeRow?.data?.shopee_rate) || null,
    },
    payments: (paid.map.get(person.id) ?? []).map((p) => ({ amount: p.amount, paidOn: p.paidOn })),
  });
}
