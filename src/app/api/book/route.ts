import { after } from "next/server";
import { fail, ok, requireMe } from "@/lib/api";
import { processSyncJobs } from "@/lib/sync";
import { bookingRange, getSettings, personPeriod, sheetTabOfBoard, sideOfBoard, writeLogs } from "@/lib/data";
import { onBoard, type Board } from "@/lib/live-team";
import { notifyBooked } from "@/lib/notifications";
import { myQuotas } from "@/lib/mc-quota-db";
import { createAdminClient } from "@/lib/supabase/server";
import { trainingBlock } from "@/lib/training";
import { rangeText } from "@/lib/window";
import type { ActionResult } from "@/lib/types";

// Mc จองคิว / Admin เสริมรับคิว — แทน action "book" / "adminAssign"
// ชื่อคนที่จองมาจากบัญชีที่ login เท่านั้น หน้าเว็บส่งชื่อมาเองไม่ได้
export async function POST(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const role = body?.role;
  const raw: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
  const ids = [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

  const settings = await getSettings();
  if (!ids.length) return fail("ยังไม่ได้เลือก slot");
  if (ids.length > settings.max_per_request) return fail(`เลือกได้ไม่เกิน ${settings.max_per_request} slot ต่อครั้ง`);

  if (role === "mc") {
    if (!r.me.mc) return fail("บัญชีนี้ไม่มีสิทธิ์จองคิว Mc", 403);
  } else if (role === "admin") {
    if (!r.me.admin) return fail("บัญชีนี้ไม่มีสิทธิ์ใช้หน้า Admin", 403);
    if (!r.me.admin.isExtra) return fail("รับคิวผ่านเว็บได้เฉพาะ Admin เสริม", 403);
  } else {
    return fail("ไม่รู้จักบทบาทนี้");
  }
  // หน้าจองคิว Shopee (Mc เท่านั้น) / คิว TikTok · ทีมไลฟ์ต้องใช้หน้านั้นได้ (TikTok + Shopee = ได้ทั้งสองหน้า)
  const board: Board = role === "mc" && body?.board === "shopee" ? "shopee" : "tiktok";
  const side = role === "mc" ? sideOfBoard(board) : "admin";
  if (!onBoard((role === "mc" ? r.me.mc : r.me.admin)!.platform, board)) {
    return fail(board === "shopee" ? "บัญชีนี้ไม่ได้อยู่ทีม Shopee จองคิว Shopee ไม่ได้" : "ทีม Shopee จองคิว TikTok ไม่ได้", 403);
  }

  const db = createAdminClient();
  const table = role === "mc" ? "mc_slots" : "admin_slots";
  // คลิปเทรนนิ่งที่บังคับ (เปิดใช้อยู่) ต้องดูครบก่อน · ตรวจไม่ได้ (เช่น อ่านไดรฟ์ไม่ได้) = ไม่บล็อก
  if (settings.training_required) {
    const block = await trainingBlock(r.me.email, role === "mc" ? r.me.mc!.id : r.me.admin!.id, true).catch(() => null);
    if (block) {
      return fail(block.kind === "slides"
        ? `ต้องอ่านสไลด์บรีฟโปรดักต์ให้ครบทุกหน้าก่อน${role === "mc" ? "จองคิว" : "รับคิว"} — เมนู "เทรนนิ่ง" > สไลด์บรีฟ`
        : `ต้องดูคลิปเทรนนิ่งที่บังคับให้ครบก่อน${role === "mc" ? "จองคิว" : "รับคิว"} (ดูแล้ว ${block.done}/${block.total} คลิป) — เมนู "เทรนนิ่ง"`, 403);
    }
  }

  // ช่วงเปิดจองของคนนี้ (เจ้าของตั้งไว้) slot นอกช่วงไม่ส่งไปจอง (กันหน้าเว็บที่ยังไม่รีเฟรช)
  // ส่วนวันที่ผ่านไปแล้ว / วันสุดท้ายที่จองได้ ฐานข้อมูลตรวจอีกชั้นอยู่แล้ว
  // slot ที่เริ่มไปแล้วแต่ยังไม่จบ จองได้ตามเดิม (มาช่วยกลางไลฟ์)
  // slot ที่ "แคน" ในชีต (is_cancelled) ไม่ส่งไปจองเช่นกัน (ฟังก์ชันจองในฐานข้อมูลยังไม่ได้ตรวจเรื่องนี้)
  const personId: number = role === "mc" ? r.me.mc!.id : r.me.admin!.id;
  const range = bookingRange(settings, side, personId);
  type Row = { id: number; live_date: string; is_cancelled: boolean; sheet_tab?: string };
  const { data: rows, error: rowsError } = await db.from(table).select(`id, live_date, is_cancelled${role === "mc" ? ", sheet_tab" : ""}`)
    .in("id", ids).overrideTypes<Row[], { merge: false }>();
  if (rowsError) return fail("เกิดข้อผิดพลาด: " + rowsError.message, 500);
  const limited = personPeriod(settings, side, personId).mode !== "off";
  const outside = range.empty ? "ตอนนี้ยังไม่เปิดจอง" : `ตอนนี้เปิดจองเฉพาะ ${rangeText(range)}`;
  const blocked: ActionResult[] = (rows ?? []).flatMap((s) => {
    // slot ของอีกหน้า (หน้าเว็บส่งมาผิดหน้า) ไม่จอง — โควต้าต่อวัน / ช่วงเปิดจองของแต่ละหน้าไม่เหมือนกัน
    if (role === "mc" && (s.sheet_tab ?? "mc") !== sheetTabOfBoard(board)) return [{ id: Number(s.id), success: false, message: "slot นี้ไม่ได้อยู่ในหน้าจองนี้" }];
    if (s.is_cancelled) return [{ id: Number(s.id), success: false, message: "slot นี้ถูกยกเลิกแล้ว" }];
    if (limited && (range.empty || s.live_date < range.from || (range.to !== null && s.live_date > range.to))) {
      return [{ id: Number(s.id), success: false, message: outside }];
    }
    return [];
  });
  const allowed = ids.filter((id) => !blocked.some((b) => b.id === id));

  let results: ActionResult[] = [];
  if (allowed.length) {
    // สิทธิ์จองต่อเดือนตามแร็งค์ (เปิดใช้อยู่ + ไม่ใช่ Mc ประจำ · คิว TikTok เท่านั้น) {"YYYY-MM": slot สูงสุด} ฐานข้อมูลนับรวมคิวที่มีอยู่แล้วตอนจอง
    let monthMax: Record<string, number> | null = null;
    if (role === "mc" && board === "tiktok") {
      const months = (rows ?? []).filter((s) => allowed.includes(Number(s.id))).map((s) => String(s.live_date).slice(0, 7));
      try {
        const q = await myQuotas(settings, r.me.mc!.id, months);
        if (q) monthMax = Object.fromEntries(q.map((x) => [x.month, x.max]));
      } catch (err) {
        return fail("เช็กสิทธิ์จองไม่สำเร็จ: " + (err as Error).message, 500);
      }
    }
    // p_until = วันสุดท้ายที่คนนี้จองได้ (ช่วงที่ใส่วันสุดท้ายเองเปิดเกินเดือนที่เปิดจองได้) ว่าง = ฐานข้อมูลใช้เดือนที่เปิดจอง
    const call = (until: boolean) => role === "mc"
      ? db.rpc("book_mc_slots", {
        p_mc_id: r.me.mc!.id, p_slot_ids: allowed, ...(until ? { p_until: range.to } : {}), ...(monthMax ? { p_month_max: monthMax } : {}),
      })
      : db.rpc("assign_admin_slots", { p_admin_id: r.me.admin!.id, p_slot_ids: allowed, ...(until ? { p_until: range.to } : {}) });
    let { data, error } = await call(true);
    // ยังไม่ได้รัน SQL 20261019000000_book_until (ฟังก์ชันยังไม่มี p_until) = เรียกแบบเดิม (จำกัดสิทธิ์ต่อเดือนอยู่ = ไม่ข้ามการตรวจ)
    if (error && !monthMax && /p_until|could not find the function/i.test(error.message)) ({ data, error } = await call(false));
    if (error) return fail("เกิดข้อผิดพลาด: " + error.message, 500);
    results = data;
  }
  results = [...results, ...blocked];
  const log = role === "mc"
    ? { role: "Mc", name: `Mc ${r.me.mc!.name}`, action: "จองคิว", slot_table: table }
    : { role: "Admin", name: r.me.admin!.name, action: "รับคิว Admin", slot_table: table };

  after(async () => {
    await writeLogs(results.map((x) => ({
      email: r.me.email, ...log, slot_id: x.id, result: x.success ? "สำเร็จ" : x.message,
    })));
    const booked = results.filter((x) => x.success).map((x) => x.id);
    if (booked.length) {
      await Promise.all([
        processSyncJobs(),
        // แจ้งเตือนในเว็บ / มือถือ: Owner ฝั่งนั้น
        notifyBooked(role, role === "mc" ? r.me.mc!.name : r.me.admin!.name, r.me.email, booked),
      ]);
    }
  });
  return ok({ results });
}
