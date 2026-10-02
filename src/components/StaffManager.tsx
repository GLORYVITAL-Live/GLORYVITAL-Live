"use client";

import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetHead, StateBox, api, btn, useToast } from "@/components/ui";
import { money } from "@/lib/format";
import { parseTierHours, tiersLabel } from "@/lib/pay";
import type { CommitTier, OwnerScope } from "@/lib/types";

type Role = "mc" | "admin" | "owner";
type Person = {
  id: number; role: Role; name: string; email: string | null; phone: string | null;
  hourly_rate: number | null; is_extra_admin: boolean; upcoming: number;
  commit_tiers: CommitTier[] | null;
  can_manage_mc: boolean; can_manage_admin: boolean;
};

const ROLE_LABEL: Record<Role, string> = { mc: "Mc", admin: "Admin", owner: "Owner" };
const displayName = (p: Pick<Person, "role" | "name">) => (p.role === "mc" ? `Mc ${p.name}` : p.name);
/** บทบาทที่ Owner คนนี้จัดการได้ (รายชื่อ Owner = ต้องมีสิทธิ์ทั้ง Mc และ Admin) */
const rolesOf = (scope: OwnerScope): Role[] =>
  [...(scope.mc ? ["mc" as const] : []), ...(scope.admin ? ["admin" as const] : []), ...(scope.mc && scope.admin ? ["owner" as const] : [])];
const scopeLabel = (p: Pick<Person, "can_manage_mc" | "can_manage_admin">) =>
  p.can_manage_mc && p.can_manage_admin ? "จัดการทั้งหมด" : p.can_manage_mc ? "จัดการ Mc" : p.can_manage_admin ? "จัดการ Admin" : "ไม่มีสิทธิ์";

