import "server-only";
import { notify, notifyMany, type Note } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/server";
import {
  ACTION_TO, HOLDING, LOAN_STATUS_TEXT, canAct, isLiveRoom, liveBlocks, shortages,
  type Loan, type LoanAction, type LoanInput, type LoanStatus, type Stock,
} from "@/lib/loans";

/**
 * ขอยืมอุปกรณ์ (ตาราง equipment_loans / equipment_loan_items — SQL 20261110000000_equipment_loans) สูตร / ตรวจฟอร์มอยู่ที่ src/lib/loans.ts
 *   ผู้ยืม = บัญชีทีมอื่น (staff role borrower) + Marketing (me.borrower ใน src/lib/auth.ts) · ผู้อนุมัติ = คนที่เข้าหน้าอุปกรณ์ได้ (me.equipment)
 *   แจ้งเตือน: คำขอใหม่ / ผู้ยืมยกเลิก → ผู้อนุมัติ · อนุมัติ / ไม่อนุมัติ / ยกเลิกโดยทีมเรา → ผู้ยืม · ใกล้ถึง / เลยกำหนดคืน (cron)
 */

export const LOANS_SQL = "ต้องรัน SQL 20261110000000_equipment_loans ใน Supabase ก่อน";
const sqlMsg = (m: string) => (/equipment_loan|schema cache|does not exist/i.test(m) ? LOANS_SQL : m);
const BUCKET = "equipment";
const SELECT = "*, items:equipment_loan_items(equipment_id, quantity, equipment:equipment(name, code, category))";

type LoanRow = {
  id: number; status: LoanStatus; requester_id: number | null; requester_name: string; requester_email: string; team: string; phone: string;
  location: string; purpose: string; start_at: string; end_at: string; decided_by: string | null; decided_at: string | null; reject_reason: string;
  handed_by: string | null; handed_at: string | null; returned_by: string | null; returned_at: string | null; return_note: string; created_at: string;
  items: { equipment_id: number; quantity: number; equipment: { name: string; code: string | null; category: string } | null }[] | null;
};

const toLoan = (r: LoanRow): Loan => ({
  id: Number(r.id), status: r.status,
  requester: { id: r.requester_id, name: r.requester_name, email: r.requester_email, team: r.team, phone: r.phone },
  location: r.location, purpose: r.purpose, startAt: r.start_at, endAt: r.end_at,
  items: (r.items ?? []).map((i) => ({
    equipmentId: Number(i.equipment_id), quantity: i.quantity,
    name: i.equipment?.name ?? "(ลบรายการแล้ว)", code: i.equipment?.code ?? "", category: i.equipment?.category ?? "",
  })).sort((a, b) => a.category.localeCompare(b.category, "th") || a.name.localeCompare(b.name, "th")),
  decidedBy: r.decided_by, decidedAt: r.decided_at, rejectReason: r.reject_reason,
  handedBy: r.handed_by, handedAt: r.handed_at, returnedBy: r.returned_by, returnedAt: r.returned_at, returnNote: r.return_note,
  createdAt: r.created_at,
});

const fmtWhen = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });
const when = (iso: string | number) => fmtWhen.format(new Date(iso));
const itemsText = (l: Loan) => l.items.map((i) => `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ""}`).join(", ");
const whoText = (l: Loan) => `${l.requester.name}${l.requester.team ? ` (${l.requester.team})` : ""}`;
const periodText = (l: Loan) => `${when(l.startAt)} – ${when(l.endAt)}`;

/**
 * อุปกรณ์ที่ให้ยืมได้ (สถานะใช้งานได้) + ช่วงที่ถูกกันไว้ (ไม่บอกว่าใครยืม) + ช่วงที่ห้องไลฟ์มีไลฟ์ (ไฟประจำห้องต้องเหลือ 2 ชุด)
 *   ไลฟ์ = slot Mc ที่ไม่ยกเลิก ตั้งแต่เมื่อวานถึงอีก 100 วัน · ช่อง → ห้อง ตามชื่อที่เก็บ (src/lib/loans.ts roomForPlatform)
 */
