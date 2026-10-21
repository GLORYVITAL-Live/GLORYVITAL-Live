import { fail, ok, requireMe } from "@/lib/api";
import {
  TRAINING_ITEMS_SQL, addTrainingClip, loadTraining, logTrainingView, removeTrainingClip, renameTraining, setTrainingHidden, trainingViews,
} from "@/lib/training";
import type { Me, Training, TrainingViews } from "@/lib/types";

// หน้าเทรนนิ่ง: วิดีโอ product training + สไลด์บรีฟโปรดักต์ — ทุกคนที่ลงทะเบียนดูได้
//   GET                                          รายชื่อวิดีโอ + สไลด์ (Owner ที่จัดการได้ เห็นที่ซ่อนด้วย)
//   GET ?views=<วัน>                             ประวัติการเข้าชม (Owner ที่จัดการได้ · 0 = ทั้งหมด)
//   POST { action: "view", kind, ref?, title? }  บันทึกการเข้าชม (ทุกคน · kind = page / video / slides)
//   POST อื่นๆ (Owner ที่จัดการ Mc หรือ Admin ได้) ตอบรายชื่อใหม่ทุกครั้ง
//     { action: "hide", ref, hidden }            ซ่อน / แสดง คลิป ('drive:' / 'youtube:') หรือทั้งกลุ่ม ('folder:')
//     { action: "rename", ref, title }           แก้ชื่อที่แสดง (ว่าง = ใช้ชื่อไฟล์ / ชื่อโฟลเดอร์)
//     { action: "add", url, title?, group }      เพิ่มคลิปจากลิงก์ Google Drive / YouTube
//     { action: "remove", ref }                  ลบคลิปที่เพิ่มจากลิงก์
//     { action: "refresh" }                      อ่านรายชื่อในไดรฟ์ใหม่ทันที
export const maxDuration = 60;

const canManage = (me: Me) => !!me.owner && (me.owner.mc || me.owner.admin);

export async function GET(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  try {
    // ?views=<วัน> (0 = ทั้งหมด) = ประวัติการเข้าชม (Owner ที่จัดการได้)
    const views = new URL(request.url).searchParams.get("views");
    if (views !== null) {
      if (!canManage(r.me)) return fail("บัญชีนี้ดูประวัติการเข้าชมไม่ได้", 403);
      const days = Math.max(0, Math.min(3650, Math.floor(Number(views)) || 0));
      return ok<TrainingViews>(await trainingViews(days));
    }
    return ok<Training>(await loadTraining(canManage(r.me)));
  } catch (err) {
    return fail((err as Error).message, 500);
  }
}

export async function POST(request: Request) {
  const r = await requireMe();
  if ("res" in r) return r.res;
  const body = await request.json().catch(() => ({}));
  // บันทึกการเข้าชม: ทุกคนที่ลงทะเบียน (พลาด = เงียบ ไม่กระทบการดู)
  if (body?.action === "view") {
    await logTrainingView(r.me, body.kind, body.ref, body.title).catch(() => undefined);
    return ok({});
  }
  if (!canManage(r.me)) return fail("บัญชีนี้จัดการหน้าเทรนนิ่งไม่ได้ (เฉพาะ Owner ที่จัดการ Mc หรือ Admin ได้)", 403);
  const by = r.me.email;
  try {
    let message = "บันทึกแล้ว";
    switch (body?.action) {
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
      case "remove":
        await removeTrainingClip(body.ref);
        message = "ลบคลิปแล้ว";
        break;
      case "refresh":
        break;
      default:
        return fail("ไม่รู้จักคำสั่งนี้");
    }
    const training = await loadTraining(true, body?.action === "refresh");
    if (body?.action === "refresh") message = `อ่านรายชื่อในไดรฟ์ใหม่แล้ว (${training.groups.reduce((n, g) => n + g.videos.length, 0)} คลิป)`;
    return ok<Training & { notice: string }>({ ...training, notice: message });
  } catch (err) {
    const msg = (err as Error).message;
    return fail(msg, msg === TRAINING_ITEMS_SQL ? 409 : 400);
  }
}
