"use client";

import { SLOT_VIEW_KEY, useLocal, writeLocal } from "@/lib/hooks";
import { onBoard, type Board } from "@/lib/live-team";
import type { Me, OwnerScope } from "@/lib/types";
import { BookingWindowEditor } from "@/components/BookingWindow";
import { PlanSlots } from "@/components/PlanSlots";
import { SlotBoard } from "@/components/SlotBoard";
import { SlotManager } from "@/components/SlotManager";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * หน้าเจ้าของ > ตาราง slot: รวมงานจัดตารางไว้ที่เดียว
 *   รายวัน         = ช่วงเปิดจอง + จัดการ slot (ใส่คน / สถานะ / ลบ)
 *   แพลนทั้งเดือน  = Plan Slot Live (เฉพาะคนที่มีสิทธิ์ Plan Slot Live)
 *   มุมมอง Mc / Admin = หน้าจองที่ Mc TikTok / Mc Shopee / Admin เห็น (ดูอย่างเดียว ถ้าตัวเองไม่ได้เป็น Mc / Admin ของหน้านั้น)
 */

const ROLE_VIEW_KEY = "glory_slot_view_role";

/**
 * scope = ฝั่งที่เปิดดูได้ / edit = ฝั่งที่จัดการได้ (ดูได้อย่างเดียว = ไม่มีปุ่มแก้)
 * plan = สิทธิ์แพลนทั้งเดือน: edit = บันทึกได้ / view = ดูอย่างเดียว / null = ไม่เห็นแท็บนี้
 */
export function SlotWorkspace({ me, scope, edit, plan }: { me: Me; scope: OwnerScope; edit: OwnerScope; plan: "edit" | "view" | null }) {
  // [id, ชื่อเต็ม, ชื่อสั้นบนมือถือ (ชื่อเต็มขึ้น 2 บรรทัด)]
  const views = [
    ["daily", (edit.mc || edit.admin) ? "รายวัน · ใส่คน / สถานะ" : "รายวัน", "รายวัน"],
    ...(plan ? [["plan", "แพลนทั้งเดือน", "แพลนทั้งเดือน"] as const] : []),
    ["view", "มุมมอง Mc / Admin", "มุมมอง Mc"],
  ] as const;
  const saved = useLocal(SLOT_VIEW_KEY);
  const view = views.some(([id]) => id === saved) ? saved! : "daily";
  // shopee = หน้าจองคิว Shopee ที่ Mc ทีม Shopee เห็น (ฝั่ง Mc)
  const roles = [...(scope.mc ? ["mc" as const, "shopee" as const] : []), ...(scope.admin ? ["admin" as const] : [])];
  const savedRole = useLocal(ROLE_VIEW_KEY);
  const viewAs = roles.find((r) => r === savedRole) ?? roles[0];
  const role = viewAs === "admin" ? "admin" : "mc";
  const board: Board = viewAs === "shopee" ? "shopee" : "tiktok";
  // ตัวเองเป็น Mc / Admin ของหน้านั้นจริง = จองได้ / ไม่ใช่ = ดูอย่างเดียว
  const person = me[role];
  const preview = !person || !onBoard(person.platform, board);

  const pill = "rounded-full! px-3 text-[13px] font-semibold text-muted-foreground data-[state=on]:bg-tint! data-[state=on]:text-tint-foreground!";
  return (
    <div>
      <ToggleGroup
        type="single" spacing={1} value={view}
        onValueChange={(v) => { if (v) writeLocal(SLOT_VIEW_KEY, v); }}
        aria-label="ตาราง slot" className="mb-2 flex-wrap rounded-full border bg-card p-1"
      >
        {views.map(([id, text, short]) => (
          <ToggleGroupItem key={id} value={id} aria-label={text} className={pill}>
            <span className="sm:hidden">{short}</span><span className="max-sm:hidden">{text}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {view === "daily" ? (
        <>
          <BookingWindowEditor scope={scope} edit={edit} />
          <SlotManager scope={scope} edit={edit} />
        </>
      ) : view === "plan" ? (
        <PlanSlots readOnly={plan !== "edit"} />
      ) : viewAs ? (
        <>
          {roles.length > 1 ? (
            <ToggleGroup
              type="single" spacing={1} value={viewAs}
              onValueChange={(v) => { if (v) writeLocal(ROLE_VIEW_KEY, v); }}
              aria-label="มุมมองของ" className="no-scrollbar mb-2 max-w-full overflow-x-auto rounded-full border bg-card p-1"
            >
              {roles.map((r) => (
                <ToggleGroupItem key={r} value={r} className={pill}>
                  {r === "mc" ? "ที่ Mc TikTok เห็น" : r === "shopee" ? "ที่ Mc Shopee เห็น" : "ที่ Admin เห็น"}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}
          {/* แถบ "โหมดดูอย่างเดียว (เจ้าของ)" อยู่ใน SlotBoard แล้ว ไม่ต้องแจ้งซ้ำที่นี่ */}
          <SlotBoard key={viewAs} me={me} role={role} board={board} preview={preview} />
        </>
      ) : null}
    </div>
  );
}
