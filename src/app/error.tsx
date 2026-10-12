"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** หน้าเว็บพังระหว่างแสดงผล: บอกเป็นภาษาไทย + ลองใหม่ / กลับหน้าแรก (error ฝั่งเซิร์ฟเวอร์แจ้งทีมทางอีเมลอยู่แล้ว) */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-[520px] flex-col justify-center gap-3 px-4 py-10">
      <span className="text-[15px] font-bold tracking-[.12em]">GL<span className="tracking-normal text-brand-glow">✦</span>RY VITAL</span>
      <h1 className="text-2xl font-bold">ขออภัย หน้านี้ทำงานผิดพลาด</h1>
      <p className="text-sm text-muted-foreground">
        ลองกด &quot;ลองใหม่&quot; ก่อน ถ้ายังไม่ได้ ให้กลับหน้าแรกแล้วเข้าใหม่อีกครั้ง ถ้าเป็นซ้ำ แจ้งทีมงานพร้อมรหัสด้านล่าง
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={() => retry()}>ลองใหม่</Button>
        <Button size="lg" variant="outline" asChild><Link href="/">กลับหน้าแรก</Link></Button>
      </div>
      {error.digest ? <p className="text-xs text-muted-foreground">รหัส: {error.digest}</p> : null}
    </main>
  );
}
