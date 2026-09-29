/**
 * นำเข้าข้อมูลจาก Google Sheet "LIVE GLORY 2026" -> Supabase
 *
 *   bun run import:sheet            นำเข้าจริง
 *   bun run import:sheet --dry-run  อ่านชีตแล้วสรุปจำนวน ไม่เขียน DB
 *   bun run import:sheet --no-settings  นำเข้าโดยไม่แตะการตั้งค่า (รอบสุดท้ายตอนย้ายระบบ)
 *
 * อ่านชีตในนามบัญชีที่เชื่อมไว้ด้วย `bun run google:auth` (ต้องเปิดชีตนี้ได้) และตั้งค่าใน .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SHEET_ID (ไม่ใส่ = ชีตเดิม)
 *
 * รันซ้ำได้: slot จับคู่ด้วยเลขแถวในชีต (sheet_row) คน จับคู่ด้วย บทบาท + ชื่อ
 * ข้อควรระวัง: รันซ้ำหลังเปิดใช้ระบบใหม่แล้ว จะเขียนทับการจองในระบบใหม่ด้วยข้อมูลในชีต
 */
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { googleAuth } from "../src/lib/google";

const SHEET_ID = process.env.SHEET_ID || "1r17--dnbXyVk416Zc3mGwUb-aDw3OCxelOC25NJW7Xo";
const DRY = process.argv.includes("--dry-run");

// หลังเปิดซิงค์สองทางแล้ว สคริปต์นี้อันตราย (เขียนทับทั้งชีต) ให้ใช้ปุ่ม "ซิงค์จากชีตทั้งหมด" ในหน้าเจ้าของแทน
if (!DRY && !process.argv.includes("--overwrite-everything")) {
  console.error(
    "⛔ ระบบใช้ซิงค์สองทางกับชีตแล้ว สคริปต์นี้จะเขียนทับทุก slot ในเว็บด้วยค่าในชีต\n" +
    "   ให้ใช้ปุ่ม \"ซิงค์จากชีตทั้งหมด\" ในหน้าเจ้าของแทน\n" +
    "   ถ้าแน่ใจจริงๆ ให้รันพร้อม --overwrite-everything",
  );
  process.exit(1);
}
// ไม่แตะตาราง settings (ใช้ตอนย้ายระบบรอบสุดท้าย เพราะ B1 ในชีตจะเป็นข้อความปิดเว็บเก่า)
const NO_SETTINGS = process.argv.includes("--no-settings");

const TAB = {
  mc: "ลงตาราง Deal Mc",
  admin: "ลงตาราง Admin เสริม",
  mcEmail: "Mc Email",
  adminEmail: "Admin Email",
  ownerEmail: "Owner Email",
  phones: "เบอร์โทร MC",
  settings: "การตั้งค่าเว็บ",
};
const MC_FIRST_ROW = 4;

type Cell = string | number | boolean | undefined;
type Row = Cell[];

// ---------- อ่านชีต ----------

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`ยังไม่ได้ตั้งค่า ${name} ใน .env.local`);
  return v;
}

async function readTabs() {
  const auth = googleAuth();
  if (!auth) throw new Error("ยังไม่ได้เชื่อมบัญชี Google — รัน bun run google:auth ก่อน");
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "sheets.properties.title" });
  const titles = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? "");
  // หาแท็บแบบไม่สนตัวพิมพ์ใหญ่-เล็กและช่องว่างหัวท้าย (เหมือน getSheetCI_ เดิม)
  const find = (name: string) => titles.find((t) => t === name) ?? titles.find((t) => t.trim().toLowerCase() === name.toLowerCase());

  const wanted = Object.values(TAB).map(find).filter((t): t is string => !!t);
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges: wanted.map((t) => `'${t.replace(/'/g, "''")}'`),
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  const byTitle = new Map<string, Row[]>();
  (res.data.valueRanges ?? []).forEach((vr, i) => byTitle.set(wanted[i], (vr.values ?? []) as Row[]));
  return (name: string): Row[] => {
    const t = find(name);
    if (!t) console.warn(`⚠️ ไม่พบแท็บ "${name}"`);
    return (t && byTitle.get(t)) || [];
  };
}

// ---------- แปลงค่า ----------

