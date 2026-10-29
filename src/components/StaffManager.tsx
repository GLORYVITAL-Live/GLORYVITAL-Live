"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { BellRingIcon, CalendarXIcon, CopyIcon, IdCardIcon, MailIcon, PlusIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react";
import { copyText } from "@/components/CalendarGuide";
import { PayDocsPanel } from "@/components/PayDocs";
import { CALENDAR_SHARE_TO, calendarShareMessage } from "@/lib/calendar-share";
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
import { fmtMonthShort, money, monthKey } from "@/lib/format";
import { parseTierHours, tiersLabel } from "@/lib/pay";
import { liveTeamLabel, type LiveTeam } from "@/lib/live-team";
import { isTestAccount } from "@/lib/staff-check";
import type { CommitTier, OwnerScope } from "@/lib/types";

// borrower = บัญชีทีมอื่นในบริษัท เห็นแค่หน้าขอยืมอุปกรณ์
type Role = "mc" | "admin" | "owner" | "marketing" | "borrower";

/** ข้อความวิธีเปิดแจ้งเตือนในมือถือ (คัดลอกส่ง LINE) */
const pushHowTo = (site: string) => `📢 เปิดแจ้งเตือนเว็บ GLORY VITAL Live ในมือถือ (ทำครั้งเดียว)
จะเตือน: คืนก่อนวันไลฟ์ · ก่อนไลฟ์ ~1 ชม. · มี slot ว่าง / slot ใหม่ · คิวของเราถูกเปลี่ยน · หลักฐาน / GMV ที่ยังค้าง

Android: เปิด ${site} ใน Chrome → เข้าสู่ระบบ → กด 🔔 มุมขวาบน → "เปิดแจ้งเตือน" → อนุญาต
iPhone: เปิดใน Safari → ปุ่มแชร์ → "เพิ่มไปยังหน้าจอโฮม" → เปิดเว็บจากไอคอนนั้น → เข้าสู่ระบบ → 🔔 → "เปิดแจ้งเตือน" → อนุญาต

กด "ทดสอบ" ได้ ถ้ามีแจ้งเตือนเด้งขึ้น = ใช้ได้แล้ว ✅`;
/** ค่าจ้าง/ชม. เกินเท่านี้ = ถามยืนยันก่อนบันทึก */
const RATE_ALERT = 5000;
/** Mc / Admin = มีคิว ค่าจ้าง ปฏิทิน (Owner / Marketing ไม่มี) */
const isCrew = (role: Role) => role === "mc" || role === "admin";
type Person = {
  id: number; role: Role; name: string; email: string | null; phone: string | null;
  hourly_rate: number | null; is_extra_admin: boolean; is_salaried: boolean; upcoming: number;
  commit_tiers: CommitTier[] | null;
  can_manage_mc: boolean; can_manage_admin: boolean; can_manage_proofs: boolean; can_view_analytics: boolean;
  can_plan_slots?: boolean; // ไม่มี = ยังไม่ได้รัน SQL 20261017000000_plan_slots
  // ดูได้อย่างเดียว (ไม่มี = ยังไม่ได้รัน SQL 20261018000000_view_only)
  can_view_mc?: boolean; can_view_admin?: boolean; can_view_proofs?: boolean; can_view_plan?: boolean; analytics_readonly?: boolean;
  // รับอีเมลแจ้งเมื่อ Mc / Admin เสริมกดยกเลิกคิว (ไม่มี = ยังไม่ได้รัน SQL 20261020000000_notify_cancel)
  notify_cancel_mc?: boolean; notify_cancel_admin?: boolean;
  /** คิวข้างหน้าที่ยังไม่ขึ้นปฏิทิน (ส่วนใหญ่ = ยังไม่แชร์ปฏิทินให้บัญชีระบบ) */
  calendarMissing?: number;
  /** เปิดแจ้งเตือนเด้งไว้กี่เครื่อง (ไม่มี = ไม่มีอีเมล / ยังไม่ได้รัน SQL 20261028000000_notifications) */
  pushDevices?: number;
  /** Admin: เข้าหน้าอุปกรณ์โปรดักชั่นได้ (ไม่มี = ยังไม่ได้รัน SQL 20261025000000_equipment) */
  can_manage_equipment?: boolean;
  /** Admin: จัดการบรีฟการแต่งตัว (เทรนนิ่ง > เฟรมไลฟ์ · ไม่มี = ยังไม่ได้รัน SQL 20261113000000_live_frames) */
  can_manage_briefs?: boolean;
  /** Mc / Admin: ทีมไลฟ์ (ไม่มี = ยังไม่ได้รัน SQL 20261031000000_live_platform ทุกคนเป็น TikTok) */
  live_platform?: LiveTeam;
  /** Mc: ค่าจ้าง Shopee/ชม. (null = เท่ากับ TikTok · ไม่มี = ยังไม่ได้รัน SQL 20261116000000_shopee_rate / ดูได้อย่างเดียว) */
  shopee_rate?: number | null;
  /** เอกสารทำเบิก (เฉพาะ Owner ที่ดูได้): ok = ส่งในเว็บแล้ว / drive = มีเอกสารเดิมใน Drive / missing = ต้องส่งแต่ยังไม่มี / ไม่มี = ไม่ต้องส่ง */
  payDocs?: "ok" | "drive" | "missing";
  /** Owner: ดูเอกสาร (ทำเบิก / ใบ 50 ทวิ / รับเงิน) ฝั่ง Mc / ฝั่ง Admin (ส่งมาเฉพาะตอนคนที่เปิดดูมีสิทธิ์ดูเอกสาร · ไม่มีฝั่ง Admin = ยังไม่ได้รัน SQL) */
  can_view_pay_docs?: boolean;
  can_view_pay_docs_admin?: boolean;
  /** Owner: ตั้งสิทธิ์จอง Mc ต่อเดือน (เพิ่มพิเศษ / เปิดปิด) ได้ (ไม่มี = ยังไม่ได้รัน SQL 20261107000000_mc_quota) */
  can_manage_quota?: boolean;
  /** ทีมอื่น: ชื่อทีม / แผนก (ไม่มี = ยังไม่ได้รัน SQL 20261110000000_equipment_loans) */
  team_name?: string;
};
type StaffData = {
  staff: Person[]; meId: number | null; canEdit?: Record<Role, boolean>; payDocsViewer?: boolean;
  /** ฝั่งที่คนที่เปิดดูเอกสารได้ (Mc / Admin) */
  docsScope?: { mc: boolean; admin: boolean };
  /** ลบรายชื่อ Mc / Admin ได้ (เฉพาะเจ้าของระบบ — ตั้งด้วย SQL) */
  canDeleteCrew?: boolean;
};

const ROLE_LABEL: Record<Role, string> = { mc: "Mc", admin: "Admin", owner: "Owner", marketing: "Marketing", borrower: "ทีมอื่น" };
const displayName = (p: Pick<Person, "role" | "name">) => (p.role === "mc" ? `Mc ${p.name}` : p.name);
/** บทบาทที่ Owner คนนี้เปิดดูได้ (รายชื่อ Owner / Marketing = ต้องมีสิทธิ์ทั้ง Mc และ Admin) */
const rolesOf = (scope: OwnerScope): Role[] =>
  [...(scope.mc ? ["mc" as const] : []), ...(scope.admin ? ["admin" as const] : []), ...(scope.mc && scope.admin ? ["owner" as const, "marketing" as const, "borrower" as const] : [])];
const phoneDigits = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "");

// ---------- รายชื่อที่น่าจะซ้ำ (Mc / Admin) ----------

const PREFIX = /^(mc|admin|แอดมิน)\s*/i;
/** ชื่อสำหรับเทียบ: ตัดคำนำหน้า Mc / Admin / แอดมิน + ช่องว่าง / จุด / ขีด + ตัวการันต์ เช่น "Admin ปัน" = "ปัน", "มายด์" = "มาย"
 *  (ตัวเลขท้ายชื่อไม่ตัด "มะนาว2" ≠ "มะนาว") */
