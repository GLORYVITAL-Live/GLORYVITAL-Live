import { fail, ok } from "@/lib/api";
import { docsFolderName, docsFolderOptions, driveFolderUrl, syncPayDocsToDrive } from "@/lib/drive";
import { DRIVE_LINK_SQL, loadPayDocs, payDocsFail, requirePayDocsViewer, viewOf, type CrewRow } from "@/lib/pay-docs-db";
import { createAdminClient } from "@/lib/supabase/server";
import type { OwnerPayDocs } from "@/lib/types";

// เอกสารทำเบิกของ Mc / Admin (เฉพาะ Owner ที่ตั้ง can_view_pay_docs) — ระบุคนด้วย id ในตาราง staff
//   GET   ?id=[&folders=1]   ข้อมูล + สถานะสำเนาใน Google Drive + โฟลเดอร์เอกสารเดิมที่ผูกไว้ (+ ตัวเลือกให้ผูก)
//   POST  { id }             ส่งขึ้น Google Drive ใหม่
//   PATCH { id, folderId }   ผูกกับโฟลเดอร์เอกสารเดิมใน Drive เอง (folderId = null = ยกเลิกการผูก)

async function view(person: CrewRow, withFolders = false) {
  const { row, error } = await loadPayDocs(createAdminClient(), person.email!);
  if (error) return payDocsFail(error);
  const linkedId = person.pay_docs_drive_folder || null;
  const [linkedName, folders] = await Promise.all([
    linkedId ? docsFolderName(person.role, linkedId).catch(() => null) : null,
    withFolders ? docsFolderOptions(person.role).catch(() => []) : undefined,
  ]);
  return ok<OwnerPayDocs>({
    docs: row ? viewOf(row) : null,
    drive: {
      folders: (["mc", "admin"] as const).flatMap((role) => (row?.drive_folders?.[role] ? [{ role, url: driveFolderUrl(row.drive_folders[role]!) }] : [])),
      error: row?.drive_error ?? null,
      syncedAt: row?.drive_synced_at ?? null,
      pending: !!row && !row.drive_synced_at,
    },
    linked: linkedId ? { id: linkedId, name: linkedName ?? "", url: driveFolderUrl(linkedId) } : null,
    ...(folders ? { folders } : {}),
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const r = await requirePayDocsViewer(params.get("id"));
  if ("res" in r) return r.res;
  return view(r.person, params.has("folders"));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const r = await requirePayDocsViewer(body?.id);
  if ("res" in r) return r.res;
  const res = await syncPayDocsToDrive(r.email);
  if (!res.ok) return fail(res.error ?? "ส่งขึ้น Google Drive ไม่สำเร็จ");
  return view(r.person);
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const r = await requirePayDocsViewer(body?.id);
  if ("res" in r) return r.res;
  if (!("pay_docs_drive_folder" in r.person)) return fail(DRIVE_LINK_SQL);
  const folderId = body?.folderId ? String(body.folderId) : null;
  if (folderId && (await docsFolderName(r.person.role, folderId).catch(() => null)) === null) {
    return fail(`ไม่พบโฟลเดอร์นี้ในโฟลเดอร์เอกสารทำเบิก${r.person.role === "mc" ? " Mc" : " Admin"}`);
  }
  const { error } = await createAdminClient().from("staff").update({ pay_docs_drive_folder: folderId }).eq("id", r.person.id);
  if (error) return fail(error.message, 500);
  return view({ ...r.person, pay_docs_drive_folder: folderId }, true);
}
