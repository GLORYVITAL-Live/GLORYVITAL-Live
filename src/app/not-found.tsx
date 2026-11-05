import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";

/** ลิงก์ผิด / หน้าที่ไม่มี */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[520px] flex-col justify-center gap-3 px-4 py-10">
      <BrandLogo className="self-start" />
      <h1 className="text-2xl font-bold">ไม่พบหน้านี้</h1>
      <p className="text-sm text-muted-foreground">ลิงก์อาจพิมพ์ผิด หรือหน้านี้ถูกย้ายไปแล้ว</p>
      <Link href="/" className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">กลับหน้าแรก</Link>
    </main>
  );
}
