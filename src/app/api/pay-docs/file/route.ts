import { NextResponse } from "next/server";
import { fail, requireMe } from "@/lib/api";
import { PAY_DOCS_BUCKET, loadPayDocs, payDocsFail, requirePayDocsViewer } from "@/lib/pay-docs-db";
import { createAdminClient } from "@/lib/supabase/server";

// เปิดไฟล์เอกสารทำเบิก (?kind=id_card|bank_book) -> ส่งต่อไปลิงก์ชั่วคราว (หมดอายุใน 2 นาที)
//   ไม่ใส่ staff = ของตัวเอง / &staff=<id> = ของคนนั้น (เฉพาะ Owner ที่ดูเอกสารทำเบิกได้)
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  if (kind !== "id_card" && kind !== "bank_book") return fail("ไม่รู้จักไฟล์นี้");
  const r = params.has("staff")
    ? await requirePayDocsViewer(params.get("staff"))
    : await requireMe().then((x) => ("res" in x ? x : { ...x, email: x.me.email }));
  if ("res" in r) return r.res;
  const email = r.email;

  const db = createAdminClient();
  const { row, error } = await loadPayDocs(db, email);
  if (error) return payDocsFail(error);
  if (!row) return fail("ยังไม่มีเอกสาร", 404);
  const { data, error: urlErr } = await db.storage.from(PAY_DOCS_BUCKET)
    .createSignedUrl(kind === "id_card" ? row.id_card_path : row.bank_book_path, 120);
  if (urlErr || !data) return fail("เปิดไฟล์ไม่สำเร็จ: " + (urlErr?.message ?? ""), 500);
  const res = NextResponse.redirect(data.signedUrl);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
