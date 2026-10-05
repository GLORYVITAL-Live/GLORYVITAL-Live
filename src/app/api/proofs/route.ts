import { after } from "next/server";
import { fail, monthRange, ok, requireMe } from "@/lib/api";
import { bkkToday } from "@/lib/data";
import { syncProofsToDrive, trashUnusedDriveFiles } from "@/lib/drive";
import { PROOF_BUCKET, canSeeAll, canUseProofs, proofSlots, removeOrphanProofs } from "@/lib/proofs";
import { createAdminClient } from "@/lib/supabase/server";

// หลักฐานไลฟ์ (หน้า "หลักฐานไลฟ์") — Admin ของ slot นั้น + Owner ที่มีสิทธิ์ฝั่ง Mc
//   GET    ?date=YYYY-MM-DD  slot ของวันนั้น + หลักฐานที่แนบแล้ว
//          ?month=YYYY-MM    จำนวน slot / ที่มีหลักฐานแล้ว รายวัน (ถึงวันนี้)
//   POST   form-data: file (รูป), slotIds (JSON), startedAt / endedAt ("YYYY-MM-DDTHH:mm:ss" เวลาไทย)
//          รูปเดียวผูกได้หลาย slot (ไลฟ์ครั้งเดียวคลุมหลาย slot) slot ที่มีหลักฐานอยู่แล้วจะถูกแทนที่
//   DELETE { id }  ลบหลักฐาน (คนที่อัปโหลด หรือ Owner ฝั่ง Mc)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SLOTS = 12;

async function requireProofUser() {
  const r = await requireMe();
  if ("res" in r) return r;
  if (!canUseProofs(r.me)) return { res: fail("หน้านี้สำหรับ Admin และเจ้าของ (ฝั่ง Mc) เท่านั้น", 403) };
  return r;
}

export async function GET(request: Request) {
  const r = await requireProofUser();
  if ("res" in r) return r.res;
  const sp = new URL(request.url).searchParams;
  const date = sp.get("date");
  if (date) {
    if (!DATE_RE.test(date)) return fail("วันที่ไม่ถูกต้อง");
    return ok({ date, all: canSeeAll(r.me), slots: await proofSlots(r.me, date, date) });
  }

  const { key, first, last } = monthRange(sp.get("month"));
  const today = bkkToday();
  const until = last < today ? last : today;
  const days = new Map<string, { date: string; total: number; done: number }>();
  if (first <= until) {
    for (const s of await proofSlots(r.me, first, until)) {
      const d = days.get(s.date) ?? { date: s.date, total: 0, done: 0 };
      d.total++;
      if (s.proof) d.done++;
      days.set(s.date, d);
    }
  }
  return ok({ month: key, days: [...days.values()] });
}

/** "2026-09-16T19:30:58" (เวลาไทย) -> Date */
const bkkTime = (s: string) => new Date(`${s.length === 16 ? `${s}:00` : s}+07:00`);