export async function loanCatalog(): Promise<Stock> {
  const db = createAdminClient();
  const now = Date.now();
  const [eq, loans, slots] = await Promise.all([
    db.from("equipment").select("id, code, name, category, quantity, photo_path, location, status").gt("quantity", 0)
      .order("category").order("code").order("name"),
    db.from("equipment_loans").select("id, start_at, end_at, items:equipment_loan_items(equipment_id, quantity)")
      .in("status", HOLDING).gte("end_at", new Date(now - 86400_000).toISOString()),
    db.from("mc_slots").select("platform, starts_at, ends_at").eq("is_cancelled", false)
      .gte("ends_at", new Date(now - 86400_000).toISOString()).lte("starts_at", new Date(now + 100 * 86400_000).toISOString()).limit(5000),
  ]);
  if (eq.error) throw new Error(eq.error.message);
  if (loans.error) throw new Error(sqlMsg(loans.error.message));
  type EqRow = { id: number; code: string | null; name: string; category: string; quantity: number; photo_path: string | null; location: string; status: string };
  const all = (eq.data ?? []) as EqRow[];
  const rooms = [...new Set(all.map((x) => x.location).filter(isLiveRoom))];
  const live = liveBlocks((slots.data ?? []).map((s) => ({ platform: String(s.platform), startMs: Date.parse(s.starts_at), endMs: Date.parse(s.ends_at) })), rooms);
  const rows = all.filter((x) => x.status === "ใช้งานได้");
  const paths = rows.map((x) => x.photo_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  type HoldRow = { id: number; start_at: string; end_at: string; items: { equipment_id: number; quantity: number }[] | null };
  return {
    catalog: rows.map((x) => ({
      id: Number(x.id), code: x.code ?? "", name: x.name, category: x.category, quantity: x.quantity,
      photoUrl: x.photo_path ? urls.get(x.photo_path) ?? null : null, room: isLiveRoom(x.location) ? x.location : null,
    })),
    holds: ((loans.data ?? []) as HoldRow[]).flatMap((l) => (l.items ?? []).map((i) => ({
      loanId: Number(l.id), equipmentId: Number(i.equipment_id), quantity: i.quantity, startMs: Date.parse(l.start_at), endMs: Date.parse(l.end_at),
    }))),
    live,
  };
}

/** คำขอยืม: ของคนนี้ (requesterId) หรือทั้งหมด (ผู้อนุมัติ) ใหม่สุดก่อน */
export async function listLoans(requesterId?: number): Promise<Loan[]> {
  let q = createAdminClient().from("equipment_loans").select(SELECT).order("created_at", { ascending: false }).limit(300);
  if (requesterId) q = q.eq("requester_id", requesterId);
  const { data, error } = await q;
  if (error) throw new Error(sqlMsg(error.message));
  return ((data ?? []) as unknown as LoanRow[]).map(toLoan);
}

async function loanById(id: number) {
  const { data, error } = await createAdminClient().from("equipment_loans").select(SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(sqlMsg(error.message));
  return data ? toLoan(data as unknown as LoanRow) : null;
}

/**
 * อีเมลคนที่อนุมัติได้: Owner ที่จัดการ Mc หรือ Admin ได้ + Admin ที่ติ๊กหน้าอุปกรณ์ (ตรงกับ me.equipment ใน src/lib/auth.ts)
 *   คนเดียวเป็นทั้ง Owner และ Admin (อีเมลเดียวกัน) = นับครั้งเดียว ไม่งั้นได้แจ้งเตือนซ้ำ
 */
export async function equipmentManagerEmails() {
  const db = createAdminClient();
  const [owners, admins] = await Promise.all([
    db.from("staff").select("email, can_manage_mc, can_manage_admin").eq("role", "owner").not("email", "is", null),
    db.from("staff").select("email, can_manage_equipment").eq("role", "admin").not("email", "is", null),
  ]);
  return [...new Set([
    ...(owners.data ?? []).filter((o) => o.can_manage_mc !== false || o.can_manage_admin !== false).map((o) => String(o.email)),
    ...(admins.error ? [] : admins.data ?? []).filter((a) => a.can_manage_equipment === true).map((a) => String(a.email)),
  ].map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

async function log(email: string, name: string, action: string, id: number) {
  await createAdminClient().from("booking_logs").insert({ email, role: "ยืมอุปกรณ์", name, action, slot_table: "equipment_loans", slot_id: id, result: "สำเร็จ" });
}

/** ส่งคำขอยืม (ผู้ยืม) — ของไม่พอในช่วงนั้น = error บอกว่าเหลือเท่าไร */
export async function createLoan(me: { id: number; name: string; email: string; team: string }, input: LoanInput) {
  const short = shortages(input.items, await loanCatalog(), input.startMs, input.endMs);
  if (short.length) return { error: `ช่วงนี้ของไม่พอ: ${short.map((s) => `${s.name} เหลือ ${s.left} (ขอ ${s.want})`).join(" · ")}` };
  const db = createAdminClient();
  const { data, error } = await db.from("equipment_loans").insert({
    requester_id: me.id, requester_name: me.name, requester_email: me.email, team: input.team || me.team, phone: input.phone,
    location: input.location, purpose: input.purpose, start_at: new Date(input.startMs).toISOString(), end_at: new Date(input.endMs).toISOString(),
  }).select("id").single();
  if (error) return { error: sqlMsg(error.message) };
  const id = Number(data.id);
  const { error: itemErr } = await db.from("equipment_loan_items").insert(input.items.map((i) => ({ loan_id: id, equipment_id: i.equipmentId, quantity: i.quantity })));
  if (itemErr) {
    await db.from("equipment_loans").delete().eq("id", id);
    return { error: sqlMsg(itemErr.message) };
  }
  const loan = await loanById(id);
  if (loan) {
    await Promise.all([
      log(me.email, me.name, `ขอยืม: ${itemsText(loan)} (${periodText(loan)})`, id),
      notify(await equipmentManagerEmails(), {
        kind: "loan", page: "equipment", title: `คำขอยืมใหม่: ${whoText(loan)}`,
        body: `${itemsText(loan)}\n${periodText(loan)} · ใช้ที่ ${loan.location}${loan.purpose ? `\n${loan.purpose}` : ""}`,
      }),
    ]);
  }
  return { id };
}

const ACTION_TEXT: Record<LoanAction, string> = { approve: "อนุมัติ", reject: "ไม่อนุมัติ", handover: "ส่งของให้ยืมแล้ว", return: "รับคืนแล้ว", cancel: "ยกเลิก" };

/**
 * เปลี่ยนสถานะ — requesterId = ผู้ยืมกดเอง (ยกเลิกได้อย่างเดียว เฉพาะคำขอของตัวเอง)
 *   อนุมัติ: ตรวจของพออีกรอบ (คำขออื่นอาจอนุมัติไปก่อน) · อัปเดตเฉพาะเมื่อสถานะยังเป็นค่าเดิม (กดพร้อมกัน 2 คน = คนหลังได้ error)
 */
export async function actOnLoan(id: number, action: LoanAction, actor: { email: string; name: string; requesterId?: number }, extra: { reason?: string; note?: string } = {}) {
  const loan = await loanById(id);
  if (!loan) return { error: "ไม่พบคำขอนี้" };
  if (actor.requesterId !== undefined) {
    if (loan.requester.id !== actor.requesterId) return { error: "ไม่พบคำขอนี้" };
    if (action !== "cancel") return { error: "ผู้ยืมยกเลิกคำขอได้อย่างเดียว" };
  }
  if (!canAct(loan.status, action)) return { error: `คำขอนี้${ACTION_TEXT[action]}ไม่ได้แล้ว (ตอนนี้: ${LOAN_STATUS_TEXT[loan.status]})` };
  if (action === "approve") {
    const short = shortages(loan.items, await loanCatalog(), Date.parse(loan.startAt), Date.parse(loan.endAt), id);
    if (short.length) return { error: `อนุมัติไม่ได้ ของไม่พอในช่วงนี้: ${short.map((s) => `${s.name} เหลือ ${s.left} (ขอ ${s.want})`).join(" · ")}` };
  }
  const now = new Date().toISOString();
  const reason = (extra.reason ?? "").trim().slice(0, 300), note = (extra.note ?? "").trim().slice(0, 300);
  const patch: Record<string, unknown> = { status: ACTION_TO[action], updated_at: now };
  if (action === "approve" || action === "reject") Object.assign(patch, { decided_by: actor.name, decided_at: now });
  if (action === "reject") patch.reject_reason = reason;
  if (action === "handover") Object.assign(patch, { handed_by: actor.name, handed_at: now });
  if (action === "return") Object.assign(patch, { returned_by: actor.name, returned_at: now, return_note: note });
  if (action === "cancel" && reason) patch.reject_reason = reason;
  const { data, error } = await createAdminClient().from("equipment_loans").update(patch).eq("id", id).eq("status", loan.status).select("id");
  if (error) return { error: sqlMsg(error.message) };
  if (!data?.length) return { error: "คำขอนี้เพิ่งถูกเปลี่ยนสถานะโดยคนอื่น โหลดใหม่แล้วลองอีกครั้ง" };

  // แจ้งเตือน: ผู้ยืมยกเลิกเอง → ผู้อนุมัติ · ทีมเราอนุมัติ / ไม่อนุมัติ / ยกเลิก → ผู้ยืม
  const notes: (Note & { email: string })[] = [];
  const head = `${itemsText(loan)}\n${periodText(loan)} · ใช้ที่ ${loan.location}`;
  if (actor.requesterId !== undefined) {
    for (const email of await equipmentManagerEmails()) {
      notes.push({ email, kind: "loan", page: "equipment", title: `${whoText(loan)} ยกเลิกคำขอยืม`, body: head });
    }
  } else if (action === "approve" || action === "reject" || action === "cancel") {
    const title = action === "approve" ? "อนุมัติคำขอยืมแล้ว" : action === "reject" ? "คำขอยืมไม่ได้รับอนุมัติ" : "คำขอยืมถูกยกเลิก";
    const why = reason ? `\nเหตุผล: ${reason}` : "";
    notes.push({ email: loan.requester.email, kind: "loan", page: "borrow", title, body: `${head}${why}${action === "approve" ? `\nมารับของตามวันเวลายืม (${when(loan.startAt)})` : ""}` });
  }
  await Promise.all([
    notifyMany(notes),
    log(actor.email, actor.name, `${ACTION_TEXT[action]}คำขอยืม #${id} ของ ${whoText(loan)}${reason ? ` (${reason})` : ""}${note ? ` · สภาพ: ${note}` : ""}`, id),
  ]);
  return { ok: true };
}

/**
 * เตือนคืนของ (cron ทุก 15 นาที) — ยืมอยู่และเหลือไม่ถึง 24 ชม. → ผู้ยืม (ครั้งเดียว)
 *   เลยกำหนดคืน → ผู้ยืม + ผู้อนุมัติ (วันละครั้ง)
 */
export async function sendLoanReminders(now = Date.now(), dryRun = false) {
  try {
    const { data, error } = await createAdminClient().from("equipment_loans").select(SELECT).eq("status", "borrowed")
      .lte("end_at", new Date(now + 86400_000).toISOString());
    if (error) return 0;
    const day = new Date(now + 7 * 3600_000).toISOString().slice(0, 10);
    const managers = await equipmentManagerEmails();
    const items: (Note & { email: string })[] = [];
    for (const loan of ((data ?? []) as unknown as LoanRow[]).map(toLoan)) {
      const end = Date.parse(loan.endAt), head = `${itemsText(loan)}\nกำหนดคืน ${when(loan.endAt)}`;
      if (end > now) {
        items.push({ email: loan.requester.email, kind: "loan", page: "borrow", dedupe: `loan_due:${loan.id}`, title: "ใกล้ถึงกำหนดคืนอุปกรณ์", body: head });
      } else {
        items.push({ email: loan.requester.email, kind: "loan", page: "borrow", dedupe: `loan_late:${loan.id}:${day}`, title: "[เลยกำหนดคืน] กรุณาคืนอุปกรณ์", body: head });
        for (const email of managers) {
          items.push({ email, kind: "loan", page: "equipment", dedupe: `loan_late:${loan.id}:${day}`, title: `[เลยกำหนดคืน] ${whoText(loan)}`, body: head });
        }
      }
    }
    return dryRun ? items.length : notifyMany(items);
  } catch (err) {
    console.error("เตือนคืนอุปกรณ์ไม่สำเร็จ:", err);
    return 0;
  }
}
