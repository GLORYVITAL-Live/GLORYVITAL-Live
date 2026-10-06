import { NextResponse } from "next/server";
import { fail, requireMe } from "@/lib/api";
import { PROOF_BUCKET, canSeeAll, proofSlots } from "@/lib/proofs";
import { createAdminClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/window";

// เปิดดูรูปหลักฐานไลฟ์ (?id=) -> ส่งต่อไปลิงก์ชั่วคราวของรูป (หมดอายุใน 5 นาที)
// ดูได้: Owner / คนที่อัปโหลด / Admin ของ slot ที่ผูกกับหลักฐานนี้
export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return fail("ไม่รู้จักหลักฐานนี้");

  const db = createAdminClient();
  const { data: p } = await db.from("live_proofs").select("id, live_date, image_path, uploaded_by_email").eq("id", id).maybeSingle();
  if (!p) return fail("ไม่พบหลักฐานนี้ (อาจถูกลบไปแล้ว)", 404);

  const date = String(p.live_date);
  // Owner ที่ติ๊กแค่ Data analytics ไม่นับ (ต้องมีสิทธิ์จัดการ Mc / Admin / หลักฐานไลฟ์)
  const o = r.me.owner;
  const allowed = !!(o && (o.mc || o.admin || o.proofs)) || canSeeAll(r.me) || p.uploaded_by_email === r.me.email
    || (!!r.me.admin && (await proofSlots(r.me, date, addDays(date, 1))).some((s) => s.proof?.id === id));
  if (!allowed) return fail("บัญชีนี้ไม่มีสิทธิ์ดูหลักฐานนี้", 403);

  const { data, error } = await db.storage.from(PROOF_BUCKET).createSignedUrl(String(p.image_path), 300);
  if (error || !data) return fail("เปิดรูปไม่สำเร็จ: " + (error?.message ?? ""), 500);
  return NextResponse.redirect(data.signedUrl);
}
