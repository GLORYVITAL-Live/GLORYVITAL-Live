import { fail, ok, requireMe } from "@/lib/api";
import { SPEC_FIELDS, cleanEquipment, type EquipmentInput } from "@/lib/equipment";
import { createAdminClient } from "@/lib/supabase/server";
import type { Equipment, EquipmentStatus } from "@/lib/types";

// อุปกรณ์โปรดักชั่น (Owner ที่จัดการ Mc หรือ Admin ได้ + Admin ที่ติ๊ก can_manage_equipment)
//   GET               รายการทั้งหมด + ลิงก์รูปชั่วคราว (1 ชม.)
//   POST   multipart  เพิ่ม (data = JSON, photo = รูป ไม่บังคับ)
//   PATCH  multipart  แก้ (data = JSON มี id, photo = รูปใหม่, removePhoto = "1" ลบรูป)
//   DELETE { id }     ลบ (รวมรูป)
// ทุกการเปลี่ยนบันทึกใน booking_logs (slot_table = "equipment")

const BUCKET = "equipment";
const SQL = "ต้องรัน SQL 20261025000000_equipment ใน Supabase ก่อน";
const MAX_BYTES = 4 * 1024 * 1024;
type Row = {
  id: number; code?: string; name: string; category: string; quantity: number; status: EquipmentStatus; location: string; brand: string; model: string;
  serial: string; purchase_date: string | null; price: number | string | null; note: string; photo_path: string | null;
  specs?: Record<string, string> | null; updated_at: string; updated_by: string;
};

async function requireEquipment() {
  const r = await requireMe();
  if ("res" in r) return r;
  if (!r.me.equipment) return { res: fail("บัญชีนี้ไม่มีสิทธิ์ใช้หน้าอุปกรณ์", 403) };
  return { me: r.me, who: r.me.owner?.name || r.me.admin?.name || r.me.email };
}
const dbFail = (msg: string) => fail(
  /specs/i.test(msg) ? "ต้องรัน SQL 20261027000000_equipment_specs ใน Supabase ก่อน" : /equipment|schema cache|does not exist/i.test(msg) ? SQL : msg, 500,
);
const toDb = (d: EquipmentInput) => ({
  code: d.code, name: d.name, category: d.category, quantity: d.quantity, status: d.status, location: d.location, brand: d.brand, model: d.model,
  serial: d.serial, purchase_date: d.purchaseDate, price: d.price, note: d.note, specs: d.specs,
});

