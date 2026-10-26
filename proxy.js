import { next } from "@vercel/functions";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const COOKIE_NAME = "__Host-plusquam-hub-session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_LOGIN_BODY_BYTES = 4096;
const LOGIN_PUBLIC_ASSETS = new Set([
  "/assets/logo.png",
  "/assets/Numans-Regular.ttf",
]);

function settings() {
  const email = process.env.HUB_LOGIN_EMAIL?.trim().toLowerCase() ?? "";
  const password = process.env.HUB_LOGIN_PASSWORD ?? "";
  const sessionSecret = process.env.HUB_SESSION_SECRET ?? "";
  const configured = email.includes("@") && !/\s/.test(email)
    && password.length >= 14
    && Buffer.byteLength(sessionSecret, "utf8") >= 32;
  return { email, password, sessionSecret, configured };
}

function constantTimeTextEqual(left, right) {
  const leftHash = createHash("sha256").update(left, "utf8").digest();
  const rightHash = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftHash, rightHash);
}

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function createSession(secret) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${expiresAt}.${randomBytes(18).toString("base64url")}`;
  return `${payload}.${sign(payload, secret)}`;
}

function sessionIsValid(request, secret) {
  const rawCookie = request.headers.get("cookie") ?? "";
  const prefix = `${COOKIE_NAME}=`;
  const value = rawCookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(prefix))?.slice(prefix.length);
  if (!value) return false;

  const parts = value.split(".");
  if (parts.length !== 3 || !/^\d{10}$/.test(parts[0])) return false;
  const [expiresAt, nonce, providedSignature] = parts;
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(nonce) || !/^[A-Za-z0-9_-]{40,50}$/.test(providedSignature)) return false;
  if (Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;

  const payload = `${expiresAt}.${nonce}`;
  const expected = Buffer.from(sign(payload, secret), "base64url");
  const provided = Buffer.from(providedSignature, "base64url");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function headers(extra = {}) {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    ...extra,
  };
}

function redirect(location, extraHeaders = {}) {
  return new Response(null, {
    status: 303,
    headers: headers({ Location: location, ...extraHeaders }),
  });
}

function loginPage({ status = 200, message = "" } = {}) {
  const safeMessage = message ? `<p class="message" role="alert">${message}</p>` : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0C3FE8"><title>Sign in · Plusquam Evidence Hub</title>
<link rel="preload" href="/assets/Numans-Regular.ttf" as="font" type="font/ttf" crossorigin>
<style>
@font-face{font-family:Numans;src:url('/assets/Numans-Regular.ttf') format('truetype');font-display:swap}
:root{font-family:Numans,system-ui,sans-serif;color:#051857;background:#f4f6fc;font-synthesis:none;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px;background:radial-gradient(ellipse at 14% 12%,rgba(12,63,232,.12),transparent 35%),radial-gradient(ellipse at 88% 88%,rgba(61,8,241,.09),transparent 34%),#f4f6fc;color:#051857;font:16px/1.55 Numans,system-ui,sans-serif}
.card{width:min(100%,470px);padding:clamp(28px,7vw,48px);border:1px solid #e0e6f7;border-radius:26px;background:rgba(255,255,255,.96);box-shadow:0 28px 80px rgba(5,24,87,.12)}
.logo-wrap{display:flex;align-items:center;justify-content:center;margin:0 0 30px;padding:0 0 25px;border-bottom:1px solid #e9edf8}
.logo{display:block;width:min(100%,230px);height:auto;object-fit:contain}
.eyebrow{margin:0 0 8px;color:#0C3FE8;font-size:12px;font-weight:700;letter-spacing:.16em;text-align:center;text-transform:uppercase}
h1{margin:0 0 9px;font-size:clamp(27px,6vw,34px);line-height:1.2;letter-spacing:-.025em;text-align:center}
.intro{margin:0 0 28px;color:#55608A;font-size:15px;text-align:center}
.message{margin:0 0 20px;padding:13px 15px;border:1px solid #ffd7d7;border-radius:12px;background:#fff3f3;color:#992525;font-size:14px;line-height:1.45}
.field{display:grid;gap:8px;margin:0 0 20px}
.field label{color:#152454;font-size:14px;font-weight:700}
.field input{width:100%;min-height:52px;padding:13px 15px;border:1px solid #d5ddef;border-radius:12px;background:#fff;color:#051857;font:inherit;transition:border-color .2s ease,box-shadow .2s ease}
.field input:hover{border-color:#aab9e9}
.field input:focus{outline:0;border-color:#0C3FE8;box-shadow:0 0 0 4px rgba(12,63,232,.13)}
button{width:100%;min-height:54px;margin:5px 0 0;padding:14px 18px;border:0;border-radius:13px;background:linear-gradient(110deg,#0C3FE8,#3D08F1);box-shadow:0 10px 24px rgba(12,63,232,.23);color:#fff;font:inherit;font-size:16px;font-weight:700;cursor:pointer;transition:transform .2s ease,box-shadow .2s ease}
button:hover{transform:translateY(-2px);box-shadow:0 14px 28px rgba(12,63,232,.3)}
button:focus-visible{outline:3px solid #051857;outline-offset:3px}
.hint{margin:22px 0 0;color:#6c7694;font-size:12px;text-align:center}
@media(max-width:480px){body{padding:16px}.card{padding:28px 22px}.logo-wrap{margin-bottom:25px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important}}
</style></head><body><main class="card"><div class="logo-wrap"><img class="logo" src="/assets/logo.png" alt="KRKL"></div><p class="eyebrow">Plusquam · Milestone delivery</p><h1>Evidence Hub</h1><p class="intro">Sign in to view the project reports and source package.</p>${safeMessage}<form method="post" action="/__hub/login"><div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required maxlength="254"></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"></div><button type="submit">Sign in</button></form><p class="hint">This session expires after 8 hours.</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: headers({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; font-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    }),
  });
}

function sameOrigin(request, url) {
  const candidates = [
    url.host,
    request.headers.get("host"),
    request.headers.get("x-forwarded-host"),
  ].flatMap((value) => (value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value.includes("://") ? value : `https://${value}`).host.toLowerCase();
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  const origin = request.headers.get("origin");
  if (origin !== null) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol === "https:" && candidates.includes(parsed.host.toLowerCase())) return true;
    } catch {
      // Fall back to browser metadata when Origin cannot be parsed.
    }
    // Vercel can rewrite every request host while preserving the public Origin.
    return request.headers.get("sec-fetch-site") === "same-origin";
  }

  // Some Vercel proxy requests omit Origin. Browser fetch metadata or Referer
  // still has to prove that the POST came from this exact host.
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "same-origin") return true;
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    const parsed = new URL(referer);
    return parsed.protocol === "https:" && candidates.includes(parsed.host.toLowerCase());
  } catch {
    return false;
  }
}

