import "server-only";
import type { sheets_v4 } from "googleapis";
import { createAdminClient } from "@/lib/supabase/server";
import {
  COLS, SHEET_ID, TABLE_OF, TABS, colLetter, dateSerial, hoursOf, normalizeMcName, parseRow, readTab, sheetIdOf,
  sheetsApi, str, timeSerial, type Cell, type Row, type SheetSlot, type TabKey,
} from "@/lib/sheet";

/**
 * ซิงค์สองทางกับ Google Sheet
 *
 * เว็บ -> ชีต (processSheetJobs): งานใน sheet_jobs (DB trigger จดให้ทุกครั้งที่ slot เปลี่ยน)
 *   หาแถวจากรหัสในคอลัมน์ V แล้วเขียนเฉพาะช่องที่ต่าง ถ้ายังไม่มีแถว = slot ใหม่
 *   แทรกแถวในกลุ่มวันเดียวกัน เรียงตามเวลาเริ่ม (คัดลอกรูปแบบ/checkbox/สูตรจากแถวข้างบน)
 *
 * ชีต -> เว็บ (applySheetEdits): อ่านแถวที่ถูกแก้ แล้วอัปเดต DB เฉพาะฟิลด์ในคอลัมน์ที่ถูกแก้
 *   แถวที่ยังไม่มีรหัสและกรอกวัน/เวลาครบ = slot ใหม่ สร้างใน DB แล้วเขียนรหัสลงคอลัมน์ V
 *
 * ทุกงานที่แก้ชีตทำภายใต้ล็อกเดียวกัน (sync_locks) เพราะการแทรก/ลบแถวทำให้เลขแถวเลื่อน
 * ถ้าแก้ slot เดียวกันพร้อมกันทั้งสองที่ ค่าที่แก้ทีหลังชนะ
 */

type Table = "mc_slots" | "admin_slots";
type DbSlot = {
  id: number; platform: string; live_date: string; start_time: string; end_time: string;
  campaign?: string; confirmed: boolean | null; status: string; remark: string;
  personId: number | null; personName: string;
};

const LOCK = "sheet";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hm = (t: string) => t.slice(0, 5);
const minutes = (v: Cell) => (typeof v === "number" ? Math.round((v - Math.floor(v)) * 1440) % 1440 : null);

// ---------- ล็อก ----------

async function withSheetLock<T>(fn: () => Promise<T>, waitMs = 25_000): Promise<T | null> {
  const db = createAdminClient();
  const holder = crypto.randomUUID();
  const deadline = Date.now() + waitMs;
  for (;;) {
    const { data, error } = await db.rpc("try_sync_lock", { p_name: LOCK, p_seconds: 90, p_holder: holder });
    if (error) throw error;
    if (data) break;
    if (Date.now() > deadline) return null;
    await sleep(700);
  }
  try {
    return await fn();
  } finally {
    await db.rpc("release_sync_lock", { p_name: LOCK, p_holder: holder });
  }
}

// ---------- อ่าน slot จาก DB ----------

