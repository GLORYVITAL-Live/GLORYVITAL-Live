import { google } from "googleapis";

/**
 * สิทธิ์เข้า Google API (ปฏิทิน + อ่านชีต)
 *
 * แบบหลัก: ทำงานในนามบัญชีผู้ใช้ (บัญชีเดียวกับที่เคยรัน Apps Script ซึ่งทุกคนแชร์ปฏิทินให้แล้ว)
 *   ใช้ GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
 *   ได้ refresh token จาก `bun run google:auth`
 * แบบสำรอง: Service Account (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)
 *   ใช้ได้เมื่อองค์กรอนุญาตให้สร้าง key
 */

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/spreadsheets", // อ่าน + เขียนชีต (ซิงค์สองทาง)
  // Google Drive: เฉพาะไฟล์/โฟลเดอร์ที่ระบบสร้างเอง (สำเนารูปหลักฐานไลฟ์) มองไม่เห็นไฟล์อื่นในไดรฟ์
  "https://www.googleapis.com/auth/drive.file",
];

// Client ID ของ "GLORY VITAL Web Client" (ไม่ใช่ความลับ)
export const DEFAULT_OAUTH_CLIENT_ID = "1061582080754-eblmgn19o2cvds5sg22d7p70me7qitbs.apps.googleusercontent.com";

export function googleAuth() {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (refreshToken && clientSecret) {
    const auth = new google.auth.OAuth2(process.env.GOOGLE_OAUTH_CLIENT_ID || DEFAULT_OAUTH_CLIENT_ID, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    return auth;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (email && key) return new google.auth.JWT({ email, key, scopes: GOOGLE_SCOPES });

  return null;
}
