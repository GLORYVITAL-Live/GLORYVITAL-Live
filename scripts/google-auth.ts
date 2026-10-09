/**
 * เชื่อมบัญชี Google ที่ใช้ลงปฏิทิน + อ่านชีต + ส่งอีเมลแจ้งเตือน (ทำครั้งเดียว / ทำใหม่เมื่อเพิ่มสิทธิ์ใน GOOGLE_SCOPES)
 *
 *   bun run google:auth
 *
 * จะเปิดหน้า login ของ Google ให้เลือกบัญชีที่เคยรัน Apps Script (ทุกคนแชร์ปฏิทินให้บัญชีนี้แล้ว)
 * กด "อนุญาต" แล้วสคริปต์จะบันทึก GOOGLE_REFRESH_TOKEN ลง .env.local ให้เอง (ไม่แสดงบนจอ)
 *
 * ต้องมี GOOGLE_OAUTH_CLIENT_SECRET ใน .env.local ก่อน และ OAuth Client ต้องมี redirect URI
 *   http://localhost:3999/oauth2callback
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { spawn } from "child_process";
import { google } from "googleapis";
import { DEFAULT_OAUTH_CLIENT_ID, GOOGLE_SCOPES } from "../src/lib/google";

const PORT = 3999;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
const ENV_FILE = ".env.local";

const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!clientSecret) {
  console.error("ยังไม่ได้ใส่ GOOGLE_OAUTH_CLIENT_SECRET ใน .env.local (ใช้ Client Secret ตัวเดียวกับที่ใส่ใน Supabase)");
  process.exit(1);
}

const oauth = new google.auth.OAuth2(process.env.GOOGLE_OAUTH_CLIENT_ID || DEFAULT_OAUTH_CLIENT_ID, clientSecret, REDIRECT);
const state = crypto.randomUUID();
const url = oauth.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // บังคับให้ได้ refresh token ทุกครั้ง
  scope: GOOGLE_SCOPES,
  state,
});

/** เขียน/แทนที่ค่าใน .env.local โดยไม่แตะบรรทัดอื่น */
function saveEnv(name: string, value: string) {
  const text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  writeFileSync(ENV_FILE, re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, "\n")}${line}\n`);
}

const page = (msg: string) =>
  new Response(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px">${msg}</body>`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname !== "/oauth2callback") return new Response("not found", { status: 404 });
    if (u.searchParams.get("state") !== state) return page("state ไม่ตรง กรุณารันคำสั่งใหม่");
    const code = u.searchParams.get("code");
    if (!code) return page(`ไม่ได้รับอนุญาต: ${u.searchParams.get("error") ?? "ไม่ทราบสาเหตุ"}`);

    try {
      const { tokens } = await oauth.getToken(code);
      if (!tokens.refresh_token) throw new Error("Google ไม่ได้ส่ง refresh token มา");
      oauth.setCredentials(tokens);
      const me = await google.oauth2({ version: "v2", auth: oauth }).userinfo.get().catch(() => null);
      saveEnv("GOOGLE_REFRESH_TOKEN", tokens.refresh_token);
      const who = me?.data.email ?? "(ไม่ทราบอีเมล)";
      console.log(`✓ เชื่อมบัญชี ${who} แล้ว บันทึก GOOGLE_REFRESH_TOKEN ลง ${ENV_FILE}`);
      setTimeout(() => { server.stop(); process.exit(0); }, 300);
      return page(`✓ เชื่อมบัญชี ${who} เรียบร้อย ปิดหน้านี้ได้เลย`);
    } catch (err) {
      console.error("แลก token ไม่สำเร็จ:", (err as Error).message);
      setTimeout(() => process.exit(1), 300);
      return page("แลก token ไม่สำเร็จ ดูข้อความในเทอร์มินัล");
    }
  },
});

console.log("กำลังเปิดหน้า login ของ Google... ถ้าไม่เปิดเอง ให้คัดลอกลิงก์นี้ไปเปิด:\n" + url);
if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url.replace(/&/g, "^&")], { stdio: "ignore" });
else spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore" });

setTimeout(() => {
  console.error("หมดเวลา (5 นาที) กรุณารันใหม่");
  process.exit(1);
}, 5 * 60_000);
