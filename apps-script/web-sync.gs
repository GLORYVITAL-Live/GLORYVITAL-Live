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
 *      (อัปเดตไฟล์นี้แล้วต้องกด Run setupWebSync อีกครั้ง เพื่อติดตั้ง trigger ใหม่)
 *
 * หลังจากนั้นทุกครั้งที่แก้แท็บ "ลงตาราง Deal Mc" หรือ "ลงตาราง Admin เสริม"
 * สคริปต์จะส่งเลขแถวที่แก้ไปให้เว็บอ่านและอัปเดตเอง (การเขียนชีตจากเว็บไม่ทำให้สคริปต์นี้ทำงานซ้ำ)
 * ลบแถว (คลิกขวา > ลบแถว) = ลบ slot นั้นในเว็บด้วย (เฉพาะ slot ตั้งแต่วันนี้)
 * คอลัมน์ V (Slot ID) ระบบเขียนเอง ห้ามแก้
 */

const WEB_SYNC_URL = 'https://glory-vital-live.vercel.app/api/sync/sheet';
const WEB_SYNC_SHEET_ID = '1r17--dnbXyVk416Zc3mGwUb-aDw3OCxelOC25NJW7Xo'; // ชีต LIVE GLORY 2026 (ใช้ได้แม้สคริปต์ไม่ได้ผูกกับชีต)
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
  postToWeb_(e.source, { tab: sheet.getName(), rows: rows, firstCol: firstCol, lastCol: Math.min(lastCol, WEB_SYNC_LAST_COL) });
}

/** ลบแถว: onEdit ไม่ทำงานตอนลบแถว จึงใช้ onChange แล้วให้เว็บตรวจทั้งแท็บว่า slot ไหนหายไป */
function onChangeToWeb(e) {
  if (!e || e.changeType !== 'REMOVE_ROW') return;
  const ss = e.source || SpreadsheetApp.openById(WEB_SYNC_SHEET_ID);
  // onChange ไม่บอกว่าลบในแท็บไหน จึงให้เว็บตรวจทั้งสองแท็บ
  WEB_SYNC_TABS.forEach(function (tab) { postToWeb_(ss, { tab: tab, removedRows: true }); });
}

function postToWeb_(ss, payload) {
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
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.warn('ซิงค์ไปเว็บไม่สำเร็จ (' + res.getResponseCode() + '): ' + res.getContentText());
      let msg = '';
      try { msg = JSON.parse(res.getContentText()).message || ''; } catch (err) {}
      toast_(ss, (msg ? msg + ' — ' : '') + 'กด "ซิงค์จากชีตทั้งหมด" ในหน้าเจ้าของอีกครั้ง', 'ซิงค์ไปเว็บไม่สำเร็จ', 10);
    } else if (payload.removedRows) {
      const removed = JSON.parse(res.getContentText()).removed || 0;
      if (removed) toast_(ss, 'ลบ ' + removed + ' slot ออกจากเว็บแล้ว', 'GLORY VITAL', 5);
    }
  } finally {
    lock.releaseLock();
  }
}

/** แจ้งเตือนมุมล่างของชีต (สคริปต์ที่ไม่ได้ผูกกับชีตอาจแสดงไม่ได้ ไม่เป็นไร) */
function toast_(ss, msg, title, seconds) {
  try { ss.toast(msg, title, seconds); } catch (err) { console.warn(msg); }
}

/** รันครั้งเดียวเพื่อติดตั้ง trigger (รันซ้ำได้ ไม่สร้างซ้ำ) */
function setupWebSync() {
  removeTriggers_();
  ScriptApp.newTrigger('onEditToWeb').forSpreadsheet(WEB_SYNC_SHEET_ID).onEdit().create();
  ScriptApp.newTrigger('onChangeToWeb').forSpreadsheet(WEB_SYNC_SHEET_ID).onChange().create();
  console.log('เปิดซิงค์ชีต -> เว็บแล้ว (แก้ไข + ลบแถว)');
}

/** ปิดซิงค์ชีต -> เว็บ */
function removeWebSync() {
  removeTriggers_();
  console.log('ปิดซิงค์ชีต -> เว็บแล้ว');
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'onEditToWeb' || fn === 'onChangeToWeb') ScriptApp.deleteTrigger(t);
  });
}
