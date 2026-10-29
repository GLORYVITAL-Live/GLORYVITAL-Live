import { NextResponse } from "next/server";
import { monthRange, requireOwner } from "@/lib/api";
import { ownerSummary } from "@/lib/data";
import { payDocsScope } from "@/lib/pay-docs-db";
import { PAY_SYNC_SQL, paymentsOf } from "@/lib/pay-months";
import { applyPeriods, canClosePeriods } from "@/lib/periods";
import { withPlatformLabels } from "@/lib/platform";

// สรุปรายเดือนสำหรับเจ้าของ (?month=YYYY-MM) — แทน action "ownerSummary"
// ส่งเฉพาะฝั่งที่ Owner คนนี้มีสิทธิ์ (Mc / Admin) · ฝั่งที่ดูได้อย่างเดียว = ไม่ส่งค่าจ้าง (อัตรา / Commit)
// ฝั่งที่ปิดงวดแล้ว = ตัวเลขตอนปิด (ไฟล์เบิกใช้ชุดเดียวกัน) + ส่วนต่างของข้อมูลจริง · + การโอนค่าจ้างรายคน (ฝั่งที่จัดการได้)
// docs = ฝั่งที่ดูใบ 50 ทวิ / เอกสารรับเงินได้ (แผงในหน้าสรุปรายเดือน)
export async function GET(request: Request) {
  const r = await requireOwner("บัญชีนี้ไม่มีสิทธิ์ดูหน้าสรุป", "read");
  if ("res" in r) return r.res;
  const { key, first, last } = monthRange(new URL(request.url).searchParams.get("month"));
  const s = await ownerSummary(key, first, last);
  const { mc, admin, edit } = r.scope;
  // id ของแต่ละคน (ตัวเลขตอนปิดงวดเก่าไม่มี id → เติมจากชื่อ)
  const ids = new Map([...s.mc.map((p) => [`Mc|${p.name}`, p.staffId] as const), ...s.admin.map((p) => [`Admin|${p.name}`, p.staffId] as const)]);
  // ฝั่งที่ปิดงวดแล้ว: ใช้ตัวเลขตอนปิด + ส่วนต่างของข้อมูลจริง
  const [{ periods, changes, periodLog }, canClose, paid, docs] = await Promise.all([
    applyPeriods(s, key, [...(mc ? ["mc" as const] : []), ...(admin ? ["admin" as const] : [])]),
    canClosePeriods(r.me),
    paymentsOf(key),
    payDocsScope(r.me).catch(() => ({ mc: false, admin: false })),
  ]);
  for (const [type, list] of [["Mc", s.mc], ["Admin", s.admin]] as const) {
    for (const p of list) p.staffId ??= ids.get(`${type}|${p.name}`);
  }
  const hide = { mc: !edit.mc, admin: !edit.admin };
  // การโอน: เฉพาะคนฝั่งที่จัดการได้ (เห็นค่าจ้าง)
  const payIds = new Set([...(mc && edit.mc ? s.mc : []), ...(admin && edit.admin ? s.admin : [])].map((p) => p.staffId));
  const payments = Object.fromEntries([...paid.map].filter(([id]) => payIds.has(id)));
  const people = (list: typeof s.mc, hidden: boolean) => (hidden ? list.map((p) => ({ ...p, commit: null })) : list);
  return NextResponse.json({
    ...s,
    scope: { mc, admin },
    periods, periodLog, canClose, docs,
    payments, paySides: { mc: mc && edit.mc, admin: admin && edit.admin },
    ...(paid.ready ? {} : { paySql: PAY_SYNC_SQL }),
    // ส่วนต่างมีค่าจ้าง/ชม. ด้วย: ฝั่งที่ดูได้อย่างเดียวไม่ส่ง
    changes: Object.fromEntries(Object.entries(changes).filter(([side]) => !hide[side as "mc" | "admin"])),
    payHidden: hide,
    mc: mc ? people(s.mc, hide.mc) : [],
    admin: admin ? people(s.admin, hide.admin) : [],
    // ชื่อช่องที่แสดง (ชีตยังใช้ชื่อเดิม) ไฟล์ส่งออกใช้ข้อมูลชุดนี้
    details: withPlatformLabels(s.details.filter((d) => (d.type === "Mc" ? mc : admin))),
    rates: {
      mc: mc && !hide.mc ? s.rates.mc : {}, admin: admin && !hide.admin ? s.rates.admin : {},
      defaultMc: hide.mc ? 0 : s.rates.defaultMc, defaultAdmin: hide.admin ? 0 : s.rates.defaultAdmin,
    },
  });
}
