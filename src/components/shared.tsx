"use client";

import { createContext, useCallback, useContext, useState, type ComponentProps, type ReactNode } from "react";
import { toast as sonner } from "sonner";
import { ChevronLeftIcon, ChevronRightIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { platformLabel } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";

// ---------- เรียก API ----------

export async function api<T>(
  url: string,
  body?: object,
  method: "POST" | "PUT" | "PATCH" | "DELETE" = "POST",
): Promise<T & { ok: boolean; message?: string; authError?: boolean }> {
  let res: Response;
  try {
    res = await fetch(url, body
      ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : { cache: "no-store" });
  } catch {
    throw new Error("เชื่อมต่อไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต");
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error("ระบบตอบกลับผิดรูปแบบ (HTTP " + res.status + ")");
  return data;
}

// ---------- toast (sonner) ----------

const showToast = (message: string, type?: "error") => {
  if (type === "error") sonner.error(message);
  else sonner(message);
};
/** แจ้งเตือนสั้นๆ: toast("บันทึกแล้ว") / toast("ผิดพลาด", "error") (ฟังก์ชันเดิมทุกครั้ง ใส่ใน deps ได้) */
export const useToast = () => showToast;

// ---------- กล่องยืนยัน (แทน window.confirm) ----------

type ConfirmOptions = { title: string; description?: ReactNode; confirmText?: string; destructive?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);
/** const ok = await confirm({ title: "ลบ slot นี้?", destructive: true }) */
export const useConfirm = () => useContext(ConfirmCtx);

/** ครอบทั้งแอป: toast + กล่องยืนยัน */
export function AppProviders({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setReq({ ...o, resolve })), []);
  const answer = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Toaster position="top-center" offset={{ top: "calc(12px + env(safe-area-inset-top))" }} />
      <AlertDialog open={!!req} onOpenChange={(open) => { if (!open) answer(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{req?.title}</AlertDialogTitle>
            {req?.description ? <AlertDialogDescription>{req.description}</AlertDialogDescription> : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction variant={req?.destructive ? "danger" : "default"} onClick={() => answer(true)}>
              {req?.confirmText ?? "ตกลง"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmCtx.Provider>
  );
}

// ---------- หน้าต่าง (dialog): แผ่นล่างบนมือถือ กลางจอบนคอม ----------

const SHEET = cn(
  "flex max-h-[88dvh] flex-col gap-3 p-5 pb-[calc(20px+env(safe-area-inset-bottom))] sm:max-w-[560px]",
  "max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl",
);

/** busy = กำลังทำงาน ปิดหน้าต่างไม่ได้ (กด Esc / คลิกนอกกล่อง / ปุ่ม X) */
export function AppDialog({ open, onClose, busy = false, title, description, children, className }: {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent
        showCloseButton={!busy}
        className={cn(SHEET, className)}
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="text-lg leading-snug font-bold">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** ส่วนเนื้อหาที่เลื่อนได้ในหน้าต่าง */
export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("scroll-thin -mx-1 min-h-0 flex-1 overflow-y-auto px-1", className)} {...props} />;
}

/** แถวปุ่มท้ายหน้าต่าง */
export function DialogActions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mt-1 flex flex-wrap items-center justify-end gap-2", className)} {...props} />;
}

// ---------- ปุ่ม ----------

export function IconButton({ label, className, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-lg"
      aria-label={label}
      title={label}
      className={cn("rounded-full", className)}
      {...props}
    />
  );
}

// ---------- ชิ้นส่วนที่ใช้ซ้ำ ----------

/** สีประจำแพลตฟอร์ม (วนตามลำดับที่เจอ) */
export const TAG_COLORS = [
  "bg-p0/15 text-p0",
  "bg-p1/15 text-p1",
  "bg-p2/15 text-p2",
  "bg-p3/15 text-p3",
];

export function PlatformBadge({ name, index, className }: { name: string; index: number; className?: string }) {
  // ชื่อช่องที่แสดง (เช่น GLORY MALL -> GLORY VITAL) ชีตยังใช้ชื่อเดิม
  return <Badge className={cn("font-semibold", TAG_COLORS[index % 4], className)}>{platformLabel(name)}</Badge>;
}

/** กล่องว่าง / ข้อความแจ้ง (เช่น ยังไม่มีข้อมูล) */
export function StateBox({ title, children, action, className }: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("my-6 border bg-card py-8", className)}>
      <EmptyHeader>
        <EmptyTitle className="text-base font-bold">{title}</EmptyTitle>
        {children ? <EmptyDescription>{children}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

/** โหลดไม่สำเร็จ + ปุ่มลองใหม่ */
export function LoadError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <StateBox title={title} action={<Button variant="outline" onClick={onRetry}>ลองอีกครั้ง</Button>}>
      {message}
    </StateBox>
  );
}

export function LoadingBlock({ className }: { className?: string }) {
  return <Skeleton aria-label="กำลังโหลด" className={cn("my-4 h-40 rounded-2xl", className)} />;
}

/** กล่องข้อความ: info = ชมพูอ่อน / warning = ส้ม */
export function Notice({ variant = "info", title, icon = false, children, className, ...props }: {
  variant?: "info" | "warning";
  title?: ReactNode;
  icon?: boolean;
  children?: ReactNode;
  className?: string;
} & Omit<ComponentProps<"div">, "title">) {
  const Icon = variant === "warning" ? TriangleAlertIcon : InfoIcon;
  return (
    <Alert
      role={variant === "warning" ? "alert" : "status"}
      className={cn(
        "my-2 px-3 py-2.5",
        variant === "warning"
          ? "border-warning-border bg-warning text-warning-foreground"
          : "border-transparent bg-secondary text-secondary-foreground",
        className,
      )}
      {...props}
    >
      {icon ? <Icon /> : null}
      {title ? <AlertTitle className="text-base font-bold">{title}</AlertTitle> : null}
      {children ? <AlertDescription className="text-inherit">{children}</AlertDescription> : null}
    </Alert>
  );
}

export function MonthNav({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="my-2 flex items-center justify-between gap-3">
      <IconButton label="เดือนก่อนหน้า" onClick={onPrev}><ChevronLeftIcon /></IconButton>
      <strong aria-live="polite">{label}</strong>
      <IconButton label="เดือนถัดไป" onClick={onNext}><ChevronRightIcon /></IconButton>
    </div>
  );
}

export function Stats({ items }: { items: [string, string][] }) {
  return (
    <div className="my-3 grid grid-cols-3 gap-2">
      {items.map(([n, l]) => (
        <div key={l} className="rounded-xl bg-secondary px-3 py-2.5 text-center">
          <span className="block text-xl font-bold text-primary tabular-nums">{n}</span>
          <span className="text-xs text-muted-foreground">{l}</span>
        </div>
      ))}
    </div>
  );
}

/** ป้ายวันนี้ / พรุ่งนี้ */
export function DayBadge({ label }: { label: string }) {
  return label ? <Badge>{label}</Badge> : null;
}