export async function POST(request: Request) {
  const r = await requireProofUser();
  if ("res" in r) return r.res;
  const form = await request.formData().catch(() => null);
  if (!form) return fail("ข้อมูลไม่ครบ ลองใหม่อีกครั้ง");

  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return fail("กรุณาแนบรูปแดชบอร์ด");
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return fail("รองรับเฉพาะรูป JPG / PNG / WebP");
  if (file.size > MAX_BYTES) return fail("รูปใหญ่เกินไป (ไม่เกิน 4 MB)");

  let raw: unknown = [];
  try { raw = JSON.parse(String(form.get("slotIds") ?? "[]")); } catch {}
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return fail("ยังไม่ได้เลือก slot");
  if (ids.length > MAX_SLOTS) return fail(`เลือกได้ไม่เกิน ${MAX_SLOTS} slot ต่อรูป`);

  const startText = String(form.get("startedAt") ?? ""), endText = String(form.get("endedAt") ?? "");
  if (!DT_RE.test(startText) || !DT_RE.test(endText)) return fail("กรุณาใส่เวลาเริ่มและจบไลฟ์ให้ครบ");
  const startedAt = bkkTime(startText), endedAt = bkkTime(endText);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) return fail("เวลาเริ่ม/จบไม่ถูกต้อง");
  if (endedAt <= startedAt) return fail("เวลาจบต้องหลังเวลาเริ่ม");
  if (endedAt.getTime() - startedAt.getTime() > 24 * 3600_000) return fail("ช่วงเวลาไลฟ์ยาวเกิน 24 ชั่วโมง ตรวจวันที่อีกครั้ง");

  // ตรวจสิทธิ์: ทุก slot ที่เลือกต้องอยู่ในรายการที่คนนี้เห็น (Admin = slot ของตัวเอง)
  const db = createAdminClient();
  const { data: rows, error } = await db.from("mc_slots").select("id, live_date").in("id", ids);
  if (error) return fail(error.message, 500);
  if (!rows || rows.length !== ids.length) return fail("ไม่พบ slot บางรายการ ลองรีเฟรชหน้า");
  const dates = rows.map((x) => String(x.live_date)).sort();
  const picked = (await proofSlots(r.me, dates[0], dates[dates.length - 1])).filter((s) => ids.includes(s.mcSlotId));
  if (picked.length !== ids.length) return fail("มี slot ที่คุณแนบหลักฐานไม่ได้ (ไม่ใช่ slot ของคุณ หรือถูกยกเลิกแล้ว)", 403);
  if (new Set(picked.map((s) => s.platform)).size > 1) return fail("เลือกได้ทีละแพลตฟอร์ม (ไลฟ์ 1 ครั้ง = 1 แพลตฟอร์ม)");

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${dates[0].slice(0, 7)}/${dates[0]}-${crypto.randomUUID()}.${ext}`;
  const up = await db.storage.from(PROOF_BUCKET).upload(path, file, { contentType: file.type });
  if (up.error) return fail("อัปโหลดรูปไม่สำเร็จ: " + up.error.message, 500);

  const name = r.me.owner?.name || r.me.admin?.name || r.me.email;
  const { data: proof, error: insErr } = await db.from("live_proofs").insert({
    platform: picked[0].platform, live_date: dates[0], started_at: startedAt.toISOString(), ended_at: endedAt.toISOString(),
    image_path: path, uploaded_by_email: r.me.email, uploaded_by_name: name,
  }).select("id").single();
  if (insErr || !proof) {
    await db.storage.from(PROOF_BUCKET).remove([path]);
    return fail("บันทึกหลักฐานไม่สำเร็จ: " + (insErr?.message ?? ""), 500);
  }
  const proofId = Number(proof.id);
  // ไฟล์ใน Drive ของหลักฐานเดิม (ถ้าแทนที่) เอาไว้ทิ้งถังขยะหลังผูกใหม่
  const { data: oldLinks } = await db.from("live_proof_slots").select("drive_file_id").in("mc_slot_id", ids);
  const { error: linkErr } = await db.from("live_proof_slots")
    .upsert(
      ids.map((id) => ({ mc_slot_id: id, proof_id: proofId, drive_file_id: null, drive_url: null, drive_error: null })),
      { onConflict: "mc_slot_id" },
    );
  if (linkErr) {
    await db.from("live_proofs").delete().eq("id", proofId);
    await db.storage.from(PROOF_BUCKET).remove([path]);
    return fail("ผูกหลักฐานกับ slot ไม่สำเร็จ: " + linkErr.message, 500);
  }

  // หลักฐานเก่าที่ถูกแทนที่จนไม่เหลือ slot ไหนแล้ว -> ลบทิ้ง (รวมไฟล์รูป)
  const replaced = [...new Set(picked.map((s) => s.proof?.id).filter((x): x is number => !!x))];
  await removeOrphanProofs(db, replaced);

  // หลังตอบผู้ใช้: สำเนารูปขึ้น Google Drive (ปี > เดือน > Mc) + ทิ้งไฟล์ Drive ของหลักฐานเดิม
  // พลาด (เช่น ยังไม่ได้ให้สิทธิ์ Drive) ไม่กระทบการแนบหลักฐาน กด "ส่งรูปขึ้น Google Drive" ทีหลังได้
  after(async () => {
    await trashUnusedDriveFiles((oldLinks ?? []).map((x) => x.drive_file_id as string | null)).catch(() => undefined);
    await syncProofsToDrive({ proofIds: [proofId] }).catch((err) => console.warn("อัปหลักฐานขึ้น Drive ไม่สำเร็จ:", err));
  });

  await db.from("booking_logs").insert(picked.map((s) => ({
    email: r.me.email, role: r.me.owner?.mc ? "Owner" : "Admin", name, action: replaced.length ? "แนบหลักฐานไลฟ์ (แทนที่)" : "แนบหลักฐานไลฟ์",
    slot_table: "mc_slots", slot_id: s.mcSlotId, platform: s.platform, live_date: s.date, time_range: `${s.start}-${s.end}`, result: "สำเร็จ",
  })));
  return ok({ message: `แนบหลักฐานให้ ${ids.length} slot แล้ว` });
}

export async function DELETE(request: Request) {
  const r = await requireProofUser();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return fail("ไม่รู้จักหลักฐานนี้");

  const db = createAdminClient();
  const { data: p } = await db.from("live_proofs")
    .select("id, platform, live_date, image_path, uploaded_by_email").eq("id", id).maybeSingle();
  if (!p) return fail("ไม่พบหลักฐานนี้ (อาจถูกลบไปแล้ว)", 404);
  if (!canSeeAll(r.me) && p.uploaded_by_email !== r.me.email) return fail("ลบได้เฉพาะคนที่อัปโหลด หรือเจ้าของ", 403);

  const { data: links } = await db.from("live_proof_slots").select("drive_file_id").eq("proof_id", id);
  const { error } = await db.from("live_proofs").delete().eq("id", id);
  if (error) return fail(error.message, 500);
  after(() => trashUnusedDriveFiles((links ?? []).map((x) => x.drive_file_id as string | null)).catch(() => undefined));
  await db.storage.from(PROOF_BUCKET).remove([String(p.image_path)]);
  await db.from("booking_logs").insert({
    email: r.me.email, role: r.me.owner?.mc ? "Owner" : "Admin", name: r.me.owner?.name || r.me.admin?.name || "",
    action: "ลบหลักฐานไลฟ์", platform: p.platform, live_date: p.live_date, result: "สำเร็จ",
  });
  return ok({ message: "ลบหลักฐานแล้ว" });
}