async function loadSlots(table: Table, ids?: number[]): Promise<Map<number, DbSlot>> {
  const db = createAdminClient();
  const personCol = table === "mc_slots" ? "mc_id" : "admin_id";
  const cols = `id, platform, live_date, start_time, end_time, ${table === "mc_slots" ? "campaign, " : ""}confirmed, status, remark, ${personCol}, person:staff!${personCol}(name)`;
  type Raw = Omit<DbSlot, "personId" | "personName"> & Record<string, unknown> & { person: { name: string } | null };
  const out = new Map<number, DbSlot>();
  const add = (rows: Raw[]) => {
    for (const r of rows) {
      out.set(r.id, {
        id: r.id, platform: r.platform, live_date: r.live_date, start_time: hm(r.start_time), end_time: hm(r.end_time),
        campaign: r.campaign as string | undefined, confirmed: r.confirmed, status: r.status, remark: r.remark,
        personId: (r[personCol] as number | null) ?? null, personName: r.person?.name ?? "",
      });
    }
  };
  if (ids) {
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from(table).select(cols).in("id", ids.slice(i, i + 200));
      if (error) throw error;
      add((data ?? []) as unknown as Raw[]);
    }
  } else {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select(cols).order("id").range(from, from + 999);
      if (error) throw error;
      add((data ?? []) as unknown as Raw[]);
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

// ---------- เว็บ -> ชีต ----------

/** ค่าที่ควรอยู่ในแต่ละช่องของแถว (คอลัมน์ -> ค่า) */
function desiredCells(tab: TabKey, s: DbSlot): Map<number, Cell> {
  const c = COLS[tab];
  const m = new Map<number, Cell>([
    [c.platform, s.platform],
    [c.date, dateSerial(s.live_date)],
    [c.start, timeSerial(s.start_time)],
    [c.end, timeSerial(s.end_time)],
    [c.person, s.personName ? (tab === "mc" ? `Mc ${s.personName}` : s.personName) : ""],
    [c.confirm, s.confirmed === null ? "" : s.confirmed],
    [c.status, s.status],
    [c.remark, s.remark],
  ]);
  if (tab === "mc") m.set(COLS.mc.campaign, s.campaign ?? "");
  return m;
}

function sameCell(tab: TabKey, col: number, have: Cell, want: Cell) {
  const c = COLS[tab];
  if (col === c.start || col === c.end) return minutes(have) === minutes(want);
  if (col === c.date) return typeof have === "number" && Math.floor(have) === want;
  if (col === c.confirm) {
    const norm = (v: Cell) => (v === true || v === "TRUE" ? true : v === false || v === "FALSE" ? false : "");
    return norm(have) === norm(want);
  }
  if (col === c.person && tab === "mc") return normalizeMcName(have) === normalizeMcName(want);
  return str(have) === str(want);
}

type Item = { vals: Row; isNew?: boolean };

/** ตำแหน่งแทรกแถวใหม่: ต่อจากแถวสุดท้ายของวันเดียวกันที่เวลาเริ่ม <= slot ใหม่ */
export function insertIndex(tab: TabKey, items: Item[], s: Pick<DbSlot, "live_date" | "start_time">) {
  const c = COLS[tab];
  const day = dateSerial(s.live_date);
  const start = Math.round(timeSerial(s.start_time) * 1440);
  let lastLE = -1, first = -1, prevIdx = -1, prevDay = -Infinity;
  items.forEach((it, i) => {
    const dv = it.vals[c.date];
    if (typeof dv !== "number" || dv < 1) return;
    const d = Math.floor(dv);
    if (d === day) {
      if (first < 0) first = i;
      const sv = minutes(it.vals[c.start]);
      if (sv !== null && sv <= start) lastLE = i;
    } else if (d < day && d >= prevDay) {
      prevDay = d;
      prevIdx = i;
    }
  });
  if (lastLE >= 0) return lastLE + 1;
  if (first >= 0) return first;
  if (prevIdx >= 0) return prevIdx + 1;
  return items.length;
}

async function writeSlotsToSheet(tab: TabKey, ids: number[]) {
  const table = TABLE_OF[tab];
  const c = COLS[tab];
  const slots = await loadSlots(table, ids);
  if (!slots.size) return { updated: 0, inserted: 0 };

  const items: Item[] = (await readTab(tab)).map((vals) => ({ vals }));
  const byId = new Map<number, Item>();
  const byKey = new Map<string, Item[]>(); // แถวที่ยังไม่มีรหัส (เผื่อจับคู่ด้วยวัน/เวลา)
  const keyOf = (p: { platform: string; live_date: string; start_time: string; end_time: string }) =>
    `${p.platform}|${p.live_date}|${p.start_time}|${p.end_time}`;
  for (const it of items) {
    const p = parseRow(tab, it.vals);
    if (p?.id) byId.set(p.id, it);
    else if (p) byKey.set(keyOf(p), [...(byKey.get(keyOf(p)) ?? []), it]);
  }

  const cellWrites: { item: Item; col: number; value: Cell }[] = [];
  const inserts: number[] = []; // index ตอนแทรก (ตามลำดับ)
  const newItems: { item: Item; slot: DbSlot }[] = [];

  for (const s of slots.values()) {
    let it = byId.get(s.id);
    if (!it) {
      it = byKey.get(keyOf(s))?.shift();
      if (it) cellWrites.push({ item: it, col: c.id, value: s.id });
    }
    if (!it) {
      const vals: Row = [];
      for (const [col, v] of desiredCells(tab, s)) vals[col] = v;
      vals[c.hourG] = hoursOf(s.start_time, s.end_time);
      vals[c.id] = s.id;
      const item = { vals, isNew: true };
      const idx = insertIndex(tab, items, s);
      items.splice(idx, 0, item);
      inserts.push(idx);
      newItems.push({ item, slot: s });
      byId.set(s.id, item);
      continue;
    }
    let timeChanged = false;
    for (const [col, want] of desiredCells(tab, s)) {
      if (!sameCell(tab, col, it.vals[col], want)) {
        cellWrites.push({ item: it, col, value: want });
        if (col === c.start || col === c.end) timeChanged = true;
      }
    }
    if (timeChanged) cellWrites.push({ item: it, col: c.hourG, value: hoursOf(s.start_time, s.end_time) });
  }

  const api = sheetsApi();
  const rowOf = new Map<Item, number>();
  const reindex = () => items.forEach((it, i) => rowOf.set(it, i + 1));

  // 1) แทรกแถว + คัดลอก checkbox จากแถวข้างเคียง
  if (inserts.length) {
    const sheetId = await sheetIdOf(tab);
    reindex();
    const requests: sheets_v4.Schema$Request[] = inserts.map((idx) => ({
      insertDimension: { range: { sheetId, dimension: "ROWS", startIndex: idx, endIndex: idx + 1 }, inheritFromBefore: idx > 0 },
    }));
    for (const { item } of newItems) {
      const r = rowOf.get(item)! - 1;
      let src = r - 1;
      while (src >= 0 && items[src].isNew) src--;
      if (src < 0) { src = r + 1; while (src < items.length && items[src].isNew) src++; }
      if (src < 0 || src >= items.length) continue;
      requests.push({
        copyPaste: {
          source: { sheetId, startRowIndex: src, endRowIndex: src + 1, startColumnIndex: 0, endColumnIndex: 12 },
          destination: { sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 12 },
          pasteType: "PASTE_DATA_VALIDATION",
        },
      });
    }
    await api.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests } });
  }
  reindex();

  // 2) เขียนค่า
  const title = TABS[tab];
  const data: sheets_v4.Schema$ValueRange[] = [];
  const lastCol = tab === "mc" ? COLS.mc.remark : COLS.admin.status; // แท็บ Admin: คอลัมน์ L เป็นของทีม ไม่แตะ
  for (const { item } of newItems) {
    const r = rowOf.get(item)!;
    const row: Cell[] = [];
    for (let col = 1; col <= lastCol; col++) row.push(item.vals[col] ?? "");
    row[c.hourF - 1] = `=SUM(E${r}-D${r})`;
    data.push({ range: `'${title}'!B${r}:${colLetter(lastCol)}${r}`, values: [row] });
    data.push({ range: `'${title}'!${colLetter(c.id)}${r}`, values: [[item.vals[c.id]]] });
  }
  for (const w of cellWrites) {
    const r = rowOf.get(w.item)!;
    data.push({ range: `'${title}'!${colLetter(w.col)}${r}`, values: [[w.value ?? ""]] });
  }
  if (data.length) {
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
  }
  return { updated: cellWrites.length, inserted: newItems.length };
}

