// slot ของ Agency (เช่น TDH ไลฟ์ผ่านช่อง GLORY MALL) = แถวในแท็บ "ลงตาราง Deal Mc" ที่หมายเหตุเป็น "Agency <ชื่อ>"
// Agency หาคนไลฟ์เอง ช่อง Mc จึงว่าง แต่ Mc ของเราจองไม่ได้ (ไม่ขึ้นในหน้าจอง และระบบจองปฏิเสธ)

/** รูปแบบสำหรับ .ilike() / .not("remark", "ilike", ...) หา slot ของ Agency */
export const AGENCY_ILIKE = "agency %";

/** หมายเหตุที่เขียนลงชีต เช่น "Agency TDH" */
export const agencyRemark = (name: string) => `Agency ${name}`;

/** ชื่อ Agency จากหมายเหตุ ("Agency TDH" -> "TDH") ไม่ใช่ slot ของ Agency = null */
export const agencyOf = (remark: string | null | undefined) => /^agency\s+(\S.*)$/i.exec((remark ?? "").trim())?.[1].trim() ?? null;

/** ชื่อ Agency ที่รับจากหน้าเว็บ (ตัวอักษร / ตัวเลข / ช่องว่าง สั้นๆ) */
export const cleanAgency = (v: unknown) => {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  return /^[\p{L}\p{N} ._-]{1,30}$/u.test(s) ? s : null;
};
