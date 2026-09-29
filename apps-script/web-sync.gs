/**
 * ซิงค์ชีต -> เว็บ GLORY VITAL Live (https://glory-vital-live.vercel.app)
 * ======================================================================
 * วางไฟล์นี้ในโปรเจค Apps Script ที่ผูกกับชีต LIVE GLORY 2026 (Extensions > Apps Script)
 * เป็นไฟล์ใหม่ชื่อ web-sync.gs
 *
 * ตั้งค่าครั้งเดียว:
 *   1. Project Settings (ไอคอนเฟือง) > Script Properties > Add script property
 *        Property: SYNC_SECRET   Value: ค่า SHEET_SYNC_SECRET (เดียวกับใน Vercel)
 *   2. เลือกฟังก์ชัน setupWebSync ด้านบน แล้วกด Run (อนุญาตสิทธิ์ตามที่ Google ถาม)
 *
 * หลังจากนั้นทุกครั้งที่แก้แท็บ "ลงตาราง Deal Mc" หรือ "ลงตาราง Admin เสริม"
 * สคริปต์จะส่งเลขแถวที่แก้ไปให้เว็บอ่านและอัปเดตเอง (การเขียนชีตจากเว็บไม่ทำให้สคริปต์นี้ทำงานซ้ำ)
 * คอลัมน์ V (Slot ID) ระบบเขียนเอง ห้ามแก้
 */

const WEB_SYNC_URL = 'https://glory-vital-live.vercel.app/api/sync/sheet';
const WEB_SYNC_TABS = ['ลงตาราง Deal Mc', 'ลงตาราง Admin เสริม'];
const WEB_SYNC_LAST_COL = 12; // สนใจเฉพาะคอลัมน์ A-L (ข้อมูล slot)

function onEditToWeb(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (WEB_SYNC_TABS.indexOf(sheet.getName()) === -1) return;
  const firstCol = e.range.getColumn();
  const lastCol = e.range.getLastColumn();
  if (firstCol > WEB_SYNC_LAST_COL) return; // แก้คอลัมน์โน้ตด้านขวา ไม่เกี่ยวกับ slot

  const rows = [];
  for (let r = e.range.getRow(); r <= e.range.getLastRow() && rows.length < 1000; r++) rows.push(r);
  const secret = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET');
  if (!secret) throw new Error('ยังไม่ได้ตั้ง Script Property ชื่อ SYNC_SECRET');

  // ส่งทีละคำขอ กันแถวใหม่ถูกสร้างซ้ำเวลาพิมพ์เร็วๆ หลายช่อง
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const res = UrlFetchApp.fetch(WEB_SYNC_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + secret },
      payload: JSON.stringify({ tab: sheet.getName(), rows: rows, firstCol: firstCol, lastCol: Math.min(lastCol, WEB_SYNC_LAST_COL) }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.warn('ซิงค์ไปเว็บไม่สำเร็จ (' + res.getResponseCode() + '): ' + res.getContentText());
      e.source.toast('ซิงค์ไปเว็บไม่สำเร็จ กด "ซิงค์จากชีตทั้งหมด" ในหน้าเจ้าของอีกครั้ง', 'GLORY VITAL', 8);
    }
  } finally {
    lock.releaseLock();
  }
}

/** รันครั้งเดียวเพื่อติดตั้ง trigger (รันซ้ำได้ ไม่สร้างซ้ำ) */
function setupWebSync() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEditToWeb') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onEditToWeb').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  console.log('เปิดซิงค์ชีต -> เว็บแล้ว');
}

/** ปิดซิงค์ชีต -> เว็บ */
function removeWebSync() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEditToWeb') ScriptApp.deleteTrigger(t);
  });
  console.log('ปิดซิงค์ชีต -> เว็บแล้ว');
}
