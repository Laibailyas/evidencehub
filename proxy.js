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
<title>Sign in · Plusquam Evidence Hub</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f5fb;color:#182033;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}.card{width:min(100% - 32px,430px);padding:36px;border:1px solid #e0e5f2;border-radius:22px;background:#fff;box-shadow:0 24px 70px #25366a18}.brand{margin:0 0 5px;color:#1745d1;font-size:14px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}h1{margin:0 0 8px;font-size:28px;letter-spacing:-.03em}p{margin:0 0 22px;color:#59657a}.field{display:grid;gap:6px;margin:16px 0}.field label{font-size:13px;font-weight:700}.field input{width:100%;padding:12px 14px;border:1px solid #cbd3e1;border-radius:10px;font:inherit}.field input:focus{outline:3px solid #1745d133;border-color:#1745d1}button{width:100%;margin-top:8px;padding:13px;border:0;border-radius:10px;background:#1745d1;color:#fff;font:inherit;font-weight:750;cursor:pointer}.message{margin:0 0 14px;padding:10px 12px;border-radius:9px;background:#fff0f0;color:#9a2525}.hint{margin:18px 0 0;font-size:12px;color:#758096}
</style></head><body><main class="card"><p class="brand">KRKL · Plusquam</p><h1>Evidence Hub</h1><p>Sign in to view the project reports and source package.</p>${safeMessage}<form method="post" action="/__hub/login"><div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required maxlength="254"></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"></div><button type="submit">Sign in</button></form><p class="hint">This session expires after 8 hours.</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: headers({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    }),
  });
}

function sameOrigin(request, url) {
  return request.headers.get("origin") === url.origin;
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
