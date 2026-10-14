import { after } from "next/server";
import { fail, ok, requireMe } from "@/lib/api";
import { syncPayDocsToDrive } from "@/lib/drive";
import { PAY_DOC_LABEL, PAY_DOC_MAX_BYTES, PAY_DOC_TYPES, cleanPayInfo, type PayDocKind } from "@/lib/pay-docs";
import { PAY_DOCS_BUCKET, loadPayDocs, payDocsFail, payDocsNeed, viewOf, type PayDocsRow } from "@/lib/pay-docs-db";
import { createAdminClient } from "@/lib/supabase/server";
import type { MyPayDocs } from "@/lib/types";

// เอกสารทำเบิกของตัวเอง (Mc / Admin)
//   GET   ต้องส่งไหม + ที่ส่งไว้แล้ว
//   POST  ส่ง / แก้ (multipart: info = JSON ข้อมูลที่กรอก, id_card / bank_book = ไฟล์ ไม่แนบ = ใช้ไฟล์เดิม)
//         หลังบันทึก สำเนาขึ้น Google Drive ของ Owner (พลาด = cron / Owner กดส่งใหม่ได้)

const KINDS: PayDocKind[] = ["id_card", "bank_book"];
const PATH_COL = { id_card: "id_card_path", bank_book: "bank_book_path" } as const;

async function requireCrew() {
  const r = await requireMe();
  if ("res" in r) return r;
  if (!r.me.mc && !r.me.admin) return { res: fail("ส่งเอกสารทำเบิกได้เฉพาะบัญชี Mc / Admin", 403) };
  return r;
}

/** ไฟล์ตรงกับชนิดที่บอกจริงไหม (ดูจากไบต์แรก) */
async function realType(file: File) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "%PDF") return "application/pdf";
  return "";
}

export async function GET() {
  const r = await requireCrew();
  if ("res" in r) return r.res;
  const db = createAdminClient();
  const [{ row, error }, need] = await Promise.all([loadPayDocs(db, r.me.email), payDocsNeed(db, r.me.email)]);
  if (error) return payDocsFail(error);
  return ok<MyPayDocs>({ ...need, docs: row ? viewOf(row) : null });
}

export async function POST(request: Request) {
  const r = await requireCrew();
  if ("res" in r) return r.res;
  const form = await request.formData().catch(() => null);
  if (!form) return fail("ข้อมูลไม่ครบ หรือไฟล์ใหญ่เกินไป ลองใหม่อีกครั้ง");

  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(String(form.get("info") ?? "{}")); } catch {}
  const c = cleanPayInfo(raw);
  if ("error" in c) return fail(c.error);

  const db = createAdminClient();
  const email = r.me.email;
  const { row: cur, error: loadErr } = await loadPayDocs(db, email);
  if (loadErr) return payDocsFail(loadErr);

  // ไฟล์ใหม่ (ไม่แนบ = ใช้ของเดิม ครั้งแรกต้องแนบครบ)
  const files: [PayDocKind, File, string][] = [];
  for (const kind of KINDS) {
    const f = form.get(kind);
    if (f instanceof File && f.size) {
      const type = await realType(f);
      if (!type || !PAY_DOC_TYPES.includes(type)) return fail(`${PAY_DOC_LABEL[kind]}: รองรับเฉพาะรูป JPG / PNG / WebP หรือไฟล์ PDF`);
      if (f.size > PAY_DOC_MAX_BYTES) return fail(`${PAY_DOC_LABEL[kind]}: ไฟล์ใหญ่เกินไป (ไม่เกิน 2 MB)`);
      files.push([kind, f, type]);
    } else if (!cur) {
      return fail(`กรุณาแนบ${PAY_DOC_LABEL[kind]}`);
    }
  }

  const uploaded: Partial<Record<PayDocKind, string>> = {};
  const cleanup = () => {
    const paths = Object.values(uploaded);
    return paths.length ? db.storage.from(PAY_DOCS_BUCKET).remove(paths) : undefined;
  };
  for (const [kind, f, type] of files) {
    const ext = type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    const path = `${kind}/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from(PAY_DOCS_BUCKET).upload(path, f, { contentType: type });
    if (up.error) {
      await cleanup();
      return fail("อัปโหลดไฟล์ไม่สำเร็จ: " + up.error.message, 500);
    }
    uploaded[kind] = path;
  }

  const i = c.info;
  const next = {
    email, full_name: i.fullName, id_card_no: i.idCardNo, address: i.address, bank: i.bank, account_no: i.accountNo, account_name: i.accountName,
    id_card_path: uploaded.id_card ?? cur!.id_card_path,
    bank_book_path: uploaded.bank_book ?? cur!.bank_book_path,
    // ยังไม่ขึ้น Drive (ชุดใหม่) — ส่งด้านล่าง
    drive_error: null, drive_synced_at: null, updated_at: new Date().toISOString(),
  };
  const { data: saved, error } = await db.from("pay_docs").upsert(next, { onConflict: "email" }).select("*").single();
  if (error || !saved) {
    await cleanup();
    return fail("บันทึกเอกสารไม่สำเร็จ: " + (error?.message ?? ""), 500);
  }
  // ไฟล์เดิมที่ถูกแทนที่
  const old = KINDS.filter((k) => uploaded[k] && cur).map((k) => cur![PATH_COL[k]]);
  if (old.length) await db.storage.from(PAY_DOCS_BUCKET).remove(old);

  const name = r.me.mc ? `Mc ${r.me.mc.name}` : r.me.admin!.name;
  await db.from("booking_logs").insert({
    email, role: r.me.mc ? "Mc" : "Admin", name,
    action: cur ? `แก้เอกสารทำเบิก${files.length ? ` (เปลี่ยน${files.map(([k]) => PAY_DOC_LABEL[k].replace("รูป", "")).join(" + ")})` : ""}` : "ส่งเอกสารทำเบิก",
    result: "สำเร็จ",
  });
  // หลังตอบผู้ใช้: สำเนาขึ้น Google Drive (พลาดไม่กระทบการส่งเอกสาร)
  after(() => syncPayDocsToDrive(email).then(() => undefined).catch((err) => console.warn("ส่งเอกสารทำเบิกขึ้น Drive ไม่สำเร็จ:", err)));
  return ok({ message: cur ? "บันทึกเอกสารแล้ว" : "ส่งเอกสารทำเบิกแล้ว ขอบคุณ", docs: viewOf(saved as PayDocsRow) });
}
