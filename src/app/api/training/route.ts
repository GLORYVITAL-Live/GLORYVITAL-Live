import { fail, ok, requireMe } from "@/lib/api";
import { isStaff } from "@/lib/auth";
import {
  TRAINING_GATE_SQL, TRAINING_ITEMS_SQL, addTrainingClip, loadTraining, logTrainingView, moveToYouTube, myTrainingGate, removeTrainingClip, renameTraining,
  setTrainingGate, setTrainingHidden, setTrainingPassed, setTrainingRequired, slideDeck, trainingProgress, trainingViews,
} from "@/lib/training";
import type { Me, Training, TrainingProgress, TrainingViews } from "@/lib/types";

// หน้าเทรนนิ่ง: วิดีโอ product training + สไลด์บรีฟโปรดักต์ — ทุกคนที่ลงทะเบียนดูได้
//   GET                                          รายชื่อวิดีโอ + สไลด์ (Owner ที่จัดการได้ เห็นที่ซ่อนด้วย)
//   GET ?views=<วัน>                             ประวัติการเข้าชม (Owner ที่จัดการได้ · 0 = ทั้งหมด)
//   GET ?progress=1                              คลิปบังคับ: ดูครบกี่คน (Owner ที่จัดการได้)
//   POST { action: "view", kind, ref?, title? }  บันทึกการเข้าชม (ทุกคน · kind = page / video / slides / done = ดูคลิปจบ หรืออ่านสไลด์ครบ ref 'slides:<id>')
//   POST อื่นๆ (Owner ที่จัดการ Mc หรือ Admin ได้) ตอบรายชื่อใหม่ทุกครั้ง
//     { action: "hide", ref, hidden }            ซ่อน / แสดง คลิป ('drive:' / 'youtube:') หรือทั้งกลุ่ม ('folder:')
//     { action: "rename", ref, title }           แก้ชื่อที่แสดง (ว่าง = ใช้ชื่อไฟล์ / ชื่อโฟลเดอร์)
//     { action: "add", url, title?, group }      เพิ่มคลิปจากลิงก์ Google Drive / YouTube
//     { action: "remove", ref }                  ลบคลิปที่เพิ่มจากลิงก์
//     { action: "youtube", ref, url }            ย้ายคลิปในไดรฟ์ ('drive:') ไปเล่นจาก YouTube (ซ่อนคลิปเดิม · คนที่ดูจบแล้วไม่ต้องดูซ้ำ)
//     { action: "refresh" }                      อ่านรายชื่อในไดรฟ์ใหม่ทันที
//     { action: "required", ref, required }      ติ๊ก / เอาติ๊ก บังคับดูก่อนจองคิว (คลิป หรือทั้งกลุ่ม)
//     { action: "gate", on }                     เปิด / ปิด บังคับดูก่อนจอง (เปิด = แจ้งคนที่ยังดูไม่ครบ)
//     { action: "pass", staffId, passed }        ให้ผ่านโดยไม่ต้องดูคลิป (เช่น เทรนนอกเว็บแล้ว)
export const maxDuration = 60;

const canManage = (me: Me) => !!me.owner && (me.owner.mc || me.owner.admin);

/** สไลด์อ่านทีละหน้า: จำนวนหน้า + รุ่น (อ่านไม่ได้ เช่น ยังไม่ได้เปิด Slides API = null หน้าเว็บใช้กรอบของ Google แทน) */
const deckInfo = () => slideDeck()
  .then((d) => (d ? { pages: d.pages.length, rev: d.rev } : null))
  .catch((err) => { console.warn("อ่านสไลด์เทรนนิ่งไม่สำเร็จ:", (err as Error).message); return null; });

const noTeam = () => fail("หน้าเทรนนิ่งสำหรับทีมไลฟ์เท่านั้น", 403);

export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  if (!isStaff(r.me)) return noTeam();
  try {
    // ?views=<วัน> (0 = ทั้งหมด) = ประวัติการเข้าชม (Owner ที่จัดการได้)
    const views = new URL(request.url).searchParams.get("views");
    if (views !== null) {
      if (!canManage(r.me)) return fail("บัญชีนี้ดูประวัติการเข้าชมไม่ได้", 403);
      const days = Math.max(0, Math.min(3650, Math.floor(Number(views)) || 0));
      return ok<TrainingViews>(await trainingViews(days));
    }
    if (new URL(request.url).searchParams.has("progress")) {
      if (!canManage(r.me)) return fail("บัญชีนี้ดูความคืบหน้าไม่ได้", 403);
      return ok<TrainingProgress>(await trainingProgress());
    }
    const [training, gate, deck] = await Promise.all([loadTraining(canManage(r.me)), myTrainingGate(r.me).catch(() => null), deckInfo()]);
    return ok<Training>({ ...training, gate, deck, frames: !!r.me.briefs });
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}

