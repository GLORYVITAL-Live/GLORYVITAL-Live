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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  can_manage_mc: boolean; can_manage_admin: boolean; can_manage_proofs: boolean; can_view_analytics: boolean;
  can_plan_slots?: boolean; // ไม่มี = ยังไม่ได้รัน SQL 20261017000000_plan_slots
  // ดูได้อย่างเดียว (ไม่มี = ยังไม่ได้รัน SQL 20261018000000_view_only)
  can_view_mc?: boolean; can_view_admin?: boolean; can_view_proofs?: boolean; can_view_plan?: boolean; analytics_readonly?: boolean;
};
type StaffData = { staff: Person[]; meId: number | null; canEdit?: Record<Role, boolean> };

const ROLE_LABEL: Record<Role, string> = { mc: "Mc", admin: "Admin", owner: "Owner" };
const displayName = (p: Pick<Person, "role" | "name">) => (p.role === "mc" ? `Mc ${p.name}` : p.name);
/** บทบาทที่ Owner คนนี้เปิดดูได้ (รายชื่อ Owner = ต้องมีสิทธิ์ทั้ง Mc และ Admin) */
const rolesOf = (scope: OwnerScope): Role[] =>
  [...(scope.mc ? ["mc" as const] : []), ...(scope.admin ? ["admin" as const] : []), ...(scope.mc && scope.admin ? ["owner" as const] : [])];
const phoneDigits = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "");

// ---------- สิทธิ์ Owner 3 ระดับ: ไม่มี / ดูได้ / จัดการได้ ----------

type Level = "none" | "view" | "edit";
type Area = "mc" | "admin" | "proofs" | "plan" | "analytics";
const LEVELS: [Level, string][] = [["none", "ไม่มี"], ["view", "ดูได้"], ["edit", "จัดการได้"]];
const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2 };
const levelOf = (manage: boolean | undefined, view: boolean | undefined): Level => (manage ? "edit" : view ? "view" : "none");
/** ระดับสิทธิ์ของ Owner แต่ละเรื่อง (ใหม่ = จัดการ Mc + Admin ได้เหมือนเดิม) */
function permsOf(p: Person | null): Record<Area, Level> {
  return {
    mc: levelOf(p ? p.can_manage_mc !== false : true, p?.can_view_mc),
    admin: levelOf(p ? p.can_manage_admin !== false : true, p?.can_view_admin),
    proofs: levelOf(p?.can_manage_proofs, p?.can_view_proofs),
    plan: levelOf(p?.can_plan_slots, p?.can_view_plan),
    analytics: p?.can_view_analytics ? (p.analytics_readonly ? "view" : "edit") : "none",
  };
}
/** ป้ายสิทธิ์ในรายชื่อ Owner */
function permBadges(p: Person) {
  const v = permsOf(p);
  const out: string[] = [];
  if (v.mc === "edit" && v.admin === "edit") out.push("จัดการทั้งหมด");
  else {
    for (const [k, label] of [["mc", "Mc"], ["admin", "Admin"]] as const) {
      if (v[k] !== "none") out.push(`${v[k] === "edit" ? "จัดการ" : "ดู"} ${label}`);
    }
  }
  // หลักฐานไลฟ์: ฝั่ง Mc ครอบอยู่แล้ว แสดงเฉพาะที่ได้มากกว่าฝั่ง Mc
  if (RANK[v.proofs] > RANK[v.mc]) out.push(v.proofs === "edit" ? "หลักฐานไลฟ์" : "ดูหลักฐานไลฟ์");
  if (v.plan !== "none") out.push(v.plan === "edit" ? "Plan Slot Live" : "ดู Plan Slot Live");
  if (v.analytics !== "none") out.push(v.analytics === "edit" ? "Data analytics" : "ดู Data analytics");
  return out;
}

/**
 * จัดการรายชื่อพนักงาน: ดู / ค้นหา / เพิ่ม / แก้ / ลบ (เฉพาะบทบาทที่มีสิทธิ์)
 *   scope = ฝั่งที่เห็น · ฝั่งที่ดูได้อย่างเดียว = เห็นรายชื่อ / อีเมล / เบอร์ แต่ไม่เห็นค่าจ้าง และแก้ไม่ได้
 *   canGrantPlan = คนที่ใช้อยู่มีสิทธิ์ Plan Slot Live (ติ๊ก / เอาสิทธิ์นี้ของ Owner คนอื่นออกได้)
 */
