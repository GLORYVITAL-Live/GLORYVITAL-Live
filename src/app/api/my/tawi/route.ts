import { after } from "next/server";
import { fail, ok, requireMe } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/server";
import { TAWI_UPDATING, myTawi, notifyVerifyFail, verifyTawi } from "@/lib/tawi";
import { TAWI_VERIFY_MAX_FAILS } from "@/lib/tawi-verify";
import type { MyTawi } from "@/lib/types";

// ใบ 50 ทวิของตัวเอง (Mc / Admin — ทุกบทบาทของอีเมลนี้)
//   GET   รายการไฟล์ที่ทีมงานจับคู่ให้ (ใหม่ก่อน) + ใบไหนยืนยันตัวตนแล้ว · ยังไม่ได้รัน SQL = ready: false (หน้าเว็บซ่อนส่วนนี้)
//   POST  { name }  กรอกชื่อ-นามสกุลจริงเพื่อยืนยันตัวตนก่อนดาวน์โหลด (ไม่จับคู่ใบให้ใคร)
//         ไม่ตรง = บันทึก log + แจ้ง Owner ที่ดูเอกสารทำเบิกได้ (วันละครั้งต่อคน) · ผิดครบ 5 ครั้ง/วัน = ล็อก

async function requireCrew() {
  const r = await requireMe();
  if ("res" in r) return r;
  if (!r.me.mc && !r.me.admin) return { res: fail("ใบ 50 ทวิ ดูได้เฉพาะบัญชี Mc / Admin", 403) };
  return r;
}

export async function GET() {
  const r = await requireCrew();
  if ("res" in r) return r.res;
  return ok<MyTawi>(await myTawi(r.me.email));
}

export async function POST(request: Request) {
  const r = await requireCrew();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  let res: Awaited<ReturnType<typeof verifyTawi>>;
  try {
    res = await verifyTawi(r.me.email, body?.name);
  } catch (err) {
    const msg = (err as Error)?.message || "ยืนยันตัวตนไม่สำเร็จ";
    return fail(msg, msg === TAWI_UPDATING ? 503 : 400);
  }
  const who = r.me.mc ? `Mc ${r.me.mc.name}` : r.me.admin!.name;
  // บันทึกไว้ให้ทีมงานตรวจย้อนหลังได้ (ไม่เก็บชื่อที่กรอก — อาจเป็นชื่อจริงของคนอื่น)
  const log = (result: string) => after(async () => {
    await createAdminClient().from("booking_logs").insert({
      email: r.me.email, role: r.me.mc ? "Mc" : "Admin", name: who, action: "ยืนยันตัวตนใบ 50 ทวิ", result,
    });
  });

  switch (res.status) {
    case "updating": return fail(TAWI_UPDATING, 503);
    case "invalid": return fail("กรุณาใส่ชื่อ-นามสกุลจริงให้ครบ (ตามบัตรประชาชน)");
    case "nothing": return ok({ ...(await myTawi(r.me.email)), message: "ไม่มีใบ 50 ทวิที่รอยืนยัน" });
    case "locked":
      return fail(`กรอกชื่อไม่ตรงครบ ${TAWI_VERIFY_MAX_FAILS} ครั้งแล้ววันนี้ ลองใหม่พรุ่งนี้ หรือแจ้งแอดมิน`, 429);
    case "mismatch": {
      const fails = res.failsToday;
      log(`ชื่อไม่ตรง (ครั้งที่ ${fails} วันนี้)`);
      after(() => notifyVerifyFail(r.me.email, who, fails));
      return fail(
        `ชื่อไม่ตรงกับเอกสารที่ทีมงานจับคู่ไว้ ตรวจตัวสะกดอีกครั้ง หรือแจ้งแอดมิน${res.left ? ` (ลองได้อีก ${res.left} ครั้งวันนี้)` : " (ครบจำนวนครั้งของวันนี้แล้ว)"}`,
        400,
      );
    }
    case "ok":
      log("สำเร็จ");
      return ok({ ...(await myTawi(r.me.email)), message: "ยืนยันตัวตนแล้ว ดาวน์โหลดใบ 50 ทวิได้เลย" });
  }
}
