import { fail, ok, requireMe } from "@/lib/api";
import { isStaff } from "@/lib/auth";
import { addLookImage, listLooks, removeLookImage, saveLookNote } from "@/lib/looks";
import { sniffType } from "@/lib/receipts";
import { createAdminClient } from "@/lib/supabase/server";
import type { LookGender, LooksResponse } from "@/lib/types";

// Look แต่งหน้า + แต่งตัว (รูป Ref) แยกผู้หญิง / ผู้ชาย — src/lib/looks.ts
//   GET                        ทุกคนในทีมไลฟ์ (Mc / Admin เห็นในโปรไฟล์)
//   PATCH { key, note }        แก้ข้อความ      ┐
//   POST  multipart key+photo  เพิ่มรูป (JPG / PNG / WebP ไม่เกิน 4 MB) ├ คนที่จัดการบรีฟการแต่งตัวได้ (me.briefs) ที่ เทรนนิ่ง > เฟรมไลฟ์
//   DELETE { key, path }       ลบรูป          ┘
// key = "female" / "male" · ทุกการแก้บันทึกใน booking_logs (slot_table = "look_refs")

const MAX_BYTES = 4 * 1024 * 1024;
const LABEL: Record<LookGender, string> = { female: "ผู้หญิง", male: "ผู้ชาย" };
const labelOf = (key: unknown) => LABEL[key as LookGender] ?? String(key);

async function requireEditor() {
  const r = await requireMe();
  if ("res" in r) return r;
  if (!r.me.briefs) return { res: fail("บัญชีนี้แก้ Look แต่งหน้า/แต่งตัวไม่ได้", 403) };
  return { me: r.me, who: r.me.owner?.name || r.me.admin?.name || r.me.email };
}

async function log(email: string, who: string, action: string) {
  await createAdminClient().from("booking_logs").insert({ email, role: "Look แต่งหน้า/แต่งตัว", name: who, action, slot_table: "look_refs", slot_id: 0, result: "สำเร็จ" });
}

export async function GET() {
  const r = await requireMe();
  if ("res" in r) return r.res;
  if (!isStaff(r.me)) return fail("บัญชีนี้ดู Look แต่งหน้า/แต่งตัวไม่ได้", 403);
  return ok<LooksResponse>({ ...(await listLooks()), canEdit: r.me.briefs === true });
}

export async function PATCH(request: Request) {
  const r = await requireEditor();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  try {
    await saveLookNote(body?.key, body?.note, r.who);
    await log(r.me.email, r.who, `แก้ข้อความ Look ${labelOf(body?.key)}`);
    return ok({ message: "บันทึกแล้ว" });
  } catch (err) {
    return fail((err as Error).message);
  }
}

export async function POST(request: Request) {
  const r = await requireEditor();
  if ("res" in r) return r.res;
  const form = await request.formData().catch(() => null);
  const key = String(form?.get("key") ?? "");
  const f = form?.get("photo");
  if (!(f instanceof File) || !f.size) return fail("ยังไม่ได้เลือกรูป");
  if (f.size > MAX_BYTES) return fail("รูปใหญ่เกินไป (ไม่เกิน 4 MB)");
  // ตรวจชนิดจากไบต์แรก (ไม่เชื่อนามสกุลไฟล์) · รับเฉพาะรูป
  const type = sniffType(new Uint8Array(await f.slice(0, 12).arrayBuffer()));
  if (!type.startsWith("image/")) return fail("รองรับเฉพาะรูป JPG / PNG / WebP");
  try {
    await addLookImage(key, f, type, r.who);
    await log(r.me.email, r.who, `เพิ่มรูป Look ${labelOf(key)}`);
    return ok({ message: "เพิ่มรูปแล้ว" });
  } catch (err) {
    return fail((err as Error).message);
  }
}

export async function DELETE(request: Request) {
  const r = await requireEditor();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  try {
    await removeLookImage(body?.key, body?.path, r.who);
    await log(r.me.email, r.who, `ลบรูป Look ${labelOf(body?.key)}`);
    return ok({ message: "ลบรูปแล้ว" });
  } catch (err) {
    return fail((err as Error).message);
  }
}