/** เขียนการเปลี่ยนแปลงจากเว็บลงชีต (งานค้างใน sheet_jobs) */
export async function processSheetJobs() {
  const db = createAdminClient();
  const result = await withSheetLock(async () => {
    let done = 0, failed = 0;
    for (let round = 0; round < 5; round++) {
      const { data: jobs, error } = await db.from("sheet_jobs").select("id, slot_table, slot_id, attempts")
        .is("done_at", null).lt("attempts", 5).order("created_at").limit(300);
      if (error) throw error;
      if (!jobs?.length) break;
      for (const tab of ["mc", "admin"] as const) {
        const mine = jobs.filter((j) => j.slot_table === TABLE_OF[tab]);
        if (!mine.length) continue;
        const jobIds = mine.map((j) => j.id);
        try {
          await writeSlotsToSheet(tab, [...new Set(mine.map((j) => j.slot_id))]);
          await db.from("sheet_jobs").update({ done_at: new Date().toISOString(), last_error: null }).in("id", jobIds);
          done += mine.length;
        } catch (err) {
          failed += mine.length;
          const msg = String((err as Error)?.message ?? err).slice(0, 500);
          console.warn(`เขียนชีตไม่สำเร็จ (${tab}):`, msg);
          for (const j of mine) await db.from("sheet_jobs").update({ attempts: j.attempts + 1, last_error: msg }).eq("id", j.id);
        }
      }
    }
    return { done, failed };
  });
  return result ?? { done: 0, failed: 0, skipped: "มีงานซิงค์ชีตอื่นกำลังทำอยู่" };
}

