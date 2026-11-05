import { cn } from "@/lib/utils";

/** โลโก้ GLORY VITAL (public/logo-glory-vital.png สีชมพู พื้นโปร่งใส ใช้ได้ทั้งธีมสว่าง / มืด) */
export function BrandLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- ไฟล์เล็กย่อมาแล้ว ไม่ต้องผ่านตัวย่อรูปของ Next (กิน RAM บน Render)
    <img src="/logo-glory-vital.png" alt="GLORY VITAL" width={426} height={108} className={cn("h-8 w-auto shrink-0 sm:h-9", className)} />
  );
}
