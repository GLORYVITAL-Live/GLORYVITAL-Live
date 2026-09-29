import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

const plexThai = IBM_Plex_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "GLORY VITAL Live",
  description: "จองคิวไลฟ์ Mc และจัดคิว Admin ของ GLORY VITAL",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF7FA" },
    { media: "(prefers-color-scheme: dark)", color: "#1A1016" },
  ],
};

// ใช้ธีมที่ผู้ใช้เลือกไว้ทันที ก่อนหน้าเว็บแสดงผล (กันจอกระพริบ)
const themeScript = `try{var t=localStorage.getItem('glory_booking_theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${plexThai.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
