import { fail, monthRange, ok, requireMe } from "@/lib/api";
import { cancelLinesOf } from "@/lib/cancel-rule";
import { withPlatformLabels } from "@/lib/platform";
import { getSettings, mySlots, recentBookings } from "@/lib/data";
import { framesForSlots } from "@/lib/live-frames";
import { isLiveRoom, roomForPlatform } from "@/lib/loans";
import { cleanTiers, platformRates, slotPay, travelPicks } from "@/lib/pay";
import { paymentsOf } from "@/lib/pay-months";
import { lockedRates } from "@/lib/pay-rates";
import { mySlips } from "@/lib/slips-db";
import { createAdminClient } from "@/lib/supabase/server";
import type { BriefView, FrameFile, MySubItem } from "@/lib/types";

/**
 * Mc ในเครือที่จ่ายค่าตัวผ่านคนนี้ (staff.pay_to_id — SQL 20261117000000_pay_to): ยอดของเดือนนี้ (สูตรเดียวกับสรุปของเจ้าของ)
 *   ยังไม่ได้รัน SQL / ไม่มี = []
 */
async function subsPay(payeeId: number, key: string, first: string, last: string, defaultRate: number) {
  const db = createAdminClient();
  const { data, error } = await db.from("staff").select("id, name, hourly_rate, commit_tiers, is_salaried").eq("pay_to_id", payeeId);
  if (error || !data?.length) return [];
  const [locked, shopee] = await Promise.all([
    lockedRates(key, data.map((s) => Number(s.id))),
    db.from("staff").select("id, shopee_rate").in("id", data.map((s) => s.id)),
  ]);
  const shopeeOf = new Map((shopee.error ? [] : shopee.data ?? []).map((s) => [Number(s.id), Number(s.shopee_rate) || null]));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return Promise.all(data.map(async (s) => {
    const items = (await mySlots("mc", Number(s.id), first, last)).filter((i) => !i.cancelled);
    const hours = items.reduce((a, i) => a + i.hours, 0), shopeeHours = items.filter((i) => i.shopee).reduce((a, i) => a + i.hours, 0);
    const lock = locked.get(Number(s.id));
    const salaried = lock ? lock.salaried : !!s.is_salaried;
    const m = platformRates(
      salaried ? 0 : lock ? lock.rate : Number(s.hourly_rate) || defaultRate, salaried ? [] : lock ? lock.tiers : cleanTiers(s.commit_tiers),
      salaried ? null : lock ? lock.shopeeRate : shopeeOf.get(Number(s.id)) ?? null, hours - shopeeHours, shopeeHours,
    );
    // รายการคิวให้คนรับเงินดูแทน (ผู้ใช้ขอ 2026-11-16: Mc ในเครือที่ไม่มีอีเมล ล็อกอินดูคิวเองไม่ได้) · เงินต่อคิวสูตรเดียวกับยอดรวม
    const list: MySubItem[] = items.map((i) => ({
      id: i.id, date: i.date, start: i.start, end: i.end, platform: i.platform, hours: i.hours, endMs: i.endMs,
      pay: slotPay(i.hours, i.lateMinutes, i.bonusMinutes, i.shopee ? m.shopeeRate : m.rate),
    }));
    const pay = list.reduce((a, i) => a + i.pay, 0);
    return { name: `Mc ${s.name}`, slots: items.length, hours: r2(hours), pay, items: list };
  }));
}