/** จัดการรายชื่อพนักงาน: ดู / ค้นหา / เพิ่ม / แก้ / ลบ (เฉพาะบทบาทที่มีสิทธิ์) */
export function StaffManager({ scope }: { scope: OwnerScope }) {
  const toast = useToast();
  const roles = rolesOf(scope);
  const [data, setData] = useState<{ staff: Person[]; meId: number | null } | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [role, setRole] = useState<Role>(roles[0] ?? "mc");
  const [search, setSearch] = useState("");
  const [onlyNoEmail, setOnlyNoEmail] = useState(false);
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    let alive = true;
    api<{ staff: Person[]; meId: number | null }>("/api/owner/staff")
      .then((res) => {
        if (!res.ok) throw new Error(res.message);
        if (alive) { setData(res); setError(""); }
      })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [tick]);

  const counts = useMemo(() => {
    const c = { mc: 0, admin: 0, owner: 0, noEmail: 0 };
    for (const p of data?.staff ?? []) {
      c[p.role]++;
      if (p.role === role && !p.email) c.noEmail++;
    }
    return c;
  }, [data, role]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.staff ?? [])
      .filter((p) => p.role === role)
      .filter((p) => !onlyNoEmail || !p.email)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.email ?? "").includes(q) || (p.phone ?? "").includes(q))
      // มีคิวข้างหน้าแต่ไม่มีอีเมลขึ้นก่อน (ต้องแก้ด่วน) แล้วเรียงตามชื่อ
      .sort((a, b) => Number(!b.email && b.upcoming > 0) - Number(!a.email && a.upcoming > 0) || a.name.localeCompare(b.name, "th"));
  }, [data, role, search, onlyNoEmail]);

  if (!data) {
    return error ? (
      <StateBox title="โหลดรายชื่อไม่สำเร็จ">
        {error}
        <br />
        <button type="button" className={`${btn.ghost} mt-3`} onClick={reload}>ลองอีกครั้ง</button>
      </StateBox>
    ) : <div className="my-4 h-40 animate-pulse rounded-2xl bg-line/70" />;
  }

  return (
    <div className="pb-10">
      <div className="my-2 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="บทบาท" className="flex rounded-full border border-line bg-surface p-0.5">
          {roles.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={role === r}
              onClick={() => { setRole(r); setOnlyNoEmail(false); }}
              className={`rounded-full px-3 py-1 text-sm font-semibold ${role === r ? "bg-brand-soft text-brand" : "text-muted"}`}
            >
              {ROLE_LABEL[r]} <span className="text-xs font-normal">({counts[r]})</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อ อีเมล เบอร์"
          aria-label="ค้นหา"
          className="h-9 min-w-0 flex-1 rounded-full border border-line bg-surface px-3 text-sm"
        />
        <button type="button" className={btn.primary} onClick={() => setEditing("new")}>+ เพิ่มคน</button>
      </div>

      {counts.noEmail > 0 ? (
        <label className="my-2 flex items-center gap-2 rounded-xl border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn-ink">
          <input type="checkbox" checked={onlyNoEmail} onChange={(e) => setOnlyNoEmail(e.target.checked)} className="size-4" />
          {ROLE_LABEL[role]} ที่ยังไม่มีอีเมล {counts.noEmail} คน — login ไม่ได้ และคิวไม่ลงปฏิทิน (แสดงเฉพาะคนกลุ่มนี้)
        </label>
      ) : null}

      {!list.length ? (
        <StateBox title="ไม่พบรายชื่อ">{search ? "ลองค้นหาด้วยคำอื่น" : "กด \"+ เพิ่มคน\" เพื่อเพิ่มรายชื่อ"}</StateBox>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl border border-line bg-surface">
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setEditing(p)}
              className="flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-bg"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                  {displayName(p)}
                  {p.is_extra_admin ? <span className="rounded-full bg-p2/15 px-2 py-0.5 text-[11px] text-p2">Admin เสริม</span> : null}
                  {p.role === "owner" ? <span className="rounded-full bg-p2/15 px-2 py-0.5 text-[11px] text-p2">{scopeLabel(p)}</span> : null}
                  {p.id === data.meId ? <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-brand">คุณ</span> : null}
                </span>
                <span className="block truncate text-xs text-muted">
                  {p.email ?? <span className="font-semibold text-err">ไม่มีอีเมล</span>}
                  {p.phone ? ` · ${p.phone}` : ""}
                  {p.hourly_rate ? ` · ${money(p.hourly_rate)} บาท/ชม.` : ""}
                  {p.commit_tiers?.length ? ` · Commit ${tiersLabel(0, p.commit_tiers)}` : ""}
                </span>
              </span>
              {p.role !== "owner" ? (
                <span className={`shrink-0 text-right text-xs ${p.upcoming && !p.email ? "font-semibold text-err" : "text-muted"}`}>
                  {p.upcoming ? `คิวข้างหน้า ${p.upcoming}` : "–"}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {editing ? (
        <EditDialog
          person={editing === "new" ? null : editing}
          roles={roles}
          defaultRole={role}
          isMe={editing !== "new" && editing.id === data.meId}
          onClose={(changed) => {
            setEditing(null);
            if (changed) { toast(changed); reload(); }
          }}
        />
      ) : null}
    </div>
  );
}

function EditDialog({ person, roles, defaultRole, isMe, onClose }: {
  person: Person | null;
  roles: Role[];
  defaultRole: Role;
  isMe: boolean;
  onClose: (message?: string) => void;
}) {
  const toast = useToast();
  const [role, setRole] = useState<Role>(person?.role ?? defaultRole);
  const [name, setName] = useState(person?.name ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [phone, setPhone] = useState(person?.phone ?? "");
  const [rate, setRate] = useState(person?.hourly_rate != null ? String(person.hourly_rate) : "");
  const [extra, setExtra] = useState(person?.is_extra_admin ?? false);
  // เทียร์ Commit (กรอกเป็นข้อความ ชั่วโมงพิมพ์เป็นช่วงได้ เช่น "10-20" ระบบใช้เลขตัวแรก)
  // ตอนเปิดแก้ แสดงเป็นช่วงให้อ่านง่าย: 10-20 / 21-40 / 41
  const [tiers, setTiers] = useState<{ hours: string; rate: string }[]>(() => {
    const list = [...(person?.commit_tiers ?? [])].sort((a, b) => a.hours - b.hours);
    return list.map((t, i) => {
      const next = list[i + 1];
      const range = next && Number.isInteger(next.hours) && next.hours - 1 > t.hours ? `${t.hours}-${next.hours - 1}` : String(t.hours);
      return { hours: range, rate: String(t.rate) };
    });
  });
  const setTier = (i: number, field: "hours" | "rate", value: string) =>
    setTiers(tiers.map((t, j) => (j === i ? { ...t, [field]: value } : t)));
  const filledTiers = tiers
    .map((t) => ({ hours: parseTierHours(t.hours) ?? 0, rate: Number(t.rate.replace(/[,\s]/g, "")) }))
    .filter((t) => t.hours > 0 && t.rate > 0);
  const [canMc, setCanMc] = useState(person?.can_manage_mc ?? true);
  const [canAdmin, setCanAdmin] = useState(person?.can_manage_admin ?? true);
  const [saving, setSaving] = useState(false);

  const emailChanged = (person?.email ?? "") !== email.trim().toLowerCase();
  const renamed = !!person && person.name !== name.trim().replace(/^mc\s*/i, "");
  const noScope = role === "owner" && !canMc && !canAdmin;

  async function save() {
    setSaving(true);
    try {
      const fields = {
        name, email, phone, hourly_rate: rate, is_extra_admin: extra,
        ...(role !== "owner" ? { commit_tiers: tiers } : {}),
        // สิทธิ์ Owner: แก้สิทธิ์ตัวเองไม่ได้ (server ตรวจซ้ำ)
        ...(role === "owner" && !isMe ? { can_manage_mc: canMc, can_manage_admin: canAdmin } : {}),
      };
      const res = person
        ? await api("/api/owner/staff", { id: person.id, ...fields }, "PATCH")
        : await api("/api/owner/staff", { role, ...fields });
      if (!res.ok) throw new Error(res.message);
      onClose(person ? "บันทึกแล้ว" : "เพิ่มแล้ว");
    } catch (err) {
      toast((err as Error).message, "error");
      setSaving(false);
    }
  }

  async function remove() {
    if (!person || !confirm(`ลบ ${displayName(person)} ออกจากระบบ?`)) return;
    setSaving(true);
    try {
      const res = await api("/api/owner/staff", { id: person.id }, "DELETE");
      if (!res.ok) throw new Error(res.message);
      onClose("ลบแล้ว");
    } catch (err) {
      toast((err as Error).message, "error");
      setSaving(false);
    }
  }

  const field = "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm disabled:opacity-60";
  return (
    <Sheet open onClose={() => onClose()} busy={saving} labelledBy="staffTitle">
      <SheetHead
        id="staffTitle"
        title={person ? `แก้ไข ${displayName(person)}` : "เพิ่มคน"}
        note={person?.upcoming ? `มีคิวตั้งแต่วันนี้ ${person.upcoming} คิว` : undefined}
      />
      <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1 text-sm">
        {!person ? (
          <div role="group" aria-label="บทบาท" className="flex gap-1.5">
            {roles.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={role === r}
                onClick={() => setRole(r)}
                className={`flex-1 rounded-full border px-3 py-1.5 font-semibold ${role === r ? "border-brand bg-brand-soft text-brand" : "border-line text-muted"}`}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
        ) : null}

        <label className="block">
          <span className="mb-1 block font-semibold">ชื่อ{role === "mc" ? " (ไม่ต้องใส่คำว่า Mc)" : ""}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder={role === "mc" ? "เช่น มะนาว" : "เช่น แพรวา"} />
          {renamed ? <span className="mt-1 block text-xs text-muted">ชื่อในชีตทุกแถวของคนนี้จะเปลี่ยนตามอัตโนมัติ</span> : null}
        </label>

        <label className="block">
          <span className="mb-1 block font-semibold">อีเมล Google (ใช้ login และลงปฏิทิน)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={isMe} className={field} placeholder="name@gmail.com" autoComplete="off" />
          {isMe ? <span className="mt-1 block text-xs text-muted">เปลี่ยนอีเมลของตัวเองไม่ได้ ให้ Owner คนอื่นเปลี่ยนให้</span> : null}
          {!isMe && role !== "owner" && emailChanged && email.trim() ? (
            <span className="mt-1 block text-xs text-warn-ink">
              {email.trim().toLowerCase().endsWith("@glorythailand.com")
                ? "อีเมลในองค์กร: ระบบไม่ลงนัดในปฏิทินให้ (ดูคิวจากเว็บ/ชีต)"
                : <>ระบบจะลงคิวข้างหน้าของคนนี้ในปฏิทินของอีเมลนี้ — เจ้าของอีเมลต้องแชร์ปฏิทินให้ kunraroj.d@glorythailand.com (สิทธิ์ &quot;ทำการเปลี่ยนแปลงกิจกรรม&quot;) ก่อน</>}
            </span>
          ) : null}
        </label>

        {role !== "owner" ? (
          <>
            <label className="block">
              <span className="mb-1 block font-semibold">เบอร์โทร</span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} placeholder="08x-xxx-xxxx" />
              <span className="mt-1 block text-xs text-muted">แสดงในปฏิทินของคู่ไลฟ์ (Mc เห็นเบอร์ Admin / Admin เห็นเบอร์ Mc)</span>
            </label>
            <label className="block">
              <span className="mb-1 block font-semibold">ค่าจ้างต่อชั่วโมง (บาท)</span>
              <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className={field} placeholder="ว่าง = ใช้ค่าเริ่มต้น" />
            </label>
            <div>
              <span className="mb-1 block font-semibold">Commit แบบขั้น (ไม่บังคับ)</span>
              <div className="space-y-2">
                {tiers.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={t.hours} onChange={(e) => setTier(i, "hours", e.target.value)} className={field} placeholder={i === 0 ? "เช่น 10-20" : "เช่น 21-40 หรือ 41"} aria-label={`Commit ขั้นที่ ${i + 1}: ช่วงชั่วโมง`} />
                    <span className="shrink-0 text-muted">ชม. →</span>
                    <input inputMode="decimal" value={t.rate} onChange={(e) => setTier(i, "rate", e.target.value)} className={field} placeholder="บาท/ชม." aria-label={`Commit ขั้นที่ ${i + 1}: ค่าจ้างต่อชั่วโมง`} />
                    <button
                      type="button"
                      onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
                      aria-label={`ลบ Commit ขั้นที่ ${i + 1}`}
                      className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-err/10 hover:text-err"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              {tiers.length < 10 ? (
                <button type="button" onClick={() => setTiers([...tiers, { hours: "", rate: "" }])} className="mt-2 text-sm font-semibold text-brand hover:underline">
                  + เพิ่มขั้น Commit
                </button>
              ) : null}
              <span className="mt-1 block text-xs text-muted">
                {filledTiers.length
                  ? <>ผลลัพธ์: {tiersLabel(Number(rate.replace(/[,\s]/g, "")) || 0, filledTiers)} บาท/ชม.<br />เดือนไหนจอง (ไม่นับคิวที่ยกเลิก) ถึงขั้นไหน ทุกชั่วโมงของเดือนนั้นคิดราคาขั้นนั้น</>
                  : "ใส่ช่วงชั่วโมงของแต่ละขั้น เช่น 10-20 → 950, 21-40 → 900, 41 → 850 (ต่ำกว่าขั้นแรกใช้ค่าจ้างต่อชั่วโมงด้านบน)"}
              </span>
            </div>
          </>
        ) : null}

        {role === "admin" ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} className="size-4 accent-[var(--brand)]" />
            Admin เสริม (รับคิวและยกเลิกคิวผ่านเว็บได้เอง)
          </label>
        ) : null}

        {role === "owner" ? (
          <fieldset className="rounded-lg border border-line px-3 py-2">
            <legend className="px-1 font-semibold">สิทธิ์จัดการ</legend>
            {([
              ["mc", "Mc", "สรุปรายเดือน / slot / รายชื่อ ฝั่ง Mc", canMc, setCanMc],
              ["admin", "Admin", "สรุปรายเดือน / slot / รายชื่อ ฝั่ง Admin", canAdmin, setCanAdmin],
            ] as const).map(([key, label, hint, checked, set]) => (
              <label key={key} className="flex items-start gap-2 py-1">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isMe}
                  onChange={(e) => set(e.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--brand)]"
                />
                <span>
                  จัดการ {label}
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
              </label>
            ))}
            <span className="mt-1 block text-xs text-muted">
              {isMe ? "แก้สิทธิ์ของตัวเองไม่ได้ ให้ Owner คนอื่นที่มีสิทธิ์ทั้งคู่แก้ให้"
                : noScope ? <span className="text-err">ติ๊กอย่างน้อย 1 ฝั่ง</span>
                  : "ติ๊กทั้งคู่ = จัดการได้ทั้งหมด รวมถึงรายชื่อและสิทธิ์ของ Owner คนอื่น"}
            </span>
          </fieldset>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-2">
        {person && !isMe ? (
          <button type="button" onClick={remove} disabled={saving} className="mr-auto text-sm font-semibold text-err hover:underline">ลบคนนี้</button>
        ) : <span className="mr-auto" />}
        <button type="button" className={btn.ghost} disabled={saving} onClick={() => onClose()}>ยกเลิก</button>
        <button type="button" className={btn.primary} disabled={saving || !name.trim() || noScope} onClick={save}>
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
    </Sheet>
  );
}
