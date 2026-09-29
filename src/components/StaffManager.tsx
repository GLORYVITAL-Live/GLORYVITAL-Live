"use client";

import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetHead, StateBox, api, btn, useToast } from "@/components/ui";
import { money } from "@/lib/format";

type Role = "mc" | "admin" | "owner";
type Person = {
  id: number; role: Role; name: string; email: string | null; phone: string | null;
  hourly_rate: number | null; is_extra_admin: boolean; upcoming: number;
};

const ROLE_LABEL: Record<Role, string> = { mc: "Mc", admin: "Admin", owner: "Owner" };
const displayName = (p: Pick<Person, "role" | "name">) => (p.role === "mc" ? `Mc ${p.name}` : p.name);

/** จัดการรายชื่อพนักงาน: ดู / ค้นหา / เพิ่ม / แก้ / ลบ */
export function StaffManager() {
  const toast = useToast();
  const [data, setData] = useState<{ staff: Person[]; meId: number | null } | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [role, setRole] = useState<Role>("mc");
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
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
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
                  {p.id === data.meId ? <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-brand">คุณ</span> : null}
                </span>
                <span className="block truncate text-xs text-muted">
                  {p.email ?? <span className="font-semibold text-err">ไม่มีอีเมล</span>}
                  {p.phone ? ` · ${p.phone}` : ""}
                  {p.hourly_rate ? ` · ${money(p.hourly_rate)} บาท/ชม.` : ""}
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

function EditDialog({ person, defaultRole, isMe, onClose }: {
  person: Person | null;
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
  const [saving, setSaving] = useState(false);

  const emailChanged = (person?.email ?? "") !== email.trim().toLowerCase();
  const renamed = !!person && person.name !== name.trim().replace(/^mc\s*/i, "");

  async function save() {
    setSaving(true);
    try {
      const fields = { name, email, phone, hourly_rate: rate, is_extra_admin: extra };
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
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
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
              ระบบจะลงคิวข้างหน้าของคนนี้ในปฏิทินของอีเมลนี้ — เจ้าของอีเมลต้องแชร์ปฏิทินให้ kunraroj.d@glorythailand.com (สิทธิ์ &quot;ทำการเปลี่ยนแปลงกิจกรรม&quot;) ก่อน
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
          </>
        ) : null}

        {role === "admin" ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} className="size-4 accent-[var(--brand)]" />
            Admin เสริม (รับคิวและยกเลิกคิวผ่านเว็บได้เอง)
          </label>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-2">
        {person && !isMe ? (
          <button type="button" onClick={remove} disabled={saving} className="mr-auto text-sm font-semibold text-err hover:underline">ลบคนนี้</button>
        ) : <span className="mr-auto" />}
        <button type="button" className={btn.ghost} disabled={saving} onClick={() => onClose()}>ยกเลิก</button>
        <button type="button" className={btn.primary} disabled={saving || !name.trim()} onClick={save}>
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
    </Sheet>
  );
}