// "ตารางของฉัน" รายเดือน (?role=mc|admin&month=YYYY-MM) — แทน action "mySlots" / "adminMySlots"
// + โปรไฟล์ของตัวเอง และค่าจ้างต่อชั่วโมง (ของคนนี้ ไม่ตั้ง = ค่าเริ่มต้นใน settings เหมือนหน้าสรุปของเจ้าของ)
// + Mc ในเครือที่จ่ายค่าตัวผ่านคนนี้ (subs) — ยอดรวมอยู่ในยอดที่ต้องได้ / การโอน
export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const params = new URL(request.url).searchParams;
  const role = params.get("role");
  const { key, first, last } = monthRange(params.get("month"));

  const person = role === "mc" ? r.me.mc : role === "admin" ? r.me.admin : null;
  if (!person) return fail("บัญชีนี้ไม่มีสิทธิ์ดูตารางนี้", 403);

  const db = createAdminClient();
  const [settings, items, staff, rooms, locked, paid, extraRow] = await Promise.all([
    getSettings(),
    mySlots(role as "mc" | "admin", person.id, first, last),
    db.from("staff").select("name, email, phone, hourly_rate, commit_tiers, is_salaried").eq("id", person.id).single(),
    // ห้องไลฟ์ (ตำแหน่งอุปกรณ์ที่ชื่อขึ้นต้น "ห้องไลฟ์") ไว้บอกในรายละเอียด slot · โหลดไม่ได้ = ไม่บอกห้อง
    db.from("equipment").select("location").ilike("location", "%ห้องไลฟ์%"),
    // เรทที่ล็อกไว้ของเดือนนี้ (เปลี่ยนเรทภายหลัง / โอนแล้ว) + การโอน — ตัวเลขเดียวกับหน้าสรุปของเจ้าของ
    lockedRates(key, [person.id]),
    paymentsOf(key, [person.id]),
    // ค่าจ้าง Shopee (Mc · ยังไม่ได้รัน SQL 20261116000000_shopee_rate = ไม่มี) / ค่ารถ (Admin · ยังไม่ได้รัน SQL 20261119000000_admin_travel = ไม่มี)
    db.from("staff").select(role === "mc" ? "shopee_rate" : "travel_allowance").eq("id", person.id)
      .maybeSingle().overrideTypes<{ shopee_rate?: number | null; travel_allowance?: number | null } | null, { merge: false }>(),
  ]);
  if (staff.error) return fail(staff.error.message, 500);
  const roomNames = [...new Set((rooms.data ?? []).map((x) => String(x.location)).filter(isLiveRoom))];
  // เฟรมไลฟ์ + บรีฟการแต่งตัวของช่อง + วัน (ชื่อช่องเดิม GLORY MALL) · อ่านชีตเฟรมไม่ได้ = ไม่แสดง
  const frames = await framesForSlots(items.filter((i) => !i.cancelled).map((i) => ({ platform: i.platform, date: i.date })))
    .catch(() => new Map<string, { frame: FrameFile | null; brief: BriefView | null }>());
  const defaultRate = Number(role === "mc" ? settings.default_mc_rate : settings.default_admin_rate) || 0;
  const lock = locked.get(person.id);
  const salaried = lock ? lock.salaried : !!staff.data.is_salaried;
  const now = Date.now();
  const upcoming = items.filter((i) => !i.cancelled && i.startMs > now).map((i) => i.id);
  const [subs, slips, booked] = await Promise.all([
    role === "mc" ? subsPay(person.id, key, first, last, defaultRate).catch(() => []) : [],
    // สลิปโอนเงินจากโฟลเดอร์ Slip ใน Drive (ทุกรอบ · ยังไม่ได้รัน SQL = ว่าง)
    mySlips(person.id),
    // คิวที่เพิ่งจอง / รับเองไม่เกิน 15 นาที = ยกเลิกได้แม้ช่วงกลางคืน (src/lib/cancel-rule.ts · เซิร์ฟเวอร์ตรวจซ้ำตอนกดยกเลิก)
    upcoming.length ? recentBookings(r.me.email, role as "mc" | "admin", upcoming).catch(() => new Map<number, number>()) : new Map<number, number>(),
  ]);
  // ค่ารถ (Admin ที่ติ๊กได้ค่ารถ): คิวเลิก 23:30 วันละครั้ง — ตัวเลขเดียวกับสรุปของเจ้าของ (src/lib/data.ts ownerSummary)
  const travel = role !== "admin" || salaried ? null : lock ? lock.travel : Number(extraRow.data?.travel_allowance) || null;
  const picks = new Set(travel ? travelPicks(items) : []);

  return ok({
    month: key,
    cancelMinHours: Number(settings.cancel_min_hours),
    adminChatUrl: settings.admin_chat_url,
    // ยกเลิกช่วงกลางคืน: LINE คนดูแลฝ่ายของคนนี้ (Mc = TikTok / Shopee · Admin เสริม = Owner) — ไม่ส่งลิงก์ของฝ่ายอื่น
    cancelLines: role === "mc"
      ? { tiktok: cancelLinesOf(settings).tiktok, shopee: cancelLinesOf(settings).shopee }
      : { admin: cancelLinesOf(settings).admin },
    canCancel: role === "mc" || !!r.me.admin?.isExtra,
    ...(booked.size ? { undo: Object.fromEntries(booked) } : {}),
    // หาห้องจากชื่อช่องเดิมก่อน (GLORY MALL) แล้วค่อยเปลี่ยนเป็นชื่อช่องที่แสดง (ชีตยังใช้ชื่อเดิม)
    items: withPlatformLabels(items.map((i) => ({
      ...i, room: roomForPlatform(i.platform, roomNames), ...(frames.get(`${i.platform}|${i.date}`) ?? {}),
      ...(travel && picks.has(i) ? { travel } : {}),
    }))),
    profile: {
      name: role === "mc" ? `Mc ${staff.data.name}` : staff.data.name,
      email: staff.data.email ?? r.me.email,
      phone: staff.data.phone ?? "",
      // Mc ประจำ / Admin ประจำ (เงินเดือน) ไม่คิดค่าจ้างรายชั่วโมง
      rate: salaried ? 0 : lock ? lock.rate : Number(staff.data.hourly_rate) || defaultRate,
      commitTiers: salaried ? [] : lock ? lock.tiers : cleanTiers(staff.data.commit_tiers),
      // ค่าจ้างคิว Shopee ที่ตั้งแยก (null = เท่ากับ TikTok) — ตัวเลขเดียวกับหน้าสรุปของเจ้าของ (src/lib/pay.ts platformRates)
      shopeeRate: salaried || role !== "mc" ? null : lock ? lock.shopeeRate : Number(extraRow.data?.shopee_rate) || null,
      // Mc ประจำ ดูยอดขายของตัวเองได้ (ปุ่ม "ยอดขายของฉัน" · /api/my/gmv ตรวจสิทธิ์ซ้ำ)
      ...(role === "mc" && staff.data.is_salaried ? { ownGmv: true } : {}),
    },
    payments: (paid.map.get(person.id) ?? []).map((p) => ({ amount: p.amount, paidOn: p.paidOn })),
    // ชื่อช่องในรายการคิวของ Mc ในเครือ = ชื่อที่แสดง (เหมือน items)
    ...(subs.length ? { subs: withPlatformLabels(subs) } : {}),
    ...(slips.length ? { slips } : {}),
  });
}
