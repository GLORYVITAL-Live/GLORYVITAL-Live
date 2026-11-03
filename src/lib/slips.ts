// สลิปโอนเงินค่าจ้าง — ฟังก์ชันล้วน (เทสได้ ใช้ทั้งเซิร์ฟเวอร์และหน้าเว็บ)
//   ฝ่ายบัญชีอัปสลิปลงโฟลเดอร์ Google Drive (settings.pay_slip_drive_folder) แบบเดิม:
//     Slip > รอบ "261002" (ปี ค.ศ. 2 หลัก + เดือน + วัน = 2 ต.ค. 2026) > "รายการเบิกสำหรับ MC LIVESTREAM Tiktok Fee" > "MC LIVESTREAM Tiktok -Mc แนน.pdf"
//   ระบบอ่านชื่อไฟล์ → จับคู่กับรายชื่อ (ชื่อตรงคนเดียว) → เจ้าตัวดาวน์โหลดใน "ตารางของฉัน" (ไม่บันทึกโอนให้อัตโนมัติ)

export type SlipRole = "mc" | "admin";

/** แจ้งเตือนเฉพาะสลิปที่อัปไม่เกินกี่วัน (ตรวจครั้งแรกเจอสลิปเก่าทั้งหมด = ไม่แจ้งย้อนหลัง) */
export const SLIP_NOTIFY_DAYS = 14;

/** โฟลเดอร์รอบ "261002" / "261002 รอบ 2" → { round: "261002", date: "2026-10-02" } · ไม่ใช่รอบ = null */
export function slipRound(folderName: string) {
  const m = folderName.normalize("NFC").trim().match(/^(\d{2})(\d{2})(\d{2})(?!\d)/);
  if (!m) return null;
  const [, yy, mm, dd] = m;
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  return { round: `${yy}${mm}${dd}`, date: `20${yy}-${mm}-${dd}` };
}

/** โฟลเดอร์กลุ่ม → ฝั่ง ("...ADMIN LIVESTREAM..." = Admin · "...MC LIVESTREAM..." = Mc · อื่นๆ = null) */
export function slipGroupRole(folderName: string): SlipRole | null {
  const n = folderName.toUpperCase();
  if (/ADMIN/.test(n)) return "admin";
  if (/\bMC/.test(n)) return "mc";
  return null;
}

/** ชื่อกลุ่มที่แสดง: "รายการเบิกสำหรับ MC LIVESTREAM Shopee Fee" → "MC LIVESTREAM Shopee" */
export const slipGroupLabel = (folderName: string) =>
  folderName.normalize("NFC").replace(/^\s*รายการเบิกสำหรับ\s*/, "").replace(/\s*Fee\s*$/i, "").replace(/\s+/g, " ").trim();

/** คีย์เทียบชื่อ: ตัวพิมพ์เล็ก ช่องว่างเดียว (ไม่ตัดคำนำหน้า) */
export const slipKey = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

/** คีย์แบบหลวม: ไม่นับสระบน / ล่าง / วรรณยุกต์ / ช่องว่าง (ชื่อไฟล์บางรอบสระท้ายชื่อหาย เช่น "ลูกหย" = ลูกหยี · "ชมพู" = ชมพู่) */
const looseKey = (k: string) => k.replace(/[ัิ-ฺ็-๎\s]/g, "");

/**
 * ชื่อคนจากชื่อไฟล์ (หลายแบบ ไว้ลองจับคู่ทีละแบบ): ส่วนหลัง "-" ตัวสุดท้าย ไม่เอานามสกุลไฟล์ / "(1)" ท้ายชื่อ
 *   แบบแรก = ตัดคำนำหน้า Mc / MCN / Admin · แบบสอง = ตัดแค่ Mc / Admin ("MCN อร" → "n อร" ตรงกับรายชื่อ "N อร")
 *   "MC LIVESTREAM Tiktok -Mc แนน.pdf" → ["แนน"] · "ADMINLIVESTREAM Tiktok-Admin ปัน.pdf" → ["ปัน"] · อ่านไม่ได้ = []
 */
export function slipPersonKeys(fileName: string) {
  const base = fileName.normalize("NFC").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/\s*\(\d+\)\s*$/, "");
  const tail = base.includes("-") ? base.slice(base.lastIndexOf("-") + 1) : base;
  const keys = [tail.replace(/^\s*(mcn|mc|admin)\b\.?\s*/i, ""), tail.replace(/^\s*(mc|admin)\.?\s*/i, "")].map(slipKey).filter(Boolean);
  return [...new Set(keys)];
}

/** รูป / PDF เท่านั้น */
export const slipFileOk = (mime: string) => mime === "application/pdf" || mime.startsWith("image/");

/**
 * จับคู่อัตโนมัติ: ฝั่งเดียวกัน + ชื่อในระบบตรงกับชื่อในไฟล์ คนเดียวเท่านั้น (ตรงทุกตัวก่อน แล้วค่อยแบบหลวม)
 *   ไม่นับพนักงานประจำ (เงินเดือน — ไม่อยู่ในไฟล์เบิก) และบัญชีทดสอบ · ไม่ชัด = null (ให้ Owner เลือก)
 */
export function matchSlip(
  slip: { role: SlipRole; keys: string[] },
  staff: { id: number; role: string; name: string; salaried?: boolean | null; test?: boolean }[],
) {
  const pool = staff.filter((s) => s.role === slip.role && !s.salaried && !s.test);
  for (const same of [(a: string, b: string) => a === b, (a: string, b: string) => looseKey(a) === looseKey(b)]) {
    for (const key of slip.keys) {
      const hits = pool.filter((s) => same(slipKey(s.name), key));
      if (hits.length === 1) return hits[0].id;
      if (hits.length > 1) return null;
    }
  }
  return null;
}

/** "2026-10-02" → "2 ต.ค. 69" */
export function slipRoundLabel(date: string | null, round: string) {
  if (!date) return `รอบ ${round}`;
  const TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `รอบ ${Number(date.slice(8))} ${TH[Number(date.slice(5, 7)) - 1]} ${String(Number(date.slice(0, 4)) + 543).slice(2)}`;
}