export function StaffManager({ scope, canGrantPlan = false }: { scope: OwnerScope; canGrantPlan?: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<StaffData | null>(null);
  // แก้รายชื่อบทบาทนี้ได้หรือไม่ (เซิร์ฟเวอร์ตัดสิน · ยังไม่โหลด = ถือว่าแก้ไม่ได้)
  const canEditRole = (r: Role) => !!data && (data.canEdit ? data.canEdit[r] : r !== "owner" || (scope.mc && scope.admin));
  const roles = rolesOf(scope).filter((r) => r !== "owner" || canEditRole("owner"));
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [role, setRole] = useState<Role>(roles[0] ?? "mc");
  const [search, setSearch] = useState("");
  const [onlyNoEmail, setOnlyNoEmail] = useState(false);
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  const reload = () => setTick((n) => n + 1);

  useEffect(() => {
    let alive = true;
    api<StaffData>("/api/owner/staff")
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

  // เบอร์เดียวกันหลายรายชื่อ (บทบาทเดียวกัน) = อาจลงชื่อซ้ำ
  const samePhone = useMemo(() => {
    const by = new Map<string, number[]>();
    for (const p of data?.staff ?? []) {
      const d = phoneDigits(p.phone);
      if (p.role !== "owner" && d.length >= 9) by.set(`${p.role}|${d}`, [...(by.get(`${p.role}|${d}`) ?? []), p.id]);
    }
    return new Set([...by.values()].filter((ids) => ids.length > 1).flat());
  }, [data]);

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
        {canEditRole(role) ? <Button onClick={() => setEditing("new")}><PlusIcon />เพิ่มคน</Button> : null}
      </div>
      {!canEditRole(role) ? (
        <p className="my-1 text-xs text-muted-foreground">รายชื่อ {ROLE_LABEL[role]}: ดูได้อย่างเดียว (ไม่แสดงค่าจ้าง / Commit)</p>
      ) : null}

      {counts.noEmail > 0 ? (
        <Label className="my-2 flex items-center gap-2 rounded-xl border border-warning-border bg-warning px-3 py-2 leading-snug font-normal text-warning-foreground">
          <Checkbox checked={onlyNoEmail} onCheckedChange={(v) => setOnlyNoEmail(v === true)} className="bg-card" />
          {ROLE_LABEL[role]} ที่ยังไม่มีอีเมล {counts.noEmail} คน — login ไม่ได้ และคิวไม่ลงปฏิทิน (แสดงเฉพาะคนกลุ่มนี้)
        </Label>
      ) : null}

      {!list.length ? (
        <StateBox title="ไม่พบรายชื่อ">{search ? "ลองค้นหาด้วยคำอื่น" : canEditRole(role) ? "กด \"เพิ่มคน\" เพื่อเพิ่มรายชื่อ" : null}</StateBox>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl border bg-card">
          {list.map((p) => {
            const row = "flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0";
            const body = (
              <>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                  {displayName(p)}
                  {p.is_extra_admin ? <Badge className="bg-p2/15 text-[11px] text-p2">Admin เสริม</Badge> : null}
                  {p.is_salaried ? <Badge className="bg-p2/15 text-[11px] text-p2">Mc ประจำ</Badge> : null}
                  {p.role === "owner" ? permBadges(p).map((b) => (
                    <Badge key={b} className={cn("text-[11px]", b.startsWith("ดู") ? "bg-muted text-muted-foreground" : "bg-p2/15 text-p2")}>{b}</Badge>
                  )) : null}
                  {p.id === data.meId ? <Badge variant="secondary" className="text-[11px]">คุณ</Badge> : null}
                  {samePhone.has(p.id) ? (
                    <Badge className="border-warning-border bg-warning text-[11px] text-warning-foreground" title="เบอร์เดียวกับรายชื่ออื่น อาจลงชื่อซ้ำ กดเพื่อรวมรายชื่อ">เบอร์ซ้ำ</Badge>
                  ) : null}
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
              </>
            );
            // ดูได้อย่างเดียว: แถวกดไม่ได้
            return canEditRole(p.role) ? (
              <button key={p.id} type="button" onClick={() => setEditing(p)} className={cn(row, "outline-none hover:bg-muted focus-visible:bg-muted")}>
                {body}
              </button>
            ) : <div key={p.id} className={row}>{body}</div>;
          })}
        </div>
      )}

      {editing ? (
        <EditDialog
          person={editing === "new" ? null : editing}
          roles={roles.filter(canEditRole)}
          defaultRole={role}
          isMe={editing !== "new" && editing.id === data.meId}
          canGrantPlan={canGrantPlan && data.staff.some((p) => p.can_plan_slots !== undefined)}
          viewReady={data.staff.some((p) => p.can_view_mc !== undefined)}
          others={editing === "new" ? [] : data.staff.filter((p) => p.role === editing.role && p.id !== editing.id)}
          onClose={(changed) => {
            setEditing(null);
            if (changed) { toast(changed); reload(); }
          }}
        />
      ) : null}
    </div>
  );
}

type MergeSummary = {
  source: string; target: string; total: number; upcoming: number; conflicts: number;
  moveEmail: string | null; movePhone: string | null;
};

function EditDialog({ person, roles, defaultRole, isMe, canGrantPlan, viewReady, others, onClose }: {
  person: Person | null;
  roles: Role[];
  defaultRole: Role;
  isMe: boolean;
  canGrantPlan: boolean;
  /** รัน SQL 20261018000000_view_only แล้ว (มีคอลัมน์สิทธิ์ดูได้อย่างเดียว) */
  viewReady: boolean;
  /** รายชื่ออื่นในบทบาทเดียวกัน (ใช้รวมรายชื่อซ้ำ) */
  others: Person[];
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
  const [perm, setPerm] = useState(() => permsOf(person));
  // ฝั่ง Mc ครอบหลักฐานไลฟ์อยู่แล้ว (จัดการ Mc = จัดการหลักฐานได้ / ดู Mc = ดูหลักฐานได้)
  const proofsLevel: Level = RANK[perm.mc] > RANK[perm.proofs] ? perm.mc : perm.proofs;
  const [saving, setSaving] = useState(false);

  const emailChanged = (person?.email ?? "") !== email.trim().toLowerCase();
  const renamed = !!person && person.name !== name.trim().replace(/^mc\s*/i, "");
  const noScope = role === "owner" && Object.values(perm).every((l) => l === "none");
  const anyView = Object.values(perm).some((l) => l === "view");

  async function save() {
    setSaving(true);
    try {
      const manage = {
        can_manage_mc: perm.mc === "edit", can_manage_admin: perm.admin === "edit",
        can_manage_proofs: perm.proofs === "edit", can_view_analytics: perm.analytics !== "none",
      };
      // คอลัมน์ดูได้อย่างเดียว: ส่งเมื่อรัน SQL แล้ว หรือเลือก "ดูได้" (ยังไม่รัน SQL = เซิร์ฟเวอร์แจ้งให้รันก่อน)
      const view = viewReady || anyView ? {
        can_view_mc: perm.mc === "view", can_view_admin: perm.admin === "view", can_view_proofs: perm.proofs === "view",
        analytics_readonly: perm.analytics === "view",
      } : {};
      const fields = {
        name, email, phone, hourly_rate: rate, is_extra_admin: extra, is_salaried: salaried,
        ...(role !== "owner" ? { commit_tiers: tiers } : {}),
        // สิทธิ์ Owner: แก้สิทธิ์ตัวเองไม่ได้ (server ตรวจซ้ำ)
        ...(role === "owner" && !isMe ? { ...manage, ...view } : {}),
        // Plan Slot Live: ให้คนอื่นได้เฉพาะคนที่มีสิทธิ์นี้
        ...(role === "owner" && !isMe && canGrantPlan
          ? { can_plan_slots: perm.plan === "edit", ...(viewReady || perm.plan === "view" ? { can_view_plan: perm.plan === "view" } : {}) }
          : {}),
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

  // ---------- รวมรายชื่อซ้ำ: ย้ายคิวทั้งหมดของคนนี้ไปให้รายชื่อที่เลือก แล้วลบคนนี้ ----------
  const twin = person ? others.find((o) => phoneDigits(o.phone).length >= 9 && phoneDigits(o.phone) === phoneDigits(person.phone)) : undefined;
  const [mergeTo, setMergeTo] = useState(twin ? String(twin.id) : "");
  const [mergeInfo, setMergeInfo] = useState<MergeSummary | null>(null);

  async function checkMerge() {
    if (!person || !mergeTo) return;
    setSaving(true);
    try {
      const res = await api<{ summary: MergeSummary }>("/api/owner/staff/merge", { sourceId: person.id, targetId: Number(mergeTo), dryRun: true });
      if (!res.ok) throw new Error(res.message);
      setMergeInfo(res.summary);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function doMerge() {
    if (!person || !mergeInfo) return;
    const ok = await confirm({
      title: `รวม ${mergeInfo.source} เข้ากับ ${mergeInfo.target}?`,
      description: `ย้ายคิวทั้งหมด ${mergeInfo.total} คิวไปเป็นของ ${mergeInfo.target} (ชีตและปฏิทินอัปเดตให้) แล้วลบรายชื่อ ${mergeInfo.source} — ย้อนกลับไม่ได้`,
      confirmText: "รวมรายชื่อ", destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await api<{ message: string }>("/api/owner/staff/merge", { sourceId: person.id, targetId: Number(mergeTo) });
      if (!res.ok) throw new Error(res.message);
      onClose(res.message);
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
            <legend className="px-1 font-semibold">สิทธิ์</legend>
            <p className="pb-1 text-xs text-muted-foreground">
              ดูได้ = เห็นข้อมูล + ส่งออกได้ แต่แก้ไม่ได้ และไม่เห็นค่าจ้าง (ค่าจ้าง / ยอดเงิน / Commit) · จัดการได้ = ดู + แก้ได้ทั้งหมด
            </p>
            {([
              ["mc", "ฝั่ง Mc", "สรุปรายเดือน / ตาราง slot / รายชื่อ / ผลงาน Mc ฝั่ง Mc"],
              ["admin", "ฝั่ง Admin", "สรุปรายเดือน / ตาราง slot / รายชื่อ ฝั่ง Admin"],
              ["proofs", "หลักฐานไลฟ์ (ทุก slot)",
                perm.mc !== "none" ? `ได้ตามฝั่ง Mc อย่างน้อย "${LEVELS.find(([l]) => l === perm.mc)![1]}" · จัดการ = แนบ / แทนที่ / ลบรูป + กรอก GMV ทุก slot`
                  : "จัดการ = แนบ / แทนที่ / ลบรูป + กรอก GMV ทุก slot ไม่ใช่แค่ slot ที่ตัวเองเป็น Admin"],
              ...(canGrantPlan || person?.can_plan_slots || person?.can_view_plan
                ? [["plan", "Plan Slot Live", `แพลน slot ทั้งเดือน แล้วเขียนลงชีต Deal Mc + Admin เสริม${!canGrantPlan ? " (ตั้งได้เฉพาะคนที่จัดการ Plan Slot Live ได้)" : ""}`] as const]
                : []),
              ["analytics", "Data analytics", "สถิติไลฟ์ TikTok / Shopee · จัดการ = อัปโหลดข้อมูล + ตั้งแคมเปญเองได้"],
            ] as const).map(([key, label, hint]) => {
              const value = key === "proofs" ? proofsLevel : perm[key];
              const locked = isMe || (key === "plan" && !canGrantPlan);
              return (
                <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 last:border-b-0">
                  <span className="min-w-0 flex-1 leading-snug">
                    <span className="font-medium">{label}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                  <ToggleGroup
                    type="single" variant="outline" size="sm" spacing={0} value={value} disabled={locked}
                    onValueChange={(v) => { if (v) setPerm({ ...perm, [key]: v as Level }); }}
                    aria-label={`สิทธิ์ ${label}`}
                  >
                    {LEVELS.map(([l, text]) => (
                      <ToggleGroupItem
                        key={l} value={l}
                        // หลักฐานไลฟ์ต่ำกว่าฝั่ง Mc ไม่ได้
                        disabled={locked || (key === "proofs" && RANK[l] < RANK[perm.mc])}
                        className="px-2.5 text-xs font-semibold data-[state=on]:bg-primary! data-[state=on]:text-primary-foreground!"
                      >
                        {text}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              );
            })}
            <span className="mt-1 block text-xs text-muted-foreground">
              {isMe ? "แก้สิทธิ์ของตัวเองไม่ได้ ให้ Owner คนอื่นที่จัดการได้ทั้ง Mc และ Admin แก้ให้"
                : noScope ? <span className="text-destructive">ตั้งอย่างน้อย 1 อย่าง</span>
                  : anyView && !viewReady ? <span className="text-destructive">ต้องรัน SQL 20261018000000_view_only ใน Supabase ก่อน ถึงจะตั้ง &quot;ดูได้&quot; ได้</span>
                    : perm.mc === "none" && perm.admin === "none" ? "ไม่มีสิทธิ์ฝั่ง Mc / Admin = ไม่เห็นหน้าเจ้าของ (สรุปรายเดือน slot รายชื่อ) เห็นเฉพาะหน้าที่ตั้งไว้"
                      : perm.mc === "edit" && perm.admin === "edit" ? "จัดการได้ทั้ง Mc + Admin = จัดการได้ทั้งหมด รวมถึงรายชื่อและสิทธิ์ของ Owner คนอื่น"
                        : "รายชื่อและสิทธิ์ของ Owner คนอื่น จัดการได้เฉพาะคนที่จัดการได้ทั้ง Mc และ Admin"}
            </span>
          </fieldset>
        ) : null}

        {person && person.role !== "owner" && others.length ? (
          <fieldset className="space-y-2 rounded-xl border p-3">
            <legend className="px-1 font-semibold">รวมรายชื่อซ้ำ</legend>
            <p className="text-xs text-muted-foreground">
              ใช้เมื่อคนเดียวกันมี 2 รายชื่อ (เช่น สะกดชื่อในชีตต่างกัน) — ย้ายคิวทั้งหมดของ {displayName(person)} ไปเป็นของรายชื่อที่เลือก แล้วลบ {displayName(person)}
              {twin ? <span className="font-semibold text-warning-foreground"> · เบอร์เดียวกับ {displayName(twin)}</span> : null}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={mergeTo} onValueChange={(v) => { setMergeTo(v); setMergeInfo(null); }}>
                <SelectTrigger aria-label="รวมเข้ากับ" className="min-w-48 flex-1"><SelectValue placeholder="เลือกรายชื่อที่จะเก็บไว้" /></SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                  {[...others].sort((a, b) => a.name.localeCompare(b.name, "th")).map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>{displayName(o)}{o.email ? "" : " (ไม่มีอีเมล)"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" disabled={saving || !mergeTo} onClick={checkMerge}>ตรวจก่อนรวม</Button>
            </div>
            {mergeInfo ? (
              <div className="space-y-1 rounded-lg bg-secondary p-2.5 text-xs">
                <p>ย้าย <b>{mergeInfo.total}</b> คิว (ตั้งแต่วันนี้ {mergeInfo.upcoming} คิว) จาก {mergeInfo.source} ไปเป็นของ <b>{mergeInfo.target}</b></p>
                {mergeInfo.moveEmail ? <p>อีเมล {mergeInfo.moveEmail} จะย้ายไปที่ {mergeInfo.target} (ตอนนี้ยังไม่มีอีเมล)</p> : null}
                {mergeInfo.movePhone ? <p>เบอร์ {mergeInfo.movePhone} จะย้ายไปที่ {mergeInfo.target}</p> : null}
                {mergeInfo.conflicts ? <p className="font-semibold text-destructive">มี {mergeInfo.conflicts} คิวที่เวลาชนกับคิวเดิมของ {mergeInfo.target} ตรวจที่หน้าจัดการ slot หลังรวม</p> : null}
                <Button size="sm" variant="destructive" className="mt-1" disabled={saving} onClick={doMerge}>รวมเข้ากับ {mergeInfo.target}</Button>
              </div>
            ) : null}
          </fieldset>
        ) : null}
      </DialogBody>

      <DialogActions>
        {person && !isMe ? (
          <Button variant="destructive" size="lg" onClick={remove} disabled={saving} className="mr-auto">ลบคนนี้</Button>
        ) : null}
        <Button variant="outline" size="lg" disabled={saving} onClick={() => onClose()}>ยกเลิก</Button>
        <Button size="lg" disabled={saving || !name.trim() || noScope || (role === "owner" && !isMe && anyView && !viewReady)} onClick={save}>
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
