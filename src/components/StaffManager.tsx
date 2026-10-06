"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { PlusIcon, SearchIcon, XIcon } from "lucide-react";
import {
  AppDialog, DialogActions, DialogBody, LoadError, LoadingBlock, StateBox, api, useConfirm, useToast,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { parseTierHours, tiersLabel } from "@/lib/pay";
import type { CommitTier, OwnerScope } from "@/lib/types";

type Role = "mc" | "admin" | "owner";
type Person = {
  id: number; role: Role; name: string; email: string | null; phone: string | null;
  hourly_rate: number | null; is_extra_admin: boolean; is_salaried: boolean; upcoming: number;
  commit_tiers: CommitTier[] | null;
  can_manage_mc: boolean; can_manage_admin: boolean; can_manage_proofs: boolean;
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
    return error ? <LoadError title="โหลดรายชื่อไม่สำเร็จ" message={error} onRetry={reload} /> : <LoadingBlock />;
  }

  return (
    <div className="pb-10">
      <div className="my-2 flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={role}
          onValueChange={(v) => { if (v) { setRole(v as Role); setOnlyNoEmail(false); } }}
          aria-label="บทบาท"
          className="bg-card"
        >
          {roles.map((r) => (
            <ToggleGroupItem key={r} value={r} className="font-semibold">
              {ROLE_LABEL[r]} <span className="text-xs font-normal">({counts[r]})</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <InputGroup className="h-8 min-w-40 flex-1 bg-card">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ อีเมล เบอร์"
            aria-label="ค้นหา"
          />
        </InputGroup>
        <Button onClick={() => setEditing("new")}><PlusIcon />เพิ่มคน</Button>
      </div>

      {counts.noEmail > 0 ? (
        <Label className="my-2 flex items-center gap-2 rounded-xl border border-warning-border bg-warning px-3 py-2 leading-snug font-normal text-warning-foreground">
          <Checkbox checked={onlyNoEmail} onCheckedChange={(v) => setOnlyNoEmail(v === true)} className="bg-card" />
          {ROLE_LABEL[role]} ที่ยังไม่มีอีเมล {counts.noEmail} คน — login ไม่ได้ และคิวไม่ลงปฏิทิน (แสดงเฉพาะคนกลุ่มนี้)
        </Label>
      ) : null}

      {!list.length ? (
        <StateBox title="ไม่พบรายชื่อ">{search ? "ลองค้นหาด้วยคำอื่น" : "กด \"เพิ่มคน\" เพื่อเพิ่มรายชื่อ"}</StateBox>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl border bg-card">
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setEditing(p)}
              className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left outline-none last:border-b-0 hover:bg-muted focus-visible:bg-muted"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                  {displayName(p)}
                  {p.is_extra_admin ? <Badge className="bg-p2/15 text-[11px] text-p2">Admin เสริม</Badge> : null}
                  {p.is_salaried ? <Badge className="bg-p2/15 text-[11px] text-p2">Mc ประจำ</Badge> : null}
                  {p.role === "owner" ? <Badge className="bg-p2/15 text-[11px] text-p2">{scopeLabel(p)}</Badge> : null}
                  {p.role === "owner" && p.can_manage_proofs && !p.can_manage_mc
                    ? <Badge className="bg-p2/15 text-[11px] text-p2">หลักฐานไลฟ์</Badge>
                    : null}
                  {p.id === data.meId ? <Badge variant="secondary" className="text-[11px]">คุณ</Badge> : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {p.email ?? <span className="font-semibold text-destructive">ไม่มีอีเมล</span>}
                  {p.phone ? ` · ${p.phone}` : ""}
                  {p.hourly_rate ? ` · ${money(p.hourly_rate)} บาท/ชม.` : ""}
                  {p.commit_tiers?.length ? ` · Commit ${tiersLabel(0, p.commit_tiers)}` : ""}
                </span>
              </span>
              {p.role !== "owner" ? (
                <span className={cn("shrink-0 text-right text-xs", p.upcoming && !p.email ? "font-semibold text-destructive" : "text-muted-foreground")}>
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
  const confirm = useConfirm();
  const [role, setRole] = useState<Role>(person?.role ?? defaultRole);
  const [name, setName] = useState(person?.name ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [phone, setPhone] = useState(person?.phone ?? "");
  const [rate, setRate] = useState(person?.hourly_rate != null ? String(person.hourly_rate) : "");
  const [extra, setExtra] = useState(person?.is_extra_admin ?? false);
  const [salaried, setSalaried] = useState(person?.is_salaried ?? false);
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
  const [canProofs, setCanProofs] = useState(person?.can_manage_proofs ?? false);
  const [saving, setSaving] = useState(false);

  const emailChanged = (person?.email ?? "") !== email.trim().toLowerCase();
  const renamed = !!person && person.name !== name.trim().replace(/^mc\s*/i, "");
  const noScope = role === "owner" && !canMc && !canAdmin;

  async function save() {
    setSaving(true);
    try {
      const fields = {
        name, email, phone, hourly_rate: rate, is_extra_admin: extra, is_salaried: salaried,
        ...(role !== "owner" ? { commit_tiers: tiers } : {}),
        // สิทธิ์ Owner: แก้สิทธิ์ตัวเองไม่ได้ (server ตรวจซ้ำ)
        ...(role === "owner" && !isMe ? { can_manage_mc: canMc, can_manage_admin: canAdmin, can_manage_proofs: canProofs } : {}),
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
    if (!person || !(await confirm({ title: `ลบ ${displayName(person)} ออกจากระบบ?`, confirmText: "ลบ", destructive: true }))) return;
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

  return (
    <AppDialog
      open
      onClose={() => onClose()}
      busy={saving}
      title={person ? `แก้ไข ${displayName(person)}` : "เพิ่มคน"}
      description={person?.upcoming ? `มีคิวตั้งแต่วันนี้ ${person.upcoming} คิว` : undefined}
    >
      <DialogBody className="space-y-4 text-sm">
        {!person ? (
          <ToggleGroup
            type="single"
            variant="outline"
            value={role}
            onValueChange={(v) => { if (v) setRole(v as Role); }}
            aria-label="บทบาท"
            className="w-full"
          >
            {roles.map((r) => <ToggleGroupItem key={r} value={r} className="flex-1 font-semibold">{ROLE_LABEL[r]}</ToggleGroupItem>)}
          </ToggleGroup>
        ) : null}

        <Field
          label={`ชื่อ${role === "mc" ? " (ไม่ต้องใส่คำว่า Mc)" : ""}`}
          hint={renamed ? "ชื่อในชีตทุกแถวของคนนี้จะเปลี่ยนตามอัตโนมัติ" : null}
        >
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={role === "mc" ? "เช่น มะนาว" : "เช่น แพรวา"} />}
        </Field>

        <Field
          label="อีเมล Google (ใช้ login และลงปฏิทิน)"
          hint={isMe ? "เปลี่ยนอีเมลของตัวเองไม่ได้ ให้ Owner คนอื่นเปลี่ยนให้" : null}
          warning={!isMe && role !== "owner" && emailChanged && email.trim()
            ? email.trim().toLowerCase().endsWith("@glorythailand.com")
              ? "อีเมลในองค์กร: ระบบไม่ลงนัดในปฏิทินให้ (ดูคิวจากเว็บ/ชีต)"
              : <>ระบบจะลงคิวข้างหน้าของคนนี้ในปฏิทินของอีเมลนี้ — เจ้าของอีเมลต้องแชร์ปฏิทินให้ kunraroj.d@glorythailand.com (สิทธิ์ &quot;ทำการเปลี่ยนแปลงกิจกรรม&quot;) ก่อน</>
            : null}
        >
          {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={isMe} placeholder="name@gmail.com" autoComplete="off" />}
        </Field>

        {role !== "owner" ? (
          <>
            <Field label="เบอร์โทร" hint="แสดงในปฏิทินของคู่ไลฟ์ (Mc เห็นเบอร์ Admin / Admin เห็นเบอร์ Mc)">
              {(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08x-xxx-xxxx" />}
            </Field>
            <Field label="ค่าจ้างต่อชั่วโมง (บาท)">
              {(id) => <Input id={id} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="ว่าง = ใช้ค่าเริ่มต้น" />}
            </Field>
            <div>
              <span className="mb-1.5 block font-semibold">Commit แบบขั้น (ไม่บังคับ)</span>
              <div className="space-y-2">
                {tiers.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={t.hours} onChange={(e) => setTier(i, "hours", e.target.value)} placeholder={i === 0 ? "เช่น 10-20" : "เช่น 21-40 หรือ 41"} aria-label={`Commit ขั้นที่ ${i + 1}: ช่วงชั่วโมง`} />
                    <span className="shrink-0 text-muted-foreground">ชม. →</span>
                    <Input inputMode="decimal" value={t.rate} onChange={(e) => setTier(i, "rate", e.target.value)} placeholder="บาท/ชม." aria-label={`Commit ขั้นที่ ${i + 1}: ค่าจ้างต่อชั่วโมง`} />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
                      aria-label={`ลบ Commit ขั้นที่ ${i + 1}`}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <XIcon />
                    </Button>
                  </div>
                ))}
              </div>
              {tiers.length < 10 ? (
                <Button variant="link" className="mt-1 h-auto px-0 font-semibold" onClick={() => setTiers([...tiers, { hours: "", rate: "" }])}>
                  <PlusIcon />เพิ่มขั้น Commit
                </Button>
              ) : null}
              <span className="mt-1 block text-xs text-muted-foreground">
                {filledTiers.length
                  ? <>ผลลัพธ์: {tiersLabel(Number(rate.replace(/[,\s]/g, "")) || 0, filledTiers)} บาท/ชม.<br />เดือนไหนจอง (ไม่นับคิวที่ยกเลิก) ถึงขั้นไหน ทุกชั่วโมงของเดือนนั้นคิดราคาขั้นนั้น</>
                  : "ใส่ช่วงชั่วโมงของแต่ละขั้น เช่น 10-20 → 950, 21-40 → 900, 41 → 850 (ต่ำกว่าขั้นแรกใช้ค่าจ้างต่อชั่วโมงด้านบน)"}
              </span>
            </div>
          </>
        ) : null}

        {role === "admin" ? (
          <Label className="leading-snug font-normal">
            <Checkbox checked={extra} onCheckedChange={(v) => setExtra(v === true)} />
            Admin เสริม (รับคิวและยกเลิกคิวผ่านเว็บได้เอง)
          </Label>
        ) : null}

        {role === "mc" ? (
          <Label className="items-start leading-snug font-normal">
            <Checkbox checked={salaried} onCheckedChange={(v) => setSalaried(v === true)} className="mt-0.5" />
            <span>
              Mc ประจำ (พนักงานประจำ ได้เงินเดือน)
              <span className="block text-xs text-muted-foreground">
                ไม่ต้องแนบหลักฐานไลฟ์ — slot ของคนนี้จะไม่ขึ้นในหน้าหลักฐานไลฟ์ และสรุปรายเดือนแสดง &quot;ไม่ต้องแนบ&quot;
              </span>
            </span>
          </Label>
        ) : null}

        {role === "owner" ? (
          <fieldset className="rounded-lg border px-3 py-2">
            <legend className="px-1 font-semibold">สิทธิ์จัดการ</legend>
            {([
              ["mc", "Mc", "สรุปรายเดือน / slot / รายชื่อ ฝั่ง Mc", canMc, setCanMc],
              ["admin", "Admin", "สรุปรายเดือน / slot / รายชื่อ ฝั่ง Admin", canAdmin, setCanAdmin],
            ] as const).map(([key, label, hint, checked, set]) => (
              <Label key={key} className="items-start py-1 leading-snug font-normal">
                <Checkbox checked={checked} disabled={isMe} onCheckedChange={(v) => set(v === true)} className="mt-0.5" />
                <span>
                  จัดการ {label}
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </span>
              </Label>
            ))}
            <Label className="items-start border-t pt-2 pb-1 leading-snug font-normal">
              <Checkbox
                checked={canMc || canProofs}
                disabled={isMe || canMc}
                onCheckedChange={(v) => setCanProofs(v === true)}
                className="mt-0.5"
              />
              <span>
                จัดการหลักฐานไลฟ์ (ทุก slot)
                <span className="block text-xs text-muted-foreground">
                  {canMc
                    ? "ติ๊กจัดการ Mc แล้ว มีสิทธิ์นี้อยู่แล้ว"
                    : "แนบ / แทนที่ / ลบ รูปหลักฐานไลฟ์ของทุก slot ได้ ไม่ใช่แค่ slot ที่ตัวเองเป็น Admin"}
                </span>
              </span>
            </Label>
            <span className="mt-1 block text-xs text-muted-foreground">
              {isMe ? "แก้สิทธิ์ของตัวเองไม่ได้ ให้ Owner คนอื่นที่มีสิทธิ์ทั้งคู่แก้ให้"
                : noScope ? <span className="text-destructive">ติ๊กอย่างน้อย 1 ฝั่ง</span>
                  : "ติ๊กทั้งคู่ = จัดการได้ทั้งหมด รวมถึงรายชื่อและสิทธิ์ของ Owner คนอื่น"}
            </span>
          </fieldset>
        ) : null}
      </DialogBody>

      <DialogActions>
        {person && !isMe ? (
          <Button variant="destructive" size="lg" onClick={remove} disabled={saving} className="mr-auto">ลบคนนี้</Button>
        ) : null}
        <Button variant="outline" size="lg" disabled={saving} onClick={() => onClose()}>ยกเลิก</Button>
        <Button size="lg" disabled={saving || !name.trim() || noScope} onClick={save}>
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </Button>
      </DialogActions>
    </AppDialog>
  );
}

/** ช่องกรอก + ป้ายชื่อ + คำอธิบายใต้ช่อง (children รับ id ไปใส่ในช่องกรอก) */
function Field({ label, hint, warning, children }: {
  label: ReactNode;
  hint?: ReactNode;
  warning?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id} className="mb-1.5 font-semibold">{label}</Label>
      {children(id)}
      {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
      {warning ? <span className="mt-1 block text-xs text-warning-foreground">{warning}</span> : null}
    </div>
  );
}
