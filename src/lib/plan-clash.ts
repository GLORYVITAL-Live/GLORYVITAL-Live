// หน้า Plan Slot Live: ช่องเดียวกัน (บัญชีไลฟ์เดียวกัน) ไลฟ์ทับเวลากันไม่ได้เด็ดขาด — ใช้ทั้งหน้าเว็บและเซิร์ฟเวอร์ (เทสได้)
//   เช่น GLORY VITAL (ของเรา) กับ Agency TDH ใช้บัญชีเดียวกัน ต้องไลฟ์ต่อกัน: ของเรา 07:30–21:30 → TDH 21:30–02:30
//   ต่อกันพอดี (จบ 21:30 / เริ่ม 21:30) = ไม่ทับ · เวลาเรียงตาม "วันไลฟ์" (TikTok เริ่ม 07:30 / Shopee เริ่ม 06:00 หลังเที่ยงคืน = วันเดิม)

/** slot ในแพลน: owner = null ของเรา (ลงชีต) / ชื่อ Agency (แพลนในเว็บ เช่น "TDH") */
export type PlanSpan = { date: string; platform: string; start: string; end: string; owner?: string | null };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const dayStart = (platform: string) => (platform.trim().toLowerCase() === "shopee" ? 6 * 60 : 7 * 60 + 30);
/** นาทีนับจากต้นวันไลฟ์ (TikTok 07:30 / Shopee 06:00) */
export const dayOrder = (start: string, platform: string) => (toMin(start) - dayStart(platform) + 1440) % 1440;
/** ความยาว (นาที) ข้ามเที่ยงคืนได้ */
export const spanLen = (s: { start: string; end: string }) => (toMin(s.end) - toMin(s.start) + 1440) % 1440;

/** สอง slot ในช่องเดียวกันวันเดียวกันเวลาทับกัน (slot เดียวกันของเจ้าของเดียวกัน = ไม่นับ) */
export function clashes(a: PlanSpan, b: PlanSpan) {
  if (a.date !== b.date || a.platform !== b.platform) return false;
  if (a.start === b.start && a.end === b.end && (a.owner ?? null) === (b.owner ?? null)) return false;
  const a0 = dayOrder(a.start, a.platform), b0 = dayOrder(b.start, b.platform);
  return a0 < b0 + spanLen(b) && b0 < a0 + spanLen(a);
}

/** slot ที่ทับกับ span (ไม่มี = null) */
export const firstClash = (span: PlanSpan, others: PlanSpan[]) => others.find((o) => clashes(span, o)) ?? null;

/** ชื่อเจ้าของในข้อความ (ของเรา / Agency TDH / In house / MCN) */
export const ownerText = (owner: string | null | undefined) =>
  !owner ? "ของเรา" : owner === "In house" || owner === "MCN" ? owner : `Agency ${owner}`;