function methodNotAllowed() {
  return new Response("Method not allowed", {
    status: 405,
    headers: headers({ Allow: "GET, HEAD, POST", "Content-Type": "text/plain; charset=utf-8" }),
  });
}

export default async function proxy(request) {
  const url = new URL(request.url);
  const { email, password, sessionSecret, configured } = settings();

  // The login screen uses only the local KRKL logo and Numans font. Keep this
  // unauthenticated allowlist narrow; all other files still require a session.
  if ((request.method === "GET" || request.method === "HEAD") && LOGIN_PUBLIC_ASSETS.has(url.pathname)) {
    return next();
  }

  if (url.pathname === "/login" || url.pathname === "/login.html") {
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
    if (!configured) {
      return loginPage({
        status: 503,
        message: "Access is not configured yet. Please contact the Hub administrator.",
      });
    }
    if (sessionIsValid(request, sessionSecret)) return redirect("/");
    return loginPage({ message: url.searchParams.has("signedout") ? "You have been signed out." : "" });
  }

  if (url.pathname === "/__hub/login") {
    if (request.method !== "POST") return methodNotAllowed();
    if (!sameOrigin(request, url)) return new Response("Forbidden", { status: 403, headers: headers() });
    if (!configured) {
      return loginPage({
        status: 503,
        message: "Access is not configured yet. Please contact the Hub administrator.",
      });
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_LOGIN_BODY_BYTES) return new Response("Request too large", { status: 413, headers: headers() });
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
      return new Response("Unsupported content type", { status: 415, headers: headers() });
    }
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_LOGIN_BODY_BYTES) {
      return new Response("Request too large", { status: 413, headers: headers() });
    }
    const form = new URLSearchParams(body);
    const submittedEmail = (form.get("email") ?? "").trim().toLowerCase();
    const submittedPassword = form.get("password") ?? "";
    const validEmail = constantTimeTextEqual(submittedEmail, email);
    const validPassword = constantTimeTextEqual(submittedPassword, password);
    if (!validEmail || !validPassword) {
      return loginPage({ status: 401, message: "Email or password is incorrect." });
    }

    return redirect("/", {
      "Set-Cookie": `${COOKIE_NAME}=${createSession(sessionSecret)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
    });
  }

  if (url.pathname === "/__hub/logout") {
    if (request.method !== "POST") return methodNotAllowed();
    if (!sameOrigin(request, url)) return new Response("Forbidden", { status: 403, headers: headers() });
    return redirect("/login?signedout=1", {
      "Set-Cookie": `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    });
  }

  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
  if (!configured) return redirect("/login");
  if (!sessionIsValid(request, sessionSecret)) return redirect("/login");

  // Middleware runs before Vercel's static cache, so every asset and document
  // request is authenticated before the static file can be served.
  return next({ headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