/** รูปจากฟอร์ม: ตรวจชนิดจากไบต์แรก (JPG / PNG / WebP) */
async function photoOf(form: FormData) {
  const f = form.get("photo");
  if (!(f instanceof File) || !f.size) return { file: null };
  if (f.size > MAX_BYTES) return { error: "รูปใหญ่เกินไป (ไม่เกิน 4 MB)" };
  const b = new Uint8Array(await f.slice(0, 12).arrayBuffer());
  const type = b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg"
    : b[0] === 0x89 && b[1] === 0x50 ? "image/png"
      : String.fromCharCode(...b.slice(8, 12)) === "WEBP" ? "image/webp" : "";
  if (!type) return { error: "รองรับเฉพาะรูป JPG / PNG / WebP" };
  return { file: f, type };
}
async function upload(file: File, type: string) {
  const path = `${crypto.randomUUID()}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
  const { error } = await createAdminClient().storage.from(BUCKET).upload(path, file, { contentType: type });
  return error ? { error: "อัปโหลดรูปไม่สำเร็จ: " + error.message } : { path };
}
async function log(me: { email: string }, who: string, action: string, id: number) {
  await createAdminClient().from("booking_logs").insert({ email: me.email, role: "อุปกรณ์", name: who, action, slot_table: "equipment", slot_id: id, result: "สำเร็จ" });
}

export async function GET() {
  const r = await requireEquipment();
  if ("res" in r) return r.res;
  const db = createAdminClient();
  const { data, error } = await db.from("equipment").select("*").order("category").order("code").order("name");
  if (error) return dbFail(error.message);
  const rows = (data ?? []) as Row[];
  const paths = rows.map((x) => x.photo_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  const items: Equipment[] = rows.map((x) => ({
    id: x.id, code: x.code ?? "", name: x.name, category: x.category, quantity: x.quantity, status: x.status, location: x.location, brand: x.brand,
    model: x.model, serial: x.serial, purchaseDate: x.purchase_date, price: x.price === null ? null : Number(x.price), note: x.note,
    specs: x.specs ?? {},
    photoUrl: x.photo_path ? urls.get(x.photo_path) ?? null : null, updatedAt: x.updated_at, updatedBy: x.updated_by,
  }));
  return ok({ items });
}

export async function POST(request: Request) {
  const r = await requireEquipment();
  if ("res" in r) return r.res;
  const form = await request.formData().catch(() => null);
  if (!form) return fail("ข้อมูลไม่ครบ หรือรูปใหญ่เกินไป");
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(String(form.get("data") ?? "{}")); } catch {}
  const c = cleanEquipment(raw);
  if ("error" in c) return fail(c.error);
  const photo = await photoOf(form);
  if ("error" in photo) return fail(photo.error!);
  const up = photo.file ? await upload(photo.file, photo.type!) : { path: null };
  if ("error" in up) return fail(up.error!, 500);
  const db = createAdminClient();
  const { data, error } = await db.from("equipment").insert({ ...toDb(c.data), photo_path: up.path, updated_by: r.who }).select("id").single();
  if (error || !data) {
    if (up.path) await db.storage.from(BUCKET).remove([up.path]);
    return dbFail(error?.message ?? "");
  }
  await log(r.me, r.who, `เพิ่มอุปกรณ์ "${c.data.name}" (${c.data.quantity} ชิ้น)`, data.id);
  return ok({ id: data.id, message: "เพิ่มอุปกรณ์แล้ว" });
}

export async function PATCH(request: Request) {
  const r = await requireEquipment();
  if ("res" in r) return r.res;
  const form = await request.formData().catch(() => null);
  if (!form) return fail("ข้อมูลไม่ครบ หรือรูปใหญ่เกินไป");
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(String(form.get("data") ?? "{}")); } catch {}
  const id = Number(raw.id);
  if (!Number.isInteger(id) || id <= 0) return fail("ไม่พบอุปกรณ์นี้");
  const c = cleanEquipment(raw);
  if ("error" in c) return fail(c.error);
  const db = createAdminClient();
  const { data: cur, error: curErr } = await db.from("equipment").select("*").eq("id", id).maybeSingle();
  if (curErr) return dbFail(curErr.message);
  if (!cur) return fail("ไม่พบอุปกรณ์นี้ (อาจถูกลบไปแล้ว)", 404);
  const photo = await photoOf(form);
  if ("error" in photo) return fail(photo.error!);
  const up = photo.file ? await upload(photo.file, photo.type!) : { path: null };
  if ("error" in up) return fail(up.error!, 500);
  const removing = form.get("removePhoto") === "1";
  const photoPath = up.path ?? (removing ? null : (cur as Row).photo_path);
  const next = { ...toDb(c.data), photo_path: photoPath, updated_by: r.who, updated_at: new Date().toISOString() };
  const { error } = await db.from("equipment").update(next).eq("id", id);
  if (error) {
    if (up.path) await db.storage.from(BUCKET).remove([up.path]);
    return dbFail(error.message);
  }
  const old = (cur as Row).photo_path;
  if (old && old !== photoPath) await db.storage.from(BUCKET).remove([old]);
  // ประวัติ: ช่องที่เปลี่ยน
  const labels: [keyof ReturnType<typeof toDb>, string][] = [
    ["code", "รหัส"], ["name", "ชื่อ"], ["category", "หมวด"], ["quantity", "จำนวน"], ["status", "สถานะ"], ["location", "ที่เก็บ"], ["brand", "ยี่ห้อ"],
    ["model", "รุ่น"], ["serial", "Serial"], ["purchase_date", "วันที่ซื้อ"], ["price", "ราคา"], ["note", "หมายเหตุ"],
  ];
  const curRow = cur as Record<string, unknown>;
  const diff = labels.filter(([k]) => String(curRow[k] ?? "") !== String(next[k] ?? "")).map(([k, l]) => `${l} ${curRow[k] ?? "–"} → ${next[k] ?? "–"}`);
  // สเปค: บอกทีละช่องที่เปลี่ยน
  const oldSpecs = (curRow.specs ?? {}) as Record<string, string>;
  for (const [k, l] of SPEC_FIELDS) {
    if ((oldSpecs[k] ?? "") !== (next.specs[k] ?? "")) diff.push(`${l} ${oldSpecs[k] || "–"} → ${next.specs[k] || "–"}`);
  }
  if (old !== photoPath) diff.push(photoPath ? "เปลี่ยนรูป" : "ลบรูป");
  if (diff.length) await log(r.me, r.who, `แก้อุปกรณ์ "${c.data.name}": ${diff.join(" · ")}`, id);
  return ok({ message: "บันทึกแล้ว" });
}

export async function DELETE(request: Request) {
  const r = await requireEquipment();
  if ("res" in r) return r.res;
  const id = Number((await request.json().catch(() => ({})))?.id);
  if (!Number.isInteger(id) || id <= 0) return fail("ไม่พบอุปกรณ์นี้");
  const db = createAdminClient();
  const { data: cur } = await db.from("equipment").select("name, photo_path").eq("id", id).maybeSingle();
  if (!cur) return fail("ไม่พบอุปกรณ์นี้ (อาจถูกลบไปแล้ว)", 404);
  const { error } = await db.from("equipment").delete().eq("id", id);
  if (error) return dbFail(error.message);
  if (cur.photo_path) await db.storage.from(BUCKET).remove([cur.photo_path]);
  await log(r.me, r.who, `ลบอุปกรณ์ "${cur.name}"`, id);
  return ok({ message: "ลบแล้ว" });
}
