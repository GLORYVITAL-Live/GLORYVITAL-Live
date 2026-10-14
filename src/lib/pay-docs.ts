// เอกสารทำเบิก (Mc / Admin): ตรวจข้อมูลที่กรอก — ใช้ทั้งฟอร์มในเว็บและฝั่งเซิร์ฟเวอร์

export type PayDocKind = "id_card" | "bank_book";
export const PAY_DOC_LABEL: Record<PayDocKind, string> = { id_card: "รูปบัตรประชาชน", bank_book: "รูปหน้าสมุดบัญชี" };
/** รูปย่อเป็น JPG ในเครื่องก่อนส่ง / PDF ส่งตามเดิม (คำขอเดียวส่ง 2 ไฟล์ ต้องรวมไม่เกิน ~4 MB) */
export const PAY_DOC_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const PAY_DOC_MAX_BYTES = 2 * 1024 * 1024;

export const BANKS = [
  "กสิกรไทย", "ไทยพาณิชย์", "กรุงเทพ", "กรุงไทย", "กรุงศรีอยุธยา", "ทหารไทยธนชาต (ttb)", "ออมสิน", "ธ.ก.ส.",
  "อาคารสงเคราะห์ (ธอส.)", "ยูโอบี", "ซีไอเอ็มบี ไทย", "เกียรตินาคินภัทร", "แลนด์ แอนด์ เฮ้าส์", "ทิสโก้", "อิสลามแห่งประเทศไทย",
];

export type PayInfo = {
  fullName: string;
  idCardNo: string;
  address: string;
  bank: string;
  accountNo: string;
  accountName: string;
};

/** เลขบัตรประชาชน 13 หลัก: หลักสุดท้ายต้องตรงกับผลรวมถ่วงน้ำหนัก 12 หลักแรก */
export function thaiIdValid(id: string) {
  if (!/^\d{13}$/.test(id)) return false;
  const sum = [...id.slice(0, 12)].reduce((a, d, i) => a + Number(d) * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

/** 1-2345-67890-12-3 */
export const formatThaiId = (id: string) => (/^\d{13}$/.test(id) ? id.replace(/^(\d)(\d{4})(\d{5})(\d{2})(\d)$/, "$1-$2-$3-$4-$5") : id);

const text = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");

/** ตรวจ + ทำความสะอาดข้อมูลจากฟอร์ม (คนต่างชาติใส่เลขพาสปอร์ตแทนเลขบัตรได้) */
export function cleanPayInfo(raw: Record<string, unknown>): { info: PayInfo } | { error: string } {
  const fullName = text(raw.fullName);
  if (fullName.length < 4) return { error: "กรุณาใส่ชื่อ-นามสกุลจริงตามบัตรประชาชน" };
  if (fullName.length > 120) return { error: "ชื่อ-นามสกุลยาวเกินไป" };

  const idCardNo = text(raw.idCardNo).replace(/[\s-]/g, "").toUpperCase();
  if (/^\d+$/.test(idCardNo)) {
    if (idCardNo.length !== 13) return { error: "เลขบัตรประชาชนต้องมี 13 หลัก" };
    if (!thaiIdValid(idCardNo)) return { error: "เลขบัตรประชาชนไม่ถูกต้อง ตรวจอีกครั้ง" };
  } else if (!/^(?=.*[A-Z])[A-Z0-9]{6,15}$/.test(idCardNo)) {
    return { error: "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก (คนต่างชาติใส่เลขพาสปอร์ต)" };
  }

  const address = String(raw.address ?? "").trim().replace(/[ \t]+/g, " ");
  if (address.length < 10) return { error: "กรุณาใส่ที่อยู่ตามบัตรประชาชนให้ครบ" };
  if (address.length > 500) return { error: "ที่อยู่ยาวเกินไป" };

  const bank = text(raw.bank);
  if (bank.length < 2) return { error: "กรุณาเลือกธนาคาร" };
  if (bank.length > 80) return { error: "ชื่อธนาคารยาวเกินไป" };

  const accountNo = text(raw.accountNo).replace(/[\s-]/g, "");
  if (!/^\d{8,16}$/.test(accountNo)) return { error: "เลขบัญชีต้องเป็นตัวเลข 8–16 หลัก" };

  const accountName = text(raw.accountName);
  if (accountName.length < 2) return { error: "กรุณาใส่ชื่อบัญชี" };
  if (accountName.length > 120) return { error: "ชื่อบัญชียาวเกินไป" };

  return { info: { fullName, idCardNo, address, bank, accountNo, accountName } };
}

// ---------- จับคู่รายชื่อกับโฟลเดอร์เอกสารเดิมใน Drive ("Mc มะนาว" / "Admin ปัน") ----------

const FOLDER_PREFIX = /^(?:mc|admin|แอดมิน|เอกสารทำเบิก)\s*/i;
/** ชื่อสำหรับเทียบ: ตัดคำนำหน้า Mc / Admin + ช่องว่าง จุด ขีด วงเล็บ, ตัวพิมพ์เล็ก ("Mc pin" = "Pin") */
export const folderKey = (name: string) => name.trim().toLowerCase().replace(FOLDER_PREFIX, "").replace(/[\s.\-_()]/g, "");
/** แบบหลวม: ไม่นับตัวการันต์ ("พายอาร์" = "พายอา") */
const looseKey = (name: string) => folderKey(name).replace(/[ก-ฮ][ิุ]?์/g, "");

/** โฟลเดอร์ของคนชื่อนี้ (ชื่อตรงก่อน แล้วค่อยแบบไม่นับการันต์) ไม่เจอ = null — ตัวเลขท้ายชื่อนับ ("มะนาว2" ≠ "มะนาว") */
export function matchDocsFolder<T extends { name: string }>(name: string, folders: T[]): T | null {
  const key = folderKey(name), loose = looseKey(name);
  if (!key) return null;
  return folders.find((f) => folderKey(f.name) === key) ?? (loose ? folders.find((f) => looseKey(f.name) === loose) : undefined) ?? null;
}

/** ข้อความสรุปสำหรับไฟล์ "ข้อมูลทำเบิก.txt" ใน Google Drive */
export function payInfoText(info: PayInfo, who: { name: string; email: string; phone?: string | null }, updatedAt: string) {
  return [
    `ข้อมูลทำเบิก — ${who.name}`,
    "",
    `ชื่อ-นามสกุล: ${info.fullName}`,
    `เลขบัตรประชาชน: ${formatThaiId(info.idCardNo)}`,
    `ที่อยู่: ${info.address}`,
    "",
    `ธนาคาร: ${info.bank}`,
    `เลขบัญชี: ${info.accountNo}`,
    `ชื่อบัญชี: ${info.accountName}`,
    "",
    `อีเมล: ${who.email}`,
    ...(who.phone ? [`เบอร์โทร: ${who.phone}`] : []),
    `อัปเดตล่าสุด: ${updatedAt}`,
    "",
  ].join("\n");
}