export async function POST(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  if (!isStaff(r.me)) return noTeam();
  const body = await request.json().catch(() => ({}));
  // บันทึกการเข้าชม: ทุกคนที่ลงทะเบียน (พลาด = เงียบ ไม่กระทบการดู)
  if (body?.action === "view") {
    await logTrainingView(r.me, body.kind, body.ref, body.title).catch(() => undefined);
    return ok({});
  }
  if (!canManage(r.me)) return fail("บัญชีนี้จัดการหน้าเทรนนิ่งไม่ได้ (เฉพาะ Owner ที่จัดการ Mc หรือ Admin ได้)", 403);
  const by = r.me.email;
  // เปิด / ปิด บังคับดู · ให้ผ่าน: ไม่ต้องโหลดรายชื่อคลิปใหม่
  if (body?.action === "gate" || body?.action === "pass") {
    try {
      if (body.action === "gate") {
        const sent = await setTrainingGate(body.on === true);
        return ok({ message: body.on === true ? `เปิดบังคับดูก่อนจองแล้ว${sent ? ` · แจ้งคนที่ยังดูไม่ครบ ${sent} คน` : ""}` : "ปิดบังคับดูก่อนจองแล้ว" });
      }
      const id = Number(body.staffId);
      if (!Number.isInteger(id)) return fail("ไม่พบรายชื่อนี้");
      await setTrainingPassed(id, body.passed === true);
      return ok({ message: body.passed === true ? "ให้ผ่านแล้ว จองคิวได้" : "ยกเลิกให้ผ่านแล้ว" });
    } catch (err) {
      const msg = (err as Error).message;
      return fail(msg, msg === TRAINING_GATE_SQL ? 409 : 400);
    }
  }
  try {
    let message = "บันทึกแล้ว";
    switch (body?.action) {
      case "required":
        await setTrainingRequired(body.ref, body.required === true, by);
        message = body.required === true ? "ตั้งเป็นคลิปบังคับแล้ว" : "เอาออกจากคลิปบังคับแล้ว";
        break;
      case "hide":
        await setTrainingHidden(body.ref, body.hidden === true, by);
        message = body.hidden === true ? "ซ่อนแล้ว (ไฟล์ในไดรฟ์ไม่ถูกลบ)" : "แสดงแล้ว";
        break;
      case "rename":
        await renameTraining(body.ref, body.title, by);
        message = "แก้ชื่อแล้ว";
        break;
      case "add": {
        await loadTraining(true); // รายชื่อในไดรฟ์ล่าสุด (กันเพิ่มคลิปที่อยู่ในโฟลเดอร์แล้ว)
        const res = await addTrainingClip(body.url, body.title, body.group, by);
        message = `เพิ่ม "${res.title}" แล้ว`;
        break;
      }
      case "youtube": {
        const res = await moveToYouTube(body.ref, body.url, by);
        message = `ย้าย "${res.title}" ไปเล่นจาก YouTube แล้ว${res.copied ? ` · คนที่ดูจบแล้ว ${res.copied} คนไม่ต้องดูซ้ำ` : ""}`;
        break;
      }
      case "remove":
        await removeTrainingClip(body.ref);
        message = "ลบคลิปแล้ว";
        break;
      case "refresh":
        break;
      default:
        return fail("ไม่รู้จักคำสั่งนี้");
    }
    const [training, gate, deck] = await Promise.all([loadTraining(true, body?.action === "refresh"), myTrainingGate(r.me).catch(() => null), deckInfo()]);
    if (body?.action === "refresh") message = `อ่านรายชื่อในไดรฟ์ใหม่แล้ว (${training.groups.reduce((n, g) => n + g.videos.length, 0)} คลิป)`;
    return ok<Training & { notice: string }>({ ...training, gate, deck, frames: !!r.me.briefs, notice: message });
  } catch (err) {
    const msg = (err as Error).message;
    return fail(msg, msg === TRAINING_ITEMS_SQL || msg === TRAINING_GATE_SQL ? 409 : 400);
  }
}
