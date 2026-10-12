"use client";

import Image from "next/image";
import { CopyIcon } from "lucide-react";
import { AppDialog, DialogActions, DialogBody, useToast } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { CALENDAR_SHARE_TO, CALENDAR_STEPS, SHARE_PERMISSION_WEB } from "@/lib/calendar-share";

/** คัดลอกข้อความ (ไม่มีสิทธิ์ clipboard = เลือกข้อความให้กดคัดลอกเอง) */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** อีเมลบัญชีระบบ + ปุ่มคัดลอก */
function CopyEmail() {
  const toast = useToast();
  return (
    <div className="my-2 flex items-center gap-2 rounded-lg border bg-muted px-3 py-2">
      <span className="min-w-0 flex-1 truncate font-mono text-sm select-all">{CALENDAR_SHARE_TO}</span>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 bg-card"
        onClick={async () => {
          if (await copyText(CALENDAR_SHARE_TO)) toast("คัดลอกอีเมลแล้ว");
          else toast("คัดลอกไม่ได้ กดค้างที่อีเมลเพื่อคัดลอกเอง", "error");
        }}
      >
        <CopyIcon />คัดลอก
      </Button>
    </div>
  );
}

/** ขั้นตอนแชร์ปฏิทินในแอป Google Calendar (มีรูป) + ทางเลือกผ่านเว็บ */
export function CalendarSteps() {
  return (
    <div className="space-y-5 text-sm">
      <ol className="space-y-6">
        {CALENDAR_STEPS.map((s, i) => (
          <li key={i}>
            <p className="mb-2 flex gap-2 font-semibold leading-snug">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs text-primary-foreground">{i + 1}</span>
              <span>{s.text}</span>
            </p>
            {s.copy ? <CopyEmail /> : null}
            {s.image ? (
              <Image
                src={s.image.src}
                alt={`ขั้นที่ ${i + 1}: ${s.text}`}
                width={600}
                height={s.image.h}
                unoptimized
                className="mx-auto h-auto w-full max-w-[280px] rounded-xl border"
              />
            ) : null}
          </li>
        ))}
      </ol>
      <details className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer font-semibold">ในแอปไม่มีเมนู &quot;แชร์กับ&quot;? (บางเครื่อง Android) ทำผ่านเว็บแทน</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>เปิด <b>calendar.google.com</b> ในเบราว์เซอร์ (มือถือ: Chrome กด ⋮ แล้วติ๊ก &quot;เว็บไซต์เวอร์ชันเดสก์ท็อป&quot;)</li>
          <li>ด้านซ้าย &quot;ปฏิทินของฉัน&quot; ชี้ที่ชื่อตัวเอง กด ⋮ แล้วเลือก &quot;การตั้งค่าและการแชร์&quot;</li>
          <li>หัวข้อ &quot;แชร์กับบุคคลหรือกลุ่มที่เฉพาะเจาะจง&quot; กด &quot;+ เพิ่มบุคคลและกลุ่ม&quot;</li>
          <li>ใส่ {CALENDAR_SHARE_TO} สิทธิ์ &quot;{SHARE_PERMISSION_WEB}&quot; แล้วกด &quot;ส่ง&quot;</li>
        </ol>
      </details>
    </div>
  );
}

/** หน้าต่างวิธีแชร์ปฏิทิน (onCheck = ปุ่ม "แชร์แล้ว เช็กเลย") */
export function CalendarGuideDialog({ open, onClose, onCheck, checking = false }: {
  open: boolean;
  onClose: () => void;
  onCheck?: () => void;
  checking?: boolean;
}) {
  return (
    <AppDialog open={open} onClose={onClose} title="แชร์ปฏิทินให้ระบบ" description="ทำครั้งเดียว คิวที่จองจะขึ้นใน Google Calendar ของคุณเองอัตโนมัติ (ภายใน 1–2 นาที)">
      <DialogBody>
        <CalendarSteps />
      </DialogBody>
      <DialogActions>
        <Button variant="outline" size="lg" onClick={onClose}>ปิด</Button>
        {onCheck ? <Button size="lg" disabled={checking} onClick={onCheck}>{checking ? "กำลังเช็ก..." : "แชร์แล้ว เช็กเลย"}</Button> : null}
      </DialogActions>
    </AppDialog>
  );
}