/** ลบแถวในชีตของ slot ที่ถูกลบในเว็บ */
export async function deleteSheetRows(table: Table, ids: number[]) {
  const tab = table === "mc_slots" ? "mc" : "admin";
  await withSheetLock(async () => {
    const rows = await readTab(tab);
    const want = new Set(ids);
    const idx = rows.map((r, i) => (want.has(parseRow(tab, r)?.id ?? -1) ? i : -1)).filter((i) => i >= 0).sort((a, b) => b - a);
    if (!idx.length) return;
    const sheetId = await sheetIdOf(tab);
    await sheetsApi().spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: idx.map((i) => ({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: i, endIndex: i + 1 } } })),
      },
    });
  });
}

// ---------- ชีต -> เว็บ ----------

type Field = "platform" | "date" | "start" | "end" | "campaign" | "person" | "confirm" | "status" | "remark";
const FIELDS: Field[] = ["platform", "date", "start", "end", "campaign", "person", "confirm", "status", "remark"];

/**
 * อัปเดต DB ตามแถวในชีต
 *   rowNumbers: เลขแถว (เริ่ม 1) ที่ถูกแก้ ไม่ระบุ = ทุกแถว (ซิงค์ทั้งหมด)
 *   cols: ช่วงคอลัมน์ที่ถูกแก้ (เริ่ม 1) ใช้อัปเดตเฉพาะฟิลด์นั้น ไม่ทับค่าที่เว็บเพิ่งเปลี่ยนในช่องอื่น
 */
