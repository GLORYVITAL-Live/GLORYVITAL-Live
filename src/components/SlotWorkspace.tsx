"use client";

import { useLocal, writeLocal } from "@/lib/hooks";
import type { Me, OwnerScope } from "@/lib/types";
import { BookingWindowEditor } from "@/components/BookingWindow";
import { PlanSlots } from "@/components/PlanSlots";
import { SlotBoard } from "@/components/SlotBoard";
import { SlotManager } from "@/components/SlotManager";
import { Notice } from "@/components/shared";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * หน้าเจ้าของ > ตาราง slot: รวมงานจัดตารางไว้ที่เดียว
 *   รายวัน         = ช่วงเปิดจอง + จัดการ slot (ใส่คน / สถานะ / ลบ)
 *   แพลนทั้งเดือน  = Plan Slot Live (เฉพาะคนที่มีสิทธิ์ Plan Slot Live)
 *   มุมมอง Mc / Admin = หน้าจองที่ Mc / Admin เห็น (ดูอย่างเดียว ถ้าตัวเองไม่ได้เป็น Mc / Admin)
 */

export const SLOT_VIEW_KEY = "glory_slot_view";
const ROLE_VIEW_KEY = "glory_slot_view_role";

/**
 * scope = ฝั่งที่เปิดดูได้ / edit = ฝั่งที่จัดการได้ (ดูได้อย่างเดียว = ไม่มีปุ่มแก้)
 * plan = สิทธิ์แพลนทั้งเดือน: edit = บันทึกได้ / view = ดูอย่างเดียว / null = ไม่เห็นแท็บนี้
 */
export function SlotWorkspace({ me, scope, edit, plan }: { me: Me; scope: OwnerScope; edit: OwnerScope; plan: "edit" | "view" | null }) {
  const views = [
    ["daily", (edit.mc || edit.admin) ? "รายวัน · ใส่คน / สถานะ" : "รายวัน"],
    ...(plan ? [["plan", "แพลนทั้งเดือน"] as const] : []),
    ["view", "มุมมอง Mc / Admin"],
  ] as const;
  const saved = useLocal(SLOT_VIEW_KEY);
  const view = views.some(([id]) => id === saved) ? saved! : "daily";
  const roles = [...(scope.mc ? ["mc" as const] : []), ...(scope.admin ? ["admin" as const] : [])];
  const savedRole = useLocal(ROLE_VIEW_KEY);
  const role = roles.find((r) => r === savedRole) ?? roles[0];

  const pill = "rounded-full! px-3 text-[13px] font-semibold text-muted-foreground data-[state=on]:bg-primary! data-[state=on]:text-primary-foreground!";
  return (
    <div>
      <ToggleGroup
        type="single" spacing={1} value={view}
        onValueChange={(v) => { if (v) writeLocal(SLOT_VIEW_KEY, v); }}
        aria-label="ตาราง slot" className="mb-2 flex-wrap rounded-full border bg-card p-1"
      >
        {views.map(([id, text]) => <ToggleGroupItem key={id} value={id} className={pill}>{text}</ToggleGroupItem>)}
      </ToggleGroup>

      {view === "daily" ? (
        <>
          <BookingWindowEditor scope={scope} edit={edit} />
          <SlotManager scope={scope} edit={edit} />
        </>
      ) : view === "plan" ? (
        <PlanSlots readOnly={plan !== "edit"} />
      ) : role ? (
        <>
          {roles.length > 1 ? (
            <ToggleGroup
              type="single" spacing={1} value={role}
              onValueChange={(v) => { if (v) writeLocal(ROLE_VIEW_KEY, v); }}
              aria-label="มุมมองของ" className="mb-2 rounded-full border bg-card p-1"
            >
              <ToggleGroupItem value="mc" className={pill}>ที่ Mc เห็น</ToggleGroupItem>
              <ToggleGroupItem value="admin" className={pill}>ที่ Admin เห็น</ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          {!me[role] ? <Notice>หน้าจองที่ {role === "mc" ? "Mc" : "Admin"} เห็น — ดูอย่างเดียว จองแทนไม่ได้</Notice> : null}
          <SlotBoard key={role} me={me} role={role} preview={!me[role]} />
        </>
      ) : null}
    </div>
  );
}