const str = (v: Cell) => String(v ?? "").trim();
const normalizeMcName = (v: Cell) => str(v).replace(/^mc\s*/i, "").trim();
const email = (v: Cell) => { const e = str(v).toLowerCase(); return e.includes("@") ? e : null; };
const rate = (v: Cell) => { const n = Number(str(v).replace(/[,\s฿]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };

/** serial ของ Google Sheets (วันตั้งแต่ 30 ธ.ค. 1899) -> "YYYY-MM-DD" */
function serialDate(v: Cell) {
  if (typeof v !== "number" || v < 1) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400_000).toISOString().slice(0, 10);
}
/** เศษส่วนของวันใน serial -> "HH:MM" */
function serialTime(v: Cell) {
  if (typeof v !== "number") return null;
  const mins = Math.round((v - Math.floor(v)) * 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}
const confirmed = (v: Cell) => (v === true || v === "TRUE" ? true : v === false || v === "FALSE" ? false : null);
/** CalendarApp ให้ id แบบ "xxx@google.com" ส่วน Calendar API ใช้แค่ "xxx" */
const eventId = (v: Cell) => str(v).replace(/@google\.com$/, "") || null;

// ---------- main ----------

async function main() {
  const tab = await readTabs();
  const db = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  // --- คน ---
  type Staff = { role: "mc" | "admin" | "owner"; name: string; email: string | null; phone: string | null; hourly_rate: number | null; is_extra_admin: boolean };
  const staff = new Map<string, Staff>();
  const person = (role: Staff["role"], name: string) => {
    const k = `${role}|${name}`;
    if (!staff.has(k)) staff.set(k, { role, name, email: null, phone: null, hourly_rate: null, is_extra_admin: false });
    return staff.get(k)!;
  };

  for (const r of tab(TAB.mcEmail).slice(1)) {
    const n = normalizeMcName(r[0]);
    if (!n) continue;
    const p = person("mc", n);
    p.email = email(r[1]) ?? p.email;
    p.hourly_rate = rate(r[3]) ?? p.hourly_rate;
  }
  for (const r of tab(TAB.adminEmail).slice(1)) {
    const n = str(r[0]);
    if (!n || !email(r[1])) continue; // ข้ามหัวตารางที่คั่นกลาง
    const p = person("admin", n);
    p.email = email(r[1]);
    p.hourly_rate = rate(r[3]) ?? p.hourly_rate;
  }
  for (const r of tab(TAB.ownerEmail).slice(1)) {
    const n = str(r[0]);
    if (n && email(r[1])) person("owner", n).email = email(r[1]);
  }

  const phoneRows = tab(TAB.phones);
  for (const r of phoneRows) {
    // A,B = Mc + เบอร์
    const mcName = normalizeMcName(r[0]);
    const mcPhone = str(r[1]);
    if (mcName && mcPhone && str(r[0]).toUpperCase() !== "MC NAME" && mcPhone !== "เบอร์โทรศัพท์") person("mc", mcName).phone = mcPhone;
  }
  // D,E = Admin + เบอร์ (มีหัวตาราง "Admin" คั่นกลาง) และรายชื่อหมวด "Admin เสริม"
  let inExtra = false;
  for (const r of phoneRows) {
    const n = str(r[3]);
    const ph = str(r[4]);
    if (n === "Admin เสริม") { inExtra = true; continue; }
    if (inExtra && !n) inExtra = false;
    if (!n || n === "Admin") continue;
    if (inExtra) person("admin", n).is_extra_admin = true;
    if (ph && ph !== "เบอร์โทรศัพท์") person("admin", n).phone = ph;
  }

  // --- slot ของ Mc ---
  type Slot = Record<string, unknown>;
  const mcSlots: (Slot & { mcName: string })[] = [];
  tab(TAB.mc).forEach((r, i) => {
    const row = i + 1;
    if (row < MC_FIRST_ROW) return;
    const date = serialDate(r[2]), start = serialTime(r[3]), end = serialTime(r[4]);
    if (!date || !start || !end) return;
    const mcName = normalizeMcName(r[8]);
    if (mcName) person("mc", mcName);
    const calEmail = email(r[14]);
    mcSlots.push({
      sheet_row: row, platform: str(r[1]), live_date: date, start_time: start, end_time: end,
      campaign: str(r[7]), confirmed: confirmed(r[9]), status: str(r[10]), remark: str(r[11]),
      calendar_email: calEmail && eventId(r[15]) ? calEmail : null, calendar_event_id: calEmail ? eventId(r[15]) : null,
      mcName,
    });
  });

  // --- slot ของ Admin ---
  const adminSlots: (Slot & { adminName: string })[] = [];
  tab(TAB.admin).forEach((r, i) => {
    const date = serialDate(r[2]), start = serialTime(r[3]), end = serialTime(r[4]);
    if (!date || !start || !end) return;
    const adminName = str(r[7]);
    if (adminName) person("admin", adminName);
    const [calEmail, calId] = str(r[12]).split("|");
    adminSlots.push({
      sheet_row: i + 1, platform: str(r[1]), live_date: date, start_time: start, end_time: end,
      confirmed: confirmed(r[8]), remark: str(r[9]), status: str(r[10]),
      calendar_email: email(calEmail) && calId ? email(calEmail) : null, calendar_event_id: email(calEmail) && calId ? eventId(calId) : null,
      adminName,
    });
  });

  // --- ตั้งค่า ---
  const s = tab(TAB.settings);
  const b = (n: number) => s[n - 1]?.[1];
  const cutoffRaw = b(2);
  const cutoff = typeof cutoffRaw === "number" ? serialDate(cutoffRaw)?.slice(0, 7) : str(cutoffRaw).match(/^(\d{4})-(\d{1,2})$/)
    ? str(cutoffRaw).replace(/-(\d)$/, "-0$1") : null;
  const settings = {
    site_notice: str(b(1)),
    schedule_cutoff_month: cutoff ?? null,
    // B3 ต้องเป็นข้อความ (บางครั้งเป็นวันที่ -> ไม่ใช้ ให้ระบบสร้างข้อความเอง)
    schedule_notice: typeof b(3) === "string" ? str(b(3)) : "",
    admin_chat_url: /^https?:\/\//i.test(str(b(4))) ? str(b(4)) : "",
    default_mc_rate: rate(b(5)) ?? 0,
    default_admin_rate: rate(b(6)) ?? 0,
  };

  // อีเมลซ้ำในบทบาทเดียวกัน -> เก็บคนแรก (ไม่งั้นติด unique index)
  const seen = new Set<string>();
  for (const p of staff.values()) {
    if (!p.email) continue;
    const k = `${p.role}|${p.email}`;
    if (seen.has(k)) { console.warn(`⚠️ อีเมลซ้ำ ${p.email} (${p.role} ${p.name}) ข้ามอีเมลนี้`); p.email = null; }
    seen.add(k);
  }

  const count = (role: string) => [...staff.values()].filter((p) => p.role === role).length;
  console.log(`คน: Mc ${count("mc")} | Admin ${count("admin")} (เสริม ${[...staff.values()].filter((p) => p.is_extra_admin).length}) | Owner ${count("owner")}`);
  console.log(`slot: Mc ${mcSlots.length} (มีคนจอง ${mcSlots.filter((x) => x.mcName).length}) | Admin ${adminSlots.length}`);
  console.log("ตั้งค่า:", settings);
  if (DRY) { console.log("(dry run — ไม่ได้เขียน DB)"); return; }

  // --- เขียน DB ---
  const check = <T>(res: { error: unknown; data?: T | null }) => { if (res.error) throw res.error; return res.data as T; };
  if (NO_SETTINGS) console.log("(--no-settings: ไม่แตะการตั้งค่าในระบบใหม่)");
  else check(await db.from("settings").update(settings).eq("id", 1));
  check(await db.from("staff").upsert([...staff.values()], { onConflict: "role,name" }));

  const ids = new Map<string, number>();
  const all = check<{ id: number; role: string; name: string }[]>(await db.from("staff").select("id, role, name"));
  for (const p of all) ids.set(`${p.role}|${p.name}`, p.id);

  // event ในปฏิทินที่ระบบใหม่สร้าง/แก้ไปแล้ว ให้ใช้ค่าในระบบใหม่ (ค่าในชีตอาจเป็น event เก่าที่ถูกลบไปแล้ว)
  const calendarInDb = async (table: string) => {
    const map = new Map<number, { calendar_email: string; calendar_event_id: string }>();
    for (let from = 0; ; from += 1000) {
      const page = check<{ sheet_row: number; calendar_email: string; calendar_event_id: string }[]>(
        await db.from(table).select("sheet_row, calendar_email, calendar_event_id")
          .not("sheet_row", "is", null).not("calendar_event_id", "is", null).range(from, from + 999),
      );
      for (const r of page) map.set(r.sheet_row, { calendar_email: r.calendar_email, calendar_event_id: r.calendar_event_id });
      if (page.length < 1000) return map;
    }
  };

  const batches = async (table: string, raw: Slot[]) => {
    const keep = await calendarInDb(table);
    let kept = 0;
    const rows = raw.map((r) => {
      const k = keep.get(r.sheet_row as number);
      if (!k || (k.calendar_email === r.calendar_email && k.calendar_event_id === r.calendar_event_id)) return r;
      kept++;
      return { ...r, ...k };
    });
    if (kept) console.log(`${table}: ใช้ event ปฏิทินจากระบบใหม่แทนค่าในชีต ${kept} แถว`);
    for (let i = 0; i < rows.length; i += 500) {
      check(await db.from(table).upsert(rows.slice(i, i + 500), { onConflict: "sheet_row" }));
      process.stdout.write(`\r${table}: ${Math.min(i + 500, rows.length)}/${rows.length}`);
    }
    process.stdout.write("\n");
  };
  await batches("mc_slots", mcSlots.map(({ mcName, ...x }) => ({ ...x, mc_id: mcName ? ids.get(`mc|${mcName}`) ?? null : null })));
  await batches("admin_slots", adminSlots.map(({ adminName, ...x }) => ({ ...x, admin_id: adminName ? ids.get(`admin|${adminName}`) ?? null : null })));
  console.log("✓ นำเข้าเสร็จแล้ว");
}

main().catch((err) => {
  console.error("นำเข้าไม่สำเร็จ:", err?.message ?? err);
  process.exit(1);
});