export async function applySheetEdits(tab: TabKey, rowNumbers?: number[], cols?: [number, number]) {
  const result = await withSheetLock(async () => {
    const db = createAdminClient();
    const table = TABLE_OF[tab];
    const c = COLS[tab];
    const all = await readTab(tab);
    const targets = (rowNumbers ?? all.map((_, i) => i + 1))
      .map((r) => ({ r, p: parseRow(tab, all[r - 1] ?? []) }))
      .filter((x): x is { r: number; p: SheetSlot } => !!x.p);

    // ฟิลด์ที่อยู่ในช่วงคอลัมน์ที่ถูกแก้
    const colOf: Record<Field, number> = {
      platform: c.platform, date: c.date, start: c.start, end: c.end,
      campaign: tab === "mc" ? COLS.mc.campaign : -1, person: c.person, confirm: c.confirm, status: c.status, remark: c.remark,
    };
    const fields = FIELDS.filter((f) => colOf[f] >= 0 && (!cols || (colOf[f] + 1 >= cols[0] && colOf[f] + 1 <= cols[1])));

    const ids = targets.map((x) => x.p.id).filter((x): x is number => !!x);
    const slots = rowNumbers ? await loadSlots(table, ids) : await loadSlots(table);

    // ซิงค์ทั้งหมด: ข้าม slot ที่เว็บเพิ่งเปลี่ยนแต่ยังไม่ได้เขียนลงชีต (ไม่งั้นค่าในเว็บจะถูกทับ)
    const pending = new Set<number>();
    if (!rowNumbers) {
      const { data } = await db.from("sheet_jobs").select("slot_id").eq("slot_table", table).is("done_at", null);
      for (const j of data ?? []) pending.add(j.slot_id);
    }

    // รายชื่อคน (ชื่อ -> id) สร้างให้ถ้ายังไม่มี (เหมือนตอนนำเข้า)
    const role = tab === "mc" ? "mc" : "admin";
    const { data: staffRows, error: staffErr } = await db.from("staff").select("id, name").eq("role", role);
    if (staffErr) throw staffErr;
    const staffId = new Map((staffRows ?? []).map((s) => [s.name, s.id as number]));
    const missing = [...new Set(targets.map((x) => x.p.person).filter((n) => n && !staffId.has(n)))];
    if (missing.length) {
      const { data, error } = await db.from("staff").insert(missing.map((name) => ({ role, name }))).select("id, name");
      if (error) throw error;
      for (const s of data ?? []) staffId.set(s.name, s.id);
    }

    const personCol = tab === "mc" ? "mc_id" : "admin_id";
    const toRow = (p: SheetSlot, only: Field[]) => {
      const row: Record<string, unknown> = {};
      if (only.includes("platform")) row.platform = p.platform;
      if (only.includes("date")) row.live_date = p.live_date;
      if (only.includes("start")) row.start_time = p.start_time;
      if (only.includes("end")) row.end_time = p.end_time;
      if (only.includes("campaign") && tab === "mc") row.campaign = p.campaign;
      if (only.includes("person")) row[personCol] = p.person ? staffId.get(p.person) ?? null : null;
      if (only.includes("confirm")) row.confirmed = p.confirmed;
      if (only.includes("status")) row.status = p.status;
      if (only.includes("remark")) row.remark = p.remark;
      return row;
    };
    const differs = (s: DbSlot, row: Record<string, unknown>) => Object.entries(row).some(([k, v]) => {
      const cur: unknown = {
        platform: s.platform, live_date: s.live_date, start_time: s.start_time, end_time: s.end_time,
        campaign: s.campaign ?? "", [personCol]: s.personId, confirmed: s.confirmed, status: s.status, remark: s.remark,
      }[k];
      return (cur ?? null) !== (v ?? null);
    });

    let updated = 0, created = 0;
    const calendar: { slot_table: Table; slot_id: number }[] = [];
    const idWrites: sheets_v4.Schema$ValueRange[] = [];

    for (const { r, p } of targets) {
      if (p.id) {
        const s = slots.get(p.id);
        if (!s || pending.has(p.id)) continue; // ลบในเว็บแล้ว / เว็บเพิ่งแก้
        const row = toRow(p, fields);
        if (!Object.keys(row).length || !differs(s, row)) continue;
        const { error } = await db.from(table).update(row).eq("id", p.id);
        if (error) throw error;
        calendar.push({ slot_table: table, slot_id: p.id });
        updated++;
      } else {
        const { data, error } = await db.from(table).insert(toRow(p, FIELDS)).select("id").single();
        if (error) throw error;
        idWrites.push({ range: `'${TABS[tab]}'!${colLetter(c.id)}${r}`, values: [[data.id]] });
        if (p.person) calendar.push({ slot_table: table, slot_id: data.id });
        created++;
      }
    }

    if (idWrites.length) {
      await sheetsApi().spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: { valueInputOption: "RAW", data: idWrites },
      });
    }
    if (calendar.length) await db.from("calendar_jobs").insert(calendar);
    return { updated, created };
  });
  if (!result) throw new Error("ระบบกำลังซิงค์ชีตอยู่ กรุณาลองใหม่อีกครั้ง");
  return result;
}