const nameKey = (n: string) => n.toLowerCase().replace(PREFIX, "").replace(/[\s.\-_()]/g, "").replace(/[ก-ฮ][ิุ]?์/g, "");
type DupGroup = { people: Person[]; samePhone: boolean; sameName: boolean; emails: string[] };
/** กลุ่มรายชื่อบทบาทเดียวกันที่เบอร์เดียวกัน หรือชื่อเดียวกัน (ต่อกันเป็นกลุ่มได้หลายคน) */
function dupGroups(staff: Person[]): DupGroup[] {
  const people = staff.filter((p) => isCrew(p.role));
  const parent = new Map(people.map((p) => [p.id, p.id]));
  const find = (id: number): number => (parent.get(id) === id ? id : find(parent.get(id)!));
  const first = new Map<string, number>();
  for (const p of people) {
    const keys = [`${p.role}|n|${nameKey(p.name)}`, ...(phoneDigits(p.phone).length >= 9 ? [`${p.role}|t|${phoneDigits(p.phone)}`] : [])];
    for (const k of keys) {
      const other = first.get(k);
      if (other === undefined) first.set(k, p.id);
      else parent.set(find(p.id), find(other));
    }
  }
  const byRoot = new Map<number, Person[]>();
  for (const p of people) byRoot.set(find(p.id), [...(byRoot.get(find(p.id)) ?? []), p]);
  return [...byRoot.values()].filter((g) => g.length > 1).map((g) => {
    const phones = new Set(g.map((p) => phoneDigits(p.phone)).filter((d) => d.length >= 9));
    return {
      people: g,
      samePhone: phones.size > 0 && g.filter((p) => phoneDigits(p.phone).length >= 9).length > phones.size,
      sameName: new Set(g.map((p) => nameKey(p.name))).size < g.length,
      emails: [...new Set(g.map((p) => p.email).filter((e): e is string => !!e))],
    };
  });
}
/** คนที่ควรเก็บไว้: มีอีเมล > คิวข้างหน้ามากกว่า > ชื่อไม่มีคำนำหน้า > เพิ่มก่อน */
const keepOf = (g: Person[]) => [...g].sort((a, b) =>
  Number(!!b.email) - Number(!!a.email) || b.upcoming - a.upcoming
  || Number(PREFIX.test(a.name)) - Number(PREFIX.test(b.name))
  || a.id - b.id)[0];

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
  const canEditRole = (r: Role) => !!data && (data.canEdit ? !!data.canEdit[r] : isCrew(r) || (scope.mc && scope.admin));
  const roles = rolesOf(scope).filter((r) => isCrew(r) || canEditRole(r));
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
    const c = { mc: 0, admin: 0, owner: 0, marketing: 0, borrower: 0, noEmail: 0 };
    for (const p of data?.staff ?? []) {
      if (p.role in c) c[p.role]++;
      if (p.role === role && !p.email) c.noEmail++;
    }
    return c;
  }, [data, role]);

  // รายชื่อที่น่าจะซ้ำ (เบอร์เดียวกัน / ชื่อเดียวกันเมื่อตัด Mc / Admin) = อาจลงชื่อซ้ำ
  const dups = useMemo(() => dupGroups(data?.staff ?? []), [data]);
  const dupOf = useMemo(() => new Map(dups.flatMap((g) => g.people.map((p) => [p.id, g] as const))), [dups]);
  const roleDups = dups.filter((g) => g.people[0].role === role);
  // คนในบทบาทนี้ที่คิวข้างหน้ายังไม่ขึ้นปฏิทิน (มากไปน้อย)
  const noCalendar = (data?.staff ?? []).filter((p) => p.role === role && p.calendarMissing)
    .sort((a, b) => (b.calendarMissing ?? 0) - (a.calendarMissing ?? 0));
  // แจ้งเตือนเด้งในมือถือ: คนในบทบาทนี้ที่มีอีเมล เปิดแล้ว / ยังไม่เปิด
  const pushPeople = (data?.staff ?? []).filter((p) => p.role === role && p.pushDevices !== undefined);
  const pushOff = pushPeople.filter((p) => !p.pushDevices);
  // เอกสารทำเบิก (เห็นเฉพาะ Owner ที่ดูเอกสารได้): คนใหม่ที่ยังไม่ส่ง + จำนวนที่มีแล้ว
  // เอกสาร (ทำเบิก / ใบ 50 ทวิ / รับเงิน) ของแท็บนี้: เฉพาะฝั่งที่ดูเอกสารได้
  const docsSide = isCrew(role) && (data?.docsScope ? data.docsScope[role as "mc" | "admin"] : !!data?.payDocsViewer);
  const noPayDocs = (data?.staff ?? []).filter((p) => p.role === role && p.payDocs === "missing");
  const payDocsCount = {
    ok: (data?.staff ?? []).filter((p) => p.role === role && p.payDocs === "ok").length,
    drive: (data?.staff ?? []).filter((p) => p.role === role && p.payDocs === "drive").length,
  };
  const [scanning, setScanning] = useState(false);
  /** จับคู่รายชื่อกับโฟลเดอร์เอกสารเดิมใน Drive ตามชื่อ ("Mc มะนาว" = มะนาว) */
  async function scanDrive() {
    setScanning(true);
    try {
      const res = await api<{ linked: string[]; unmatched: string[] }>("/api/owner/pay-docs/scan", {});
      if (!res.ok) throw new Error(res.message);
      toast(`${res.linked.length ? `ผูกโฟลเดอร์ใหม่ ${res.linked.length} คน` : "ไม่มีคนที่ผูกใหม่"}${res.unmatched.length ? ` · ยังไม่เจอใน Drive: ${res.unmatched.join(", ")}` : ""}`);
      reload();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setScanning(false);
    }
  }

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
          className="no-scrollbar max-w-full overflow-x-auto bg-card"
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

      {roleDups.length && canEditRole(role) ? (
        <DuplicatePanel key={role} role={role as "mc" | "admin"} groups={roleDups} onMerged={(msg) => { toast(msg); reload(); }} />
      ) : null}

      {noCalendar.length ? (
        <div className="my-2 flex flex-wrap items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
          <span className="min-w-56 flex-1 leading-snug">
            <b>{ROLE_LABEL[role]} {noCalendar.length} คน ปฏิทินยังไม่แชร์</b> — รวม {noCalendar.reduce((a, p) => a + (p.calendarMissing ?? 0), 0)} คิวไม่ขึ้นใน Google Calendar
            <span className="block text-xs text-muted-foreground">{noCalendar.map((p) => `${displayName(p)} (${p.calendarMissing})`).join(", ")}</span>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="bg-card"
            onClick={async () => {
              if (await copyText(calendarShareMessage(location.origin))) toast("คัดลอกข้อความแล้ว วางส่งใน LINE ได้เลย");
              else toast("คัดลอกไม่ได้", "error");
            }}
          >
            <CopyIcon />คัดลอกวิธีแชร์ (ส่ง LINE)
          </Button>
          <Button size="sm" variant="outline" className="bg-card" asChild>
            <Link href="/guide#calendar" target="_blank">ดูคู่มือ</Link>
          </Button>
        </div>
      ) : null}

      {pushPeople.length ? (
        <div className="my-2 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm leading-snug">
          <BellRingIcon className={cn("size-4 shrink-0", pushOff.length ? "text-muted-foreground" : "text-success")} />
          <span className="min-w-56 flex-1">
            แจ้งเตือนในมือถือ {ROLE_LABEL[role]}: <b>เปิดแล้ว {pushPeople.length - pushOff.length} / {pushPeople.length} คน</b>
            {pushOff.length ? <span className="block text-xs text-muted-foreground">ยังไม่เปิด: {pushOff.map(displayName).join(", ")}</span> : null}
          </span>
          {pushOff.length ? (
            <Button
              size="sm" variant="outline" className="bg-card"
              onClick={async () => {
                if (await copyText(pushHowTo(location.origin))) toast("คัดลอกข้อความแล้ว วางส่งใน LINE ได้เลย");
                else toast("คัดลอกไม่ได้", "error");
              }}
            >
              <CopyIcon />คัดลอกวิธีเปิด (ส่ง LINE)
            </Button>
          ) : null}
        </div>
      ) : null}

      {docsSide ? (
        <div
          className={cn(
            "my-2 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm leading-snug",
            noPayDocs.length ? "border-warning-border bg-warning text-warning-foreground" : "bg-card",
          )}
        >
          <IdCardIcon className="size-4 shrink-0" />
          <span className="min-w-56 flex-1">
            {noPayDocs.length ? (
              <>
                <b>{ROLE_LABEL[role]} {noPayDocs.length} คน ยังไม่ส่งเอกสารทำเบิก</b> — {noPayDocs.map(displayName).join(", ")}
                <span className="block text-xs">คนนั้นเห็นป้ายเตือนในหน้าจองคิว · มีเอกสารใน Drive แล้ว = กดชื่อ &gt; ผูกกับโฟลเดอร์ หรือตั้งชื่อโฟลเดอร์ให้ตรงแล้วกดตรวจ</span>
              </>
            ) : (
              <>
                เอกสารทำเบิก {ROLE_LABEL[role]}: ส่งในเว็บ {payDocsCount.ok} · มีใน Drive {payDocsCount.drive} คน
                <span className="block text-xs text-muted-foreground">ป้ายเตือนขึ้นเฉพาะคนที่เพิ่มใหม่และยังไม่มีเอกสาร (ไม่นับพนักงานประจำ)</span>
              </>
            )}
          </span>
          <Button size="sm" variant="outline" className="bg-card" disabled={scanning} onClick={scanDrive}>
            <RefreshCwIcon className={cn(scanning && "animate-spin")} />{scanning ? "กำลังตรวจ..." : "ตรวจเอกสารใน Drive"}
          </Button>
        </div>
      ) : null}
      {/* ใบ 50 ทวิ / เอกสารรับเงินรายเดือน ย้ายไปอยู่หน้าเจ้าของ > สรุปรายเดือน (คู่กับค่าจ้าง / บันทึกโอน) */}

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
                  {isCrew(p.role) && isTestAccount(p.name) ? (
                    <Badge variant="outline" className="text-[11px] text-muted-foreground" title="ชื่อมีคำว่า ทดสอบ / test — ไม่นับในสรุปรายเดือนและไฟล์เบิก">
                      บัญชีทดสอบ
                    </Badge>
                  ) : null}
                  {p.is_extra_admin ? <Badge className="bg-p2/15 text-[11px] text-p2">Admin เสริม</Badge> : null}
                  {p.is_salaried ? <Badge className="bg-p2/15 text-[11px] text-p2">{p.role === "mc" ? "Mc" : "Admin"} ประจำ</Badge> : null}
                  {p.can_manage_equipment ? <Badge className="bg-p2/15 text-[11px] text-p2">อุปกรณ์</Badge> : null}
                  {p.can_manage_briefs ? <Badge className="bg-p2/15 text-[11px] text-p2">บรีฟแต่งตัว</Badge> : null}
                  {p.role === "borrower" && p.team_name ? <Badge variant="outline" className="text-[11px] text-muted-foreground">{p.team_name}</Badge> : null}
                  {p.live_platform === "shopee" || p.live_platform === "both" ? (
                    <Badge
                      className="bg-p1/15 text-[11px] text-p1"
                      title={p.live_platform === "both" ? "ทีม TikTok + Shopee — จองได้ทั้งคิว TikTok และคิว Shopee" : "ทีม Shopee — เห็น / จองเฉพาะคิว Shopee"}
                    >
                      {liveTeamLabel(p.live_platform)}
                    </Badge>
                  ) : null}
                  {p.role === "owner" ? permBadges(p).map((b) => (
                    <Badge key={b} className={cn("text-[11px]", b.startsWith("ดู") ? "bg-muted text-muted-foreground" : "bg-p2/15 text-p2")}>{b}</Badge>
                  )) : null}
                  {p.role === "owner" && (p.notify_cancel_mc || p.notify_cancel_admin) ? (
                    <Badge variant="outline" className="text-[11px] text-muted-foreground" title="รับอีเมลเมื่อมีคนกดยกเลิกคิวผ่านเว็บ">
                      <MailIcon />แจ้งยกเลิก {[p.notify_cancel_mc ? "Mc" : "", p.notify_cancel_admin ? "Admin" : ""].filter(Boolean).join(" + ")}
                    </Badge>
                  ) : null}
                  {p.id === data.meId ? <Badge variant="secondary" className="text-[11px]">คุณ</Badge> : null}
                  {p.pushDevices ? (
                    <Badge className="bg-success/15 text-[11px] text-success" title={`เปิดแจ้งเตือนเด้งไว้ ${p.pushDevices} เครื่อง`}>
                      <BellRingIcon />แจ้งเตือน
                    </Badge>
                  ) : null}
                  {p.calendarMissing ? (
                    <Badge
                      className="bg-destructive/10 text-[11px] text-destructive"
                      title={`คิวข้างหน้า ${p.calendarMissing} คิวยังไม่ขึ้นใน Google Calendar ของคนนี้ — ส่วนใหญ่เพราะยังไม่ได้แชร์ปฏิทินให้ ${CALENDAR_SHARE_TO}`}
                    >
                      <CalendarXIcon />ปฏิทินยังไม่แชร์ · {p.calendarMissing} คิว
                    </Badge>
                  ) : null}
                  {p.payDocs === "missing" ? (
                    <Badge className="border-warning-border bg-warning text-[11px] text-warning-foreground" title="เพิ่มเข้าระบบหลังเปิดฟีเจอร์เอกสารทำเบิก ยังไม่ได้ส่งบัตรประชาชน / สมุดบัญชี">
                      <IdCardIcon />ยังไม่ส่งเอกสารทำเบิก
                    </Badge>
                  ) : p.payDocs === "ok" ? (
                    <Badge variant="outline" className="text-[11px] text-muted-foreground" title="ส่งเอกสารทำเบิกในเว็บแล้ว กดที่รายชื่อเพื่อดู">
                      <IdCardIcon />เอกสารทำเบิก ✓
                    </Badge>
                  ) : p.payDocs === "drive" ? (
                    <Badge variant="outline" className="text-[11px] text-muted-foreground" title="มีเอกสารเดิมใน Google Drive (ส่งทาง LINE) กดที่รายชื่อเพื่อเปิดโฟลเดอร์">
                      <IdCardIcon />เอกสารใน Drive ✓
                    </Badge>
                  ) : null}
                  {dupOf.has(p.id) ? (
                    <Badge
                      className="border-warning-border bg-warning text-[11px] text-warning-foreground"
                      title={`${dupOf.get(p.id)!.samePhone ? "เบอร์เดียวกับ" : "ชื่อเดียวกับ"} ${dupOf.get(p.id)!.people.filter((x) => x.id !== p.id).map(displayName).join(", ")} — รวมได้ที่กล่อง "รายชื่อที่น่าจะซ้ำ" ด้านบน`}
                    >
                      {dupOf.get(p.id)!.samePhone ? "เบอร์ซ้ำ" : "ชื่อซ้ำ"}
                    </Badge>
                  ) : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {p.email ?? <span className="font-semibold text-destructive">ไม่มีอีเมล</span>}
                  {p.phone ? ` · ${p.phone}` : ""}
                  {p.hourly_rate ? ` · ${money(p.hourly_rate)} บาท/ชม.` : ""}
                  {p.shopee_rate ? ` · Shopee ${money(p.shopee_rate)} บาท/ชม.` : ""}
                  {p.commit_tiers?.length ? ` · Commit ${tiersLabel(0, p.commit_tiers)}` : ""}
                </span>
              </span>
              {isCrew(p.role) ? (
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
          canDelete={editing !== "new" && (!isCrew(editing.role) || !!data.canDeleteCrew)}
          canGrantPlan={canGrantPlan && data.staff.some((p) => p.can_plan_slots !== undefined)}
          viewReady={data.staff.some((p) => p.can_view_mc !== undefined)}
          notifyReady={data.staff.some((p) => p.notify_cancel_mc !== undefined)}
          teamReady={data.staff.some((p) => p.live_platform !== undefined)}
          docsScope={data.docsScope ?? { mc: !!data.payDocsViewer, admin: !!data.payDocsViewer }}
          docsAdminReady={data.staff.some((p) => p.can_view_pay_docs_admin !== undefined)}
          quotaReady={data.staff.some((p) => p.can_manage_quota !== undefined)}
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

/**
 * กล่อง "รายชื่อที่น่าจะซ้ำ" (บทบาทที่เลือกอยู่): เลือกคนที่เก็บไว้ แล้วรวมคนอื่นในกลุ่มเข้าไป
 *   ย้ายคิวทั้งหมด (ชีต + ปฏิทินตามให้) แล้วลบรายชื่อซ้ำ · ตรวจก่อนทุกครั้ง (กี่คิว / เวลาชน / อีเมล เบอร์ที่ย้าย)
 *   อีเมลคนละอัน = อาจเป็นคนละคน รวมไม่ได้ (ต้องลบอีเมลของรายชื่อที่ไม่ใช้ก่อน)
 */
function DuplicatePanel({ role, groups, onMerged }: { role: "mc" | "admin"; groups: DupGroup[]; onMerged: (message: string) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const keyOf = (g: DupGroup) => g.people.map((p) => p.id).sort((a, b) => a - b).join("-");
  const targetOf = (g: DupGroup) => g.people.find((p) => p.id === keep[keyOf(g)]) ?? keepOf(g.people);

  async function merge(g: DupGroup) {
    const k = keyOf(g), target = targetOf(g);
    const sources = g.people.filter((p) => p.id !== target.id);
    setBusy(k);
    try {
      const sums: MergeSummary[] = [];
      for (const s of sources) {
        const res = await api<{ summary: MergeSummary }>("/api/owner/staff/merge", { sourceId: s.id, targetId: target.id, dryRun: true });
        if (!res.ok) throw new Error(res.message);
        sums.push(res.summary);
      }
      const ok = await confirm({
        title: `รวมเป็น ${displayName(target)}?`,
        description: (
          <span className="block space-y-1">
            {sums.map((x) => (
              <span key={x.source} className="block">
                ย้าย <b>{x.total}</b> คิวของ {x.source} (ตั้งแต่วันนี้ {x.upcoming} คิว) ไปเป็นของ {x.target} แล้วลบ {x.source}
                {x.moveEmail ? ` · ย้ายอีเมล ${x.moveEmail}` : ""}{x.movePhone ? ` · ย้ายเบอร์ ${x.movePhone}` : ""}
                {x.conflicts ? <b className="text-destructive"> · มี {x.conflicts} คิวเวลาชนกัน ตรวจที่ตาราง slot หลังรวม</b> : null}
              </span>
            ))}
            <span className="block">ชีตและปฏิทินอัปเดตตามให้ — ย้อนกลับไม่ได้</span>
          </span>
        ),
        confirmText: "รวมรายชื่อ",
        destructive: true,
      });
      if (!ok) return;
      for (const s of sources) {
        const res = await api<{ message: string }>("/api/owner/staff/merge", { sourceId: s.id, targetId: target.id });
        if (!res.ok) throw new Error(res.message);
      }
      onMerged(`รวม ${sources.map(displayName).join(", ")} เข้ากับ ${displayName(target)} แล้ว`);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="my-2 rounded-xl border border-warning-border bg-warning text-warning-foreground">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex-1">
          <b>รายชื่อ {ROLE_LABEL[role]} ที่น่าจะซ้ำ {groups.length} กลุ่ม</b> — เบอร์เดียวกัน หรือชื่อเดียวกัน (เช่น &quot;ปัน&quot; กับ &quot;Admin ปัน&quot;)
        </span>
        <span className="shrink-0 text-xs font-semibold underline">{open ? "ซ่อน" : "ดู / รวมรายชื่อ"}</span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-warning-border p-2">
          {groups.map((g) => {
            const k = keyOf(g), target = targetOf(g);
            // อีเมลคนละอัน: ถ้ารวม อีเมลของคนที่ถูกลบจะหาย (login ไม่ได้) จึงไม่ให้รวมจากตรงนี้
            const twoEmails = g.emails.length > 1;
            return (
              <div key={k} className="rounded-lg border bg-card p-2.5 text-sm text-foreground">
                <div className="mb-1.5 text-xs text-muted-foreground">
                  {[g.samePhone ? "เบอร์เดียวกัน" : "", g.sameName ? "ชื่อเดียวกัน" : ""].filter(Boolean).join(" + ")} · เลือกรายชื่อที่จะเก็บไว้
                </div>
                <div role="radiogroup" aria-label="รายชื่อที่จะเก็บไว้" className="space-y-1">
                  {g.people.map((p) => (
                    <label key={p.id} className={cn("flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1", p.id === target.id && "bg-secondary")}>
                      <input
                        type="radio"
                        name={`keep-${k}`}
                        checked={p.id === target.id}
                        disabled={!!busy}
                        onChange={() => setKeep({ ...keep, [k]: p.id })}
                        className="mt-1 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold">{displayName(p)}</span>
                        {p.id === target.id ? <Badge variant="secondary" className="ml-1.5 text-[11px]">เก็บไว้</Badge> : null}
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.email ?? "ไม่มีอีเมล"} · {p.phone || "ไม่มีเบอร์"} · {p.upcoming ? `คิวข้างหน้า ${p.upcoming}` : "ไม่มีคิวข้างหน้า"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {twoEmails ? (
                  <p className="mt-1.5 text-xs text-destructive">
                    อีเมลคนละอัน ({g.emails.join(" / ")}) อาจเป็นคนละคน — ถ้าเป็นคนเดียวกันจริง ลบอีเมลของรายชื่อที่ไม่ใช้ก่อน แล้วค่อยรวม
                  </p>
                ) : (
                  <div className="mt-1.5 flex justify-end">
                    <Button size="sm" variant="destructive" disabled={!!busy} onClick={() => merge(g)}>
                      {busy === k ? "กำลังรวม..." : `รวมเป็น ${displayName(target)}`}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function EditDialog({ person, roles, defaultRole, isMe, canDelete, canGrantPlan, viewReady, notifyReady, teamReady, docsScope, docsAdminReady, quotaReady, others, onClose }: {
  person: Person | null;
  /** แสดงปุ่มลบคนนี้ (Mc / Admin = เฉพาะเจ้าของระบบ) */
  canDelete: boolean;
  /** รัน SQL 20261107000000_mc_quota แล้ว (มีคอลัมน์กำหนดสิทธิ์จอง Mc) */
  quotaReady: boolean;
  roles: Role[];
  defaultRole: Role;
  isMe: boolean;
  canGrantPlan: boolean;
  /** ฝั่งที่ Owner ที่ใช้อยู่ดูเอกสารได้ (Mc / Admin) */
  docsScope: { mc: boolean; admin: boolean };
  /** รัน SQL 20261106000000_pay_docs_admin แล้ว (สิทธิ์ดูเอกสารฝั่ง Admin แยก) */
  docsAdminReady: boolean;
  /** รัน SQL 20261018000000_view_only แล้ว (มีคอลัมน์สิทธิ์ดูได้อย่างเดียว) */
  viewReady: boolean;
  /** รัน SQL 20261020000000_notify_cancel แล้ว (มีคอลัมน์รับอีเมลแจ้งยกเลิก) */
  notifyReady: boolean;
  /** รัน SQL 20261031000000_live_platform แล้ว (มีคอลัมน์ทีมไลฟ์) */
  teamReady: boolean;
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
  // ทีมอื่น: ชื่อทีม / แผนก
  const [team, setTeam] = useState(person?.team_name ?? "");
  const [rate, setRate] = useState(person?.hourly_rate != null ? String(person.hourly_rate) : "");
  // ค่าจ้าง Shopee (Mc ทีม Shopee / TikTok + Shopee) ว่าง = เท่ากับ TikTok
  const [shopeeRate, setShopeeRate] = useState(person?.shopee_rate ? String(person.shopee_rate) : "");
  const [extra, setExtra] = useState(person?.is_extra_admin ?? false);
  const [salaried, setSalaried] = useState(person?.is_salaried ?? false);
  // Admin ประจำ: เข้าหน้าอุปกรณ์โปรดักชั่น (ส่งเมื่อรัน SQL แล้ว = มีค่ามากับรายชื่อ หรือเพิ่มคนใหม่)
  const [equipment, setEquipment] = useState(person?.can_manage_equipment ?? false);
  const equipReady = person ? person.can_manage_equipment !== undefined : true;
  // Admin (ประจำ / เสริม): จัดการบรีฟการแต่งตัว (เทรนนิ่ง > เฟรมไลฟ์) — ส่งเมื่อรัน SQL แล้ว หรือติ๊กไว้ (ยังไม่รัน = เซิร์ฟเวอร์แจ้งให้รันก่อน)
  const [briefs, setBriefs] = useState(person?.can_manage_briefs ?? false);
  const briefsReady = person ? person.can_manage_briefs !== undefined : true;
  // ทีมไลฟ์: ติ๊ก TikTok / Shopee (ติ๊กทั้งคู่ = จองได้ทั้งสองหน้า · ต้องติ๊กอย่างน้อยหนึ่งอย่าง)
  const [tiktok, setTiktok] = useState(person?.live_platform !== "shopee");
  const [shopee, setShopee] = useState(person?.live_platform === "shopee" || person?.live_platform === "both");
  const liveTeam: LiveTeam = tiktok && shopee ? "both" : shopee ? "shopee" : "tiktok";
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
  // ดูเอกสาร (ทำเบิก / ใบ 50 ทวิ / รับเงิน) แยกฝั่ง: ตั้งได้เฉพาะคนที่ดูเอกสารได้ทั้งสองฝั่ง (คนที่ได้ฝั่งเดียวไม่เห็นช่องนี้) · ของตัวเองแก้ไม่ได้
  const [docs, setDocs] = useState({ mc: person?.can_view_pay_docs ?? false, admin: person?.can_view_pay_docs_admin ?? false });
  const payDocsViewer = docsScope.mc && docsScope.admin;
  // กำหนดสิทธิ์จอง Mc ต่อเดือน (ตาราง slot > รายวัน ใต้ช่วงเปิดจอง) — Owner ที่จัดการได้ทั้ง Mc + Admin ได้อยู่แล้ว
  const [quota, setQuota] = useState(person?.can_manage_quota ?? false);
  const fullPerm = perm.mc === "edit" && perm.admin === "edit";
  // ฝั่ง Mc ครอบหลักฐานไลฟ์อยู่แล้ว (จัดการ Mc = จัดการหลักฐานได้ / ดู Mc = ดูหลักฐานได้)
  const proofsLevel: Level = RANK[perm.mc] > RANK[perm.proofs] ? perm.mc : perm.proofs;
  const [saving, setSaving] = useState(false);
  // เปลี่ยนเรท / Commit / พนักงานประจำ: เลือกเดือนที่เริ่มใช้ (เดือนก่อนหน้านั้นคิดเรทเดิม — server ล็อกไว้)
  const thisMonth = monthKey();
  const [rateFrom, setRateFrom] = useState(thisMonth);
  const tierKey = (list: CommitTier[]) => JSON.stringify([...list].sort((a, b) => a.hours - b.hours).map((t) => [t.hours, Number(t.rate)]));
  // ช่องค่าจ้าง Shopee: Mc ที่ติ๊กทีม Shopee · มีค่าเดิมอยู่แล้วก็แสดง (เอาออกได้)
  const showShopeeRate = role === "mc" && (shopee || !!person?.shopee_rate);
  const shopeeDirty = showShopeeRate && (Number(shopeeRate.replace(/[,\s]/g, "")) || null) !== (Number(person?.shopee_rate) || null);
  const rateDirty = !!person && isCrew(role) && (
    (Number(rate.replace(/[,\s]/g, "")) || null) !== (Number(person.hourly_rate) || null)
    || tierKey(filledTiers) !== tierKey(person.commit_tiers ?? [])
    || salaried !== person.is_salaried
    || shopeeDirty);
  // เอาอีเมลออกทั้งที่ยังมีคิวข้างหน้า = เข้าเว็บไม่ได้แต่คิวยังอยู่ในชื่อ → เลือกปล่อยคิวพร้อมบันทึกได้
  const emailCleared = !!person?.email && !email.trim() && isCrew(role) && person.upcoming > 0;
  const [releaseOnSave, setReleaseOnSave] = useState(false);

  const emailChanged = (person?.email ?? "") !== email.trim().toLowerCase();
  const renamed = !!person && person.name !== name.trim().replace(/^mc\s*/i, "");
  const noScope = role === "owner" && Object.values(perm).every((l) => l === "none");
  const anyView = Object.values(perm).some((l) => l === "view");
  // รับอีเมลแจ้งยกเลิกคิว: ได้เฉพาะฝั่งที่มีสิทธิ์ (ดูได้ / จัดการได้) และต้องมีอีเมล
  const [notify, setNotify] = useState({ mc: person?.notify_cancel_mc ?? false, admin: person?.notify_cancel_admin ?? false });
  const notifyOn = { mc: notify.mc && perm.mc !== "none", admin: notify.admin && perm.admin !== "none" };
  const anyNotify = notifyOn.mc || notifyOn.admin;

  async function save() {
    // ค่าจ้าง/ชม. สูงผิดปกติ (พิมพ์ 0 เกิน / ใส่ค่าจ้างทั้งวันหรือทั้งเดือน) ถามก่อนบันทึก — เฉพาะค่าที่เพิ่งพิมพ์ใหม่
    if (isCrew(role) && !salaried) {
      const saved = new Set([Number(person?.hourly_rate) || 0, Number(person?.shopee_rate) || 0, ...(person?.commit_tiers ?? []).map((t) => Number(t.rate))]);
      const high = [Number(rate.replace(/[,\s]/g, "")) || 0, Number(shopeeRate.replace(/[,\s]/g, "")) || 0, ...filledTiers.map((t) => t.rate)]
        .filter((n) => n > RATE_ALERT && !saved.has(n));
      if (high.length && !(await confirm({
        title: `ค่าจ้าง ${money(Math.max(...high))} บาท/ชม. สูงผิดปกติ`,
        description: `ปกติไม่เกิน ${money(RATE_ALERT)} บาท/ชม. — ตรวจว่าไม่ได้พิมพ์ 0 เกิน หรือใส่ค่าจ้างทั้งวัน / ทั้งเดือน (ยอดเงินในสรุปและไฟล์เบิกคิดจากค่านี้)`,
        confirmText: "ถูกต้อง บันทึก",
      }))) return;
    }
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
        ...(role === "borrower" ? { team_name: team } : {}),
        ...(isCrew(role) ? { commit_tiers: tiers } : {}),
        ...(role === "admin" && equipReady && (person || equipment) ? { can_manage_equipment: salaried && equipment } : {}),
        ...(role === "admin" && briefsReady && (person || briefs) ? { can_manage_briefs: briefs } : {}),
        // ทีมไลฟ์: ส่งเมื่อรัน SQL แล้ว หรือติ๊กไว้ (ยังไม่รัน = เซิร์ฟเวอร์แจ้งให้รันก่อน)
        ...(isCrew(role) && (teamReady || liveTeam !== "tiktok") ? { live_platform: liveTeam } : {}),
        // ค่าจ้าง Shopee: ส่งเมื่อเปลี่ยน (ยังไม่รัน SQL = เซิร์ฟเวอร์แจ้งให้รันก่อน)
        ...(shopeeDirty ? { shopee_rate: shopeeRate } : {}),
        // สิทธิ์ Owner: แก้สิทธิ์ตัวเองไม่ได้ (server ตรวจซ้ำ)
        ...(role === "owner" && !isMe ? { ...manage, ...view } : {}),
        // Plan Slot Live: ให้คนอื่นได้เฉพาะคนที่มีสิทธิ์นี้
        ...(role === "owner" && !isMe && canGrantPlan
          ? { can_plan_slots: perm.plan === "edit", ...(viewReady || perm.plan === "view" ? { can_view_plan: perm.plan === "view" } : {}) }
          : {}),
        // สิทธิ์ดูเอกสาร: ส่งเฉพาะฝั่งที่ตัวเองมีสิทธิ์ (ฝั่ง Admin ต้องรัน SQL แยกก่อน)
        // (ไม่ส่ง = ไม่แตะ — คนที่ดูเอกสารได้ฝั่งเดียวแก้ Owner คนอื่นได้ตามปกติ)
        ...(role === "owner" && !isMe && payDocsViewer ? { can_view_pay_docs: docs.mc } : {}),
        ...(role === "owner" && !isMe && payDocsViewer && (docsAdminReady || docs.admin) ? { can_view_pay_docs_admin: docs.admin } : {}),
        // กำหนดสิทธิ์จอง Mc: ส่งเมื่อรัน SQL แล้ว หรือติ๊กไว้ (ยังไม่รัน = เซิร์ฟเวอร์แจ้งให้รันก่อน)
        ...(role === "owner" && !isMe && (quotaReady || quota) ? { can_manage_quota: quota } : {}),
        // รับอีเมลแจ้งยกเลิก (ตั้งให้ตัวเองได้) ส่งเมื่อรัน SQL แล้ว หรือติ๊กไว้ (ยังไม่รัน = เซิร์ฟเวอร์แจ้งให้รันก่อน)
        ...(role === "owner" && (notifyReady || anyNotify) ? { notify_cancel_mc: notifyOn.mc, notify_cancel_admin: notifyOn.admin } : {}),
        ...(rateDirty ? { rate_from: rateFrom } : {}),
      };
      const res = person
        ? await api("/api/owner/staff", { id: person.id, ...fields }, "PATCH")
        : await api("/api/owner/staff", { role, ...fields });
      if (!res.ok) throw new Error(res.message);
      if (person && emailCleared && releaseOnSave) {
        const rel = await api<{ message: string }>("/api/owner/staff", { id: person.id, action: "release" }, "PATCH");
        onClose(rel.ok ? `บันทึกแล้ว · ${rel.message}` : `บันทึกแล้ว แต่ปล่อยคิวไม่สำเร็จ: ${rel.message}`);
        return;
      }
      onClose(person ? "บันทึกแล้ว" : "เพิ่มแล้ว");
    } catch (err) {
      toast((err as Error).message, "error");
      setSaving(false);
    }
  }

  // ---------- รวมรายชื่อซ้ำ: ย้ายคิวทั้งหมดของคนนี้ไปให้รายชื่อที่เลือก แล้วลบคนนี้ ----------
  const samePhoneAs = (o: Person) => !!person && phoneDigits(o.phone).length >= 9 && phoneDigits(o.phone) === phoneDigits(person.phone);
  const twin = person ? others.find(samePhoneAs) ?? others.find((o) => nameKey(o.name) === nameKey(person.name)) : undefined;
  const [mergeTo, setMergeTo] = useState(twin ? String(twin.id) : "");

  /** รวมรายชื่อ: ตรวจก่อน (ย้ายกี่คิว / เวลาชน / อีเมล เบอร์ที่ย้าย) -> ยืนยัน -> รวม (กดปุ่มเดียว) */
  async function doMerge() {
    if (!person || !mergeTo) return;
    setSaving(true);
    try {
      const check = await api<{ summary: MergeSummary }>("/api/owner/staff/merge", { sourceId: person.id, targetId: Number(mergeTo), dryRun: true });
      if (!check.ok) throw new Error(check.message);
      const x = check.summary;
      const ok = await confirm({
        title: `รวม ${x.source} เข้ากับ ${x.target}?`,
        description: (
          <span className="block space-y-1">
            <span className="block">ย้าย <b>{x.total}</b> คิว (ตั้งแต่วันนี้ {x.upcoming} คิว) ไปเป็นของ {x.target} แล้วลบรายชื่อ {x.source}</span>
            {x.moveEmail ? <span className="block">อีเมล {x.moveEmail} ย้ายไปที่ {x.target}</span> : null}
            {x.movePhone ? <span className="block">เบอร์ {x.movePhone} ย้ายไปที่ {x.target}</span> : null}
            {x.conflicts ? <b className="block text-destructive">มี {x.conflicts} คิวที่เวลาชนกับคิวเดิมของ {x.target} ตรวจที่ตาราง slot หลังรวม</b> : null}
            <span className="block">ชีตและปฏิทินอัปเดตให้ — ย้อนกลับไม่ได้</span>
          </span>
        ),
        confirmText: "รวมรายชื่อ", destructive: true,
      });
      if (!ok) { setSaving(false); return; }
      const res = await api<{ message: string }>("/api/owner/staff/merge", { sourceId: person.id, targetId: Number(mergeTo) });
      if (!res.ok) throw new Error(res.message);
      onClose(res.message);
    } catch (err) {
      toast((err as Error).message, "error");
      setSaving(false);
    }
  }

  /** ปล่อยคิวข้างหน้าที่ยังไม่เริ่มให้คนอื่นจอง (คนนี้เลิกไลฟ์แล้ว) แล้วปิดหน้าต่าง (รายชื่อโหลดใหม่) */
  async function release() {
    if (!person || !(await confirm({
      title: `ปล่อยคิวข้างหน้าของ ${displayName(person)}?`,
      description: `คิวที่ยังไม่เริ่ม (ตั้งแต่วันนี้ ${person.upcoming} คิว) จะว่างให้คนอื่นจอง — ลบนัดในปฏิทิน เขียนชีต และแจ้ง Mc / Admin เสริมที่จองแทนได้ · ย้อนกลับต้องใส่ชื่อกลับทีละ slot`,
      confirmText: "ปล่อยคิว", destructive: true,
    }))) return;
    setSaving(true);
    try {
      const res = await api<{ message: string }>("/api/owner/staff", { id: person.id, action: "release" }, "PATCH");
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
            className="no-scrollbar w-full overflow-x-auto"
          >
            {roles.map((r) => <ToggleGroupItem key={r} value={r} className="flex-1 px-2 font-semibold">{ROLE_LABEL[r]}</ToggleGroupItem>)}
          </ToggleGroup>
        ) : null}

        <Field
          label={`ชื่อ${role === "mc" ? " (ไม่ต้องใส่คำว่า Mc)" : ""}`}
          hint={renamed ? "ชื่อในชีตทุกแถวของคนนี้จะเปลี่ยนตามอัตโนมัติ" : null}
        >
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={role === "mc" ? "เช่น มะนาว" : "เช่น แพรวา"} />}
        </Field>

        <Field
          label={`อีเมล Google (${isCrew(role) ? "ใช้ login และลงปฏิทิน" : "ใช้ login"})`}
          hint={isMe ? "เปลี่ยนอีเมลของตัวเองไม่ได้ ให้ Owner คนอื่นเปลี่ยนให้" : null}
          warning={!isMe && isCrew(role) && emailChanged && email.trim()
            ? email.trim().toLowerCase().endsWith("@glorythailand.com")
              ? "อีเมลในองค์กร: ระบบไม่ลงนัดในปฏิทินให้ (ดูคิวจากเว็บ/ชีต)"
              : <>ระบบจะลงคิวข้างหน้าของคนนี้ในปฏิทินของอีเมลนี้ — เจ้าของอีเมลต้องแชร์ปฏิทินให้ kunraroj.d@glorythailand.com (สิทธิ์ &quot;ทำการเปลี่ยนแปลงกิจกรรม&quot;) ก่อน</>
            : null}
        >
          {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={isMe} placeholder="name@gmail.com" autoComplete="off" />}
        </Field>
        {emailCleared ? (
          <div className="-mt-2 rounded-lg border border-warning-border bg-warning px-3 py-2 text-warning-foreground">
            <span className="block text-xs">เอาอีเมลออก = คนนี้เข้าเว็บไม่ได้ แต่ยังมีคิวข้างหน้า <b>{person!.upcoming} คิว</b> อยู่ในชื่อ</span>
            <Label className="mt-1.5 items-start leading-snug font-normal">
              <Checkbox checked={releaseOnSave} onCheckedChange={(v) => setReleaseOnSave(v === true)} className="mt-0.5 bg-card" />
              <span>ปล่อยคิวที่ยังไม่เริ่มให้คนอื่นจองด้วย (ตอนกดบันทึก)</span>
            </Label>
          </div>
        ) : null}

        {role === "marketing" ? (
          <p className="rounded-lg bg-secondary px-3 py-2 text-xs leading-relaxed text-secondary-foreground">
            บัญชี Marketing เข้าเว็บแล้วเห็นหน้า <b>CEO Live</b>: ยอดทั้งวันของวันที่มี CEO Live เทียบวันก่อน (ช่องที่ CEO ไลฟ์ และทุกบัญชี)
            ดูได้อย่างเดียว ส่งออกไฟล์ / สไลด์ได้ + หน้า <b>ขอยืมอุปกรณ์</b> (ส่งคำขอในนามทีม Marketing) + <b>เทรนนิ่ง</b>
            — ไม่เห็นข้อมูลวันอื่น ตาราง slot รายชื่อ หรือค่าจ้าง
          </p>
        ) : null}

        {role === "borrower" ? (
          <>
            <Field label="ทีม / แผนก">
              {(id) => <Input id={id} value={team} onChange={(e) => setTeam(e.target.value)} placeholder="เช่น ทีม Marketing / ฝ่ายขาย" />}
            </Field>
            <Field label="เบอร์โทร">
              {(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08x-xxx-xxxx" />}
            </Field>
            <p className="rounded-lg bg-secondary px-3 py-2 text-xs leading-relaxed text-secondary-foreground">
              บัญชีทีมอื่นเข้าเว็บแล้วเห็นแค่หน้า <b>ขอยืมอุปกรณ์</b>: เลือกอุปกรณ์ที่ว่าง + จำนวน · สถานที่ใช้งาน · วันเวลายืม / คืน แล้วส่งคำขอให้ทีมเราอนุมัติ
              — ไม่เห็นราคา Serial ตาราง slot รายชื่อ หรือข้อมูลอื่น · คำขอเข้าที่หน้าอุปกรณ์ &gt; คำขอยืม
            </p>
          </>
        ) : null}

        {isCrew(role) ? (
          <>
            <Field label="เบอร์โทร" hint="แสดงในปฏิทินของคู่ไลฟ์ (Mc เห็นเบอร์ Admin / Admin เห็นเบอร์ Mc)">
              {(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08x-xxx-xxxx" />}
            </Field>
            <Field label="ค่าจ้างต่อชั่วโมง (บาท)" hint={salaried ? `${role === "mc" ? "Mc" : "Admin"} ประจำ (เงินเดือน) ไม่ต้องใส่ ระบบไม่คิดค่าจ้างรายชั่วโมง` : null}>
              {(id) => <Input id={id} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={salaried ? "ไม่ต้องใส่" : "ว่าง = ใช้ค่าเริ่มต้น"} />}
            </Field>
            {showShopeeRate ? (
              <Field
                label="ค่าจ้าง Shopee ต่อชั่วโมง (บาท)"
                hint="ไลฟ์ Shopee (คิวแท็บ MC Shopee) คิดเรทนี้คงที่ · Commit นับเฉพาะชั่วโมง TikTok · ว่าง = เท่ากับค่าจ้างด้านบน (ทีม Shopee อย่างเดียวใส่ด้านบนช่องเดียวพอ)"
              >
                {(id) => <Input id={id} inputMode="decimal" value={shopeeRate} onChange={(e) => setShopeeRate(e.target.value)} placeholder="ว่าง = เท่ากับค่าจ้างด้านบน" />}
              </Field>
            ) : null}
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

        {/* Admin เสริม กับ Admin ประจำ เลือกได้อย่างเดียว */}
        {role === "admin" ? (
          <Label className="leading-snug font-normal">
            <Checkbox checked={extra} onCheckedChange={(v) => { setExtra(v === true); if (v === true) setSalaried(false); }} />
            Admin เสริม (รับคิวและยกเลิกคิวผ่านเว็บได้เอง)
          </Label>
        ) : null}

        {role === "admin" ? (
          <Label className="items-start leading-snug font-normal">
            <Checkbox checked={briefs} disabled={!briefsReady} onCheckedChange={(v) => setBriefs(v === true)} className="mt-0.5" />
            <span>
              จัดการบรีฟการแต่งตัว
              <span className="block text-xs text-muted-foreground">
                {briefsReady
                  ? "เห็นแท็บ \"เฟรมไลฟ์\" ในหน้าเทรนนิ่ง: ดูเฟรมทุกช่วง + เขียนบรีฟ / แนบรูปชุดตัวอย่างให้ Mc"
                  : "ต้องรัน SQL 20261113000000_live_frames ใน Supabase ก่อน"}
              </span>
            </span>
          </Label>
        ) : null}

        {isCrew(role) ? (
          <Label className="items-start leading-snug font-normal">
            <Checkbox
              checked={salaried}
              onCheckedChange={(v) => { setSalaried(v === true); if (v === true) setExtra(false); }}
              className="mt-0.5"
            />
            <span>
              {role === "mc" ? "Mc" : "Admin"} ประจำ (พนักงานประจำ ได้เงินเดือน)
              <span className="block text-xs text-muted-foreground">
                ไม่ต้องใส่ค่าจ้าง — ไม่คิดค่าจ้างรายชั่วโมงในสรุปรายเดือน และไม่อยู่ในไฟล์เบิก
                {role === "mc" ? <> · ไม่ต้องแนบหลักฐานไลฟ์ (slot ของคนนี้ไม่ขึ้นในหน้าหลักฐานไลฟ์)</> : null}
              </span>
            </span>
          </Label>
        ) : null}

        {/* Admin ประจำ: สิทธิ์เพิ่มเติม (ตั้งทีละคน) */}
        {role === "admin" && salaried ? (
          <Label className="ml-6 items-start leading-snug font-normal">
            <Checkbox checked={equipment} disabled={!equipReady} onCheckedChange={(v) => setEquipment(v === true)} className="mt-0.5" />
            <span>
              จัดการอุปกรณ์โปรดักชั่น
              <span className="block text-xs text-muted-foreground">
                {equipReady ? "เห็นเมนู \"อุปกรณ์\" ดู / เพิ่ม / แก้ / ลบรายการอุปกรณ์ได้ (รวมราคา)" : "ต้องรัน SQL 20261025000000_equipment ใน Supabase ก่อน"}
              </span>
            </span>
          </Label>
        ) : null}

        {rateDirty ? (
          <div className="rounded-lg border border-warning-border bg-warning px-3 py-2 text-warning-foreground">
            <span className="font-semibold">ค่าจ้างใหม่มีผลตั้งแต่เดือน</span>
            <ToggleGroup
              type="single" variant="outline" size="sm" spacing={0} value={rateFrom}
              onValueChange={(v) => { if (v) setRateFrom(v); }}
              aria-label="ค่าจ้างใหม่มีผลตั้งแต่เดือน" className="mt-1.5 bg-card"
            >
              {[-2, -1, 0, 1].map((n) => {
                const m = monthKey(n, thisMonth);
                return (
                  <ToggleGroupItem key={m} value={m} className="px-2.5 text-xs font-semibold pointer-coarse:h-9 pointer-coarse:px-3 data-[state=on]:bg-tint! data-[state=on]:text-tint-foreground!">
                    {fmtMonthShort.format(new Date(`${m}-01T12:00:00Z`))}{n === 0 ? " (เดือนนี้)" : ""}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            <span className="mt-1 block text-xs">
              เดือนก่อนหน้านั้นคิดเรทเดิมเสมอ (สรุปรายเดือน / ไฟล์เบิก / ตารางของฉัน ไม่เปลี่ยนตาม)
              {rateFrom < thisMonth ? " · เดือนย้อนหลังที่เลือกจะคิดเรทใหม่ ถ้าบันทึกโอนไปแล้วจะขึ้นยอดค้าง / เกินตามเรทใหม่" : ""}
            </span>
          </div>
        ) : null}

        {/* ทีมไลฟ์: หน้าจองคิว TikTok (แท็บ Deal Mc) / คิว Shopee (แท็บ MC Shopee — มีแต่ Mc) ติ๊กทั้งคู่ = ได้ทั้งสองหน้า */}
        {isCrew(role) ? (
          <fieldset className="rounded-lg border px-3 py-2">
            <legend className="px-1 font-semibold">ทีมไลฟ์</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {([["tiktok", "TikTok", tiktok, setTiktok, shopee], ["shopee", "Shopee", shopee, setShopee, tiktok]] as const).map(([id, text, on, set, other]) => (
                <Label key={id} className="font-normal">
                  {/* ต้องติ๊กอย่างน้อยหนึ่งทีม: ติ๊กออกอันสุดท้ายไม่ได้ */}
                  <Checkbox checked={on} disabled={!teamReady || (on && !other)} onCheckedChange={(v) => set(v === true)} />
                  {text}
                </Label>
              ))}
            </div>
            <span className="mt-1 block text-xs text-muted-foreground">
              {!teamReady ? "ต้องรัน SQL 20261031000000_live_platform ใน Supabase ก่อน"
                : liveTeam === "both" ? "เห็น / จองได้ทั้งคิว TikTok และคิว Shopee (สลับหน้าที่หน้าจอง) · ได้รับแจ้งเตือน slot ว่างของทั้งสองคิว"
                  : liveTeam === "shopee" ? (role === "mc"
                    ? "เห็น / จองเฉพาะคิว Shopee · ไม่เห็นคิว TikTok · ยังเปิด \"ตารางของฉัน\" (ใบ 50 ทวิ / เอกสารทำเบิก) ได้ตามปกติ"
                    : "Admin: คิว Shopee ไม่มีแถว Admin จึงไม่มีหน้ารับคิว · ใช้ได้แค่ \"ตารางของฉัน\" (ใบ 50 ทวิ / เอกสารทำเบิก)")
                    : "เห็น / จองเฉพาะคิว TikTok"}
              {teamReady ? " · คิวที่มีอยู่แล้วไม่หาย" : ""}
            </span>
          </fieldset>
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
                        className="px-2.5 text-xs font-semibold data-[state=on]:bg-tint! data-[state=on]:text-tint-foreground!"
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
            {payDocsViewer ? (
              <div className="mt-2 border-t pt-2">
                <span className="font-medium">ดูเอกสาร</span>
                <span className="block text-xs text-muted-foreground">
                  เอกสารทำเบิก (บัตร ปชช. / บัญชีธนาคาร) · ใบ 50 ทวิ · เอกสารรับเงิน + จับคู่ / ตรวจเอกสาร ของฝั่งที่ติ๊ก (ข้อมูลส่วนตัว — ให้เฉพาะคนที่ต้องใช้)
                </span>
                {([["mc", "เอกสารของ Mc"], ["admin", "เอกสารของ Admin"]] as const).map(([side, text]) => {
                  const sqlMissing = side === "admin" && !docsAdminReady;
                  return (
                    <Label key={side} className="items-start py-1 leading-snug font-normal">
                      <Checkbox
                        checked={isMe ? docsScope[side] : docs[side]} disabled={isMe}
                        onCheckedChange={(v) => setDocs({ ...docs, [side]: v === true })} className="mt-0.5"
                      />
                      <span>
                        {text}
                        {!isMe && sqlMissing && docs.admin ? <span className="block text-xs text-destructive">ต้องรัน SQL 20261106000000_pay_docs_admin ใน Supabase ก่อน</span> : null}
                      </span>
                    </Label>
                  );
                })}
                <span className="block text-xs text-muted-foreground">
                  {isMe ? "แก้สิทธิ์ของตัวเองไม่ได้ ให้ Owner คนอื่นที่มีสิทธิ์ดูเอกสารแก้ให้" : null}
                  {!isMe && (docs.mc || docs.admin) && perm.mc === "none" && perm.admin === "none"
                    ? <span className="block text-destructive">ต้องมีสิทธิ์ฝั่ง Mc หรือ Admin ด้วย ถึงจะเห็นหน้าพนักงาน (ที่อยู่ของเอกสาร)</span> : null}
                </span>
              </div>
            ) : null}
            <Label className="mt-2 items-start border-t pt-2 leading-snug font-normal">
              <Checkbox
                checked={quota || fullPerm} disabled={isMe || fullPerm}
                onCheckedChange={(v) => setQuota(v === true)} className="mt-0.5"
              />
              <span>
                <span className="font-medium">กำหนดสิทธิ์จอง Mc</span>
                <span className="block text-xs text-muted-foreground">
                  {fullPerm
                    ? "จัดการได้ทั้ง Mc + Admin = ทำได้อยู่แล้ว"
                    : "ตาราง slot > รายวัน > สิทธิ์จอง Mc ต่อเดือน: ตั้งสิทธิ์จองเพิ่มพิเศษรายคน / เปิดปิดการจำกัด / คำนวณแร็งค์ใหม่ (ต้องมีสิทธิ์ฝั่ง Mc ด้วย)"}
                  {!isMe && quota && !quotaReady ? <span className="block text-destructive">ต้องรัน SQL 20261107000000_mc_quota ใน Supabase ก่อน</span> : null}
                  {!isMe && quota && perm.mc === "none" ? <span className="block text-destructive">ต้องมีสิทธิ์ฝั่ง Mc ด้วย ถึงจะเห็นหน้าผลงาน Mc</span> : null}
                </span>
              </span>
            </Label>
          </fieldset>
        ) : null}

        {role === "owner" ? (
          <fieldset className="rounded-lg border px-3 py-2">
            <legend className="px-1 font-semibold">รับอีเมลแจ้งยกเลิกคิว</legend>
            <p className="pb-1 text-xs text-muted-foreground">
              ส่งเข้า {email.trim() || "อีเมลของคนนี้"} ทันทีที่มีคนกดยกเลิกคิวผ่านเว็บ (บอกคิว / คู่ไลฟ์ / ยกเลิกก่อนไลฟ์กี่วัน · เหลือไม่ถึง 48 ชม. ขึ้น [ด่วน])
            </p>
            {([
              ["mc", "เมื่อ Mc ยกเลิกคิว"],
              ["admin", "เมื่อ Admin เสริมยกเลิกคิว"],
            ] as const).map(([side, label]) => {
              const blocked = perm[side] === "none";
              return (
                <Label key={side} className="items-start py-1 leading-snug font-normal">
                  <Checkbox
                    checked={notifyOn[side]}
                    disabled={blocked || !email.trim()}
                    onCheckedChange={(v) => setNotify({ ...notify, [side]: v === true })}
                    className="mt-0.5"
                  />
                  <span>
                    {label}
                    {blocked ? <span className="block text-xs text-muted-foreground">ต้องมีสิทธิ์ฝั่ง {side === "mc" ? "Mc" : "Admin"} (ดูได้ หรือ จัดการได้) ก่อน</span> : null}
                  </span>
                </Label>
              );
            })}
            {anyNotify && !notifyReady ? (
              <span className="block text-xs text-destructive">ต้องรัน SQL 20261020000000_notify_cancel ใน Supabase ก่อน ถึงจะบันทึกได้</span>
            ) : null}
          </fieldset>
        ) : null}

        {person && isCrew(person.role) && docsScope[person.role as "mc" | "admin"] && person.email ? <PayDocsPanel staffId={person.id} name={person.name} /> : null}

        {person && isCrew(person.role) && person.upcoming > 0 ? (
          <fieldset className="space-y-2 rounded-xl border p-3">
            <legend className="px-1 font-semibold">คิวข้างหน้า {person.upcoming} คิว</legend>
            <p className="text-xs text-muted-foreground">
              คนนี้เลิกไลฟ์แล้ว? ปล่อยคิวที่ยังไม่เริ่มให้คนอื่นจอง — ลบนัดในปฏิทิน เขียนชีต และแจ้งคนที่จองแทนได้ให้อัตโนมัติ
            </p>
            <Button variant="outline" disabled={saving} onClick={release} className="font-semibold text-destructive hover:text-destructive">
              ปล่อยคิวข้างหน้าทั้งหมด
            </Button>
          </fieldset>
        ) : null}

        {person ? <StaffHistory staffId={person.id} /> : null}

        {person && isCrew(person.role) && others.length ? (
          <fieldset className="space-y-2 rounded-xl border p-3">
            <legend className="px-1 font-semibold">รวมรายชื่อซ้ำ</legend>
            <p className="text-xs text-muted-foreground">
              ใช้เมื่อคนเดียวกันมี 2 รายชื่อ (เช่น สะกดชื่อในชีตต่างกัน) — ย้ายคิวทั้งหมดของ {displayName(person)} ไปเป็นของรายชื่อที่เลือก แล้วลบ {displayName(person)}
              {twin ? <span className="font-semibold text-warning-foreground"> · {samePhoneAs(twin) ? "เบอร์" : "ชื่อ"}เดียวกับ {displayName(twin)}</span> : null}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={mergeTo} onValueChange={setMergeTo}>
                <SelectTrigger aria-label="รวมเข้ากับ" className="min-w-48 flex-1"><SelectValue placeholder="เลือกรายชื่อที่จะเก็บไว้" /></SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                  {[...others].sort((a, b) => a.name.localeCompare(b.name, "th")).map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>{displayName(o)}{o.email ? "" : " (ไม่มีอีเมล)"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="destructive" disabled={saving || !mergeTo} onClick={doMerge}>รวมรายชื่อ</Button>
            </div>
            <p className="text-xs text-muted-foreground">ปุ่ม &quot;บันทึก&quot; ด้านล่างไม่ได้รวมรายชื่อ — กด &quot;รวมรายชื่อ&quot; แล้วยืนยัน</p>
          </fieldset>
        ) : null}
      </DialogBody>

      <DialogActions>
        {person && !isMe && canDelete ? (
          <Button variant="destructive" size="lg" onClick={remove} disabled={saving} className="mr-auto">ลบคนนี้</Button>
        ) : null}
        <Button variant="outline" size="lg" disabled={saving} onClick={() => onClose()}>ยกเลิก</Button>
        <Button
          size="lg"
          disabled={saving || !name.trim() || noScope || (role === "owner" && ((!isMe && anyView && !viewReady) || (anyNotify && !notifyReady)))}
          onClick={save}
        >
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </Button>
      </DialogActions>
    </AppDialog>
  );
}

const fmtLogAt = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" });

/** ประวัติการแก้รายชื่อนี้ (ค่าจ้าง / Commit / สิทธิ์ / ข้อมูลติดต่อ) — กดแล้วค่อยโหลด */
function StaffHistory({ staffId }: { staffId: number }) {
  const [items, setItems] = useState<{ at: string; by: string; action: string }[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      const res = await api<{ items: { at: string; by: string; action: string }[] }>(`/api/owner/staff/history?id=${staffId}`);
      if (!res.ok) throw new Error(res.message);
      setItems(res.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="rounded-lg border px-3 py-2 text-sm">
      <legend className="px-1 font-semibold">ประวัติการแก้ไข</legend>
      {items ? (
        items.length ? (
          <ul className="scroll-thin max-h-48 space-y-1 overflow-y-auto text-xs">
            {items.map((x, i) => (
              <li key={i}>
                <span className="text-muted-foreground tabular-nums">{fmtLogAt.format(new Date(x.at))} · {x.by}:</span>{" "}
                {x.action.replace(/^(แก้|เพิ่ม|ลบ)พนักงาน (mc|admin|owner|marketing) "[^"]*":? ?/, (_, verb) => (verb === "แก้" ? "" : `${verb}รายชื่อ `))}
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted-foreground">ยังไม่มีประวัติ</p>
      ) : (
        <Button variant="outline" size="sm" disabled={busy} onClick={load}>{busy ? "กำลังโหลด..." : "ดูประวัติ"}</Button>
      )}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      <p className="mt-1 text-xs text-muted-foreground">บันทึกว่าใครเปลี่ยนค่าจ้าง Commit สิทธิ์ หรือข้อมูลติดต่อ จากเท่าไรเป็นเท่าไร (ก่อน 14 ต.ค. 2569 บอกแค่ช่องที่แก้)</p>
    </fieldset>
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
