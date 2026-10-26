import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import proxy from "../proxy.js";

const savedEnv = {
  email: process.env.HUB_LOGIN_EMAIL,
  password: process.env.HUB_LOGIN_PASSWORD,
  secret: process.env.HUB_SESSION_SECRET,
};

function setTestCredentials() {
  process.env.HUB_LOGIN_EMAIL = "reviewer@example.invalid";
  process.env.HUB_LOGIN_PASSWORD = ["synthetic", "test", "password", "only"].join("-");
  process.env.HUB_SESSION_SECRET = ["synthetic-test-session-secret", "0123456789abcdef"].join("-");
}

function restoreEnv() {
  const pairs = [
    ["HUB_LOGIN_EMAIL", savedEnv.email],
    ["HUB_LOGIN_PASSWORD", savedEnv.password],
    ["HUB_SESSION_SECRET", savedEnv.secret],
  ];
  for (const [key, value] of pairs) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function request(path, { url = `https://hub.example.invalid${path}`, method = "GET", headers = {}, body } = {}) {
  return new Request(url, { method, headers, body });
}

afterEach(restoreEnv);

describe("Evidence Hub access gate", () => {
  it("fails closed until deployment credentials are configured", async () => {
    delete process.env.HUB_LOGIN_EMAIL;
    delete process.env.HUB_LOGIN_PASSWORD;
    delete process.env.HUB_SESSION_SECRET;
    const result = await proxy(request("/reports/UAT_Report.pdf"));
    assert.equal(result.status, 303);
    assert.equal(result.headers.get("location"), "/login");
    const login = await proxy(request("/login"));
    assert.equal(login.status, 503);
    assert.match(await login.text(), /not configured/i);
  });

  it("renders the login page with the local KRKL logo and Numans font", async () => {
    setTestCredentials();
    const result = await proxy(request("/login"));
    const html = await result.text();
    assert.equal(result.status, 200);
    assert.match(html, /assets\/logo\.png/);
    assert.match(html, /assets\/Numans-Regular\.ttf/);
    assert.match(html, /font-family:Numans/);
    assert.match(result.headers.get("content-security-policy"), /img-src 'self'/);
    assert.match(result.headers.get("content-security-policy"), /font-src 'self'/);
  });

  it("allows only the local logo and font through before sign-in", async () => {
    setTestCredentials();
    for (const path of ["/assets/logo.png", "/assets/Numans-Regular.ttf"]) {
      const result = await proxy(request(path));
      assert.equal(result.status, 200, path);
    }
    const otherAsset = await proxy(request("/assets/visuals/01_System_Architecture.png"));
    assert.equal(otherAsset.status, 303);
    assert.equal(otherAsset.headers.get("location"), "/login");
  });

  it("rejects unauthenticated requests to all static paths", async () => {
    setTestCredentials();
    for (const path of ["/", "/assets/visuals/01_System_Architecture.png", "/reports/UAT_Report.pdf", "/code/source.zip"]) {
      const result = await proxy(request(path));
      assert.equal(result.status, 303, path);
      assert.equal(result.headers.get("location"), "/login", path);
      assert.match(result.headers.get("cache-control"), /no-store/, path);
    }
  });

  it("authenticates same-origin credentials and issues a protected session cookie", async () => {
    setTestCredentials();
    const body = new URLSearchParams({
      email: "reviewer@example.invalid",
      password: ["synthetic", "test", "password", "only"].join("-"),
    });
    const result = await proxy(request("/__hub/login", {
      method: "POST",
      headers: {
        origin: "https://hub.example.invalid",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    }));
    assert.equal(result.status, 303);
    assert.equal(result.headers.get("location"), "/");
    const cookie = result.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /reviewer@example|synthetic-test/);
  });

  it("accepts the browser host when Vercel reports an internal request URL", async () => {
    setTestCredentials();
    const body = new URLSearchParams({
      email: "reviewer@example.invalid",
      password: ["synthetic", "test", "password", "only"].join("-"),
    });
    const result = await proxy(request("/__hub/login", {
      url: "https://internal-vercel.invalid/__hub/login",
      method: "POST",
      headers: {
        host: "evidencehub-fawn.vercel.app",
        origin: "https://evidencehub-fawn.vercel.app",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    }));
    assert.equal(result.status, 303);
    assert.equal(result.headers.get("location"), "/");
    assert.match(result.headers.get("set-cookie"), /HttpOnly/);
  });

  it("accepts same-origin browser metadata with a public Origin and internal Vercel hosts", async () => {
    setTestCredentials();
    for (const origin of ["https://evidencehub-fawn.vercel.app", "invalid-origin"]) {
      const result = await proxy(request("/__hub/login", {
        url: "https://internal-vercel.invalid/__hub/login",
        method: "POST",
        headers: {
          host: "internal-vercel.invalid",
          "x-forwarded-host": "internal-vercel.invalid",
          origin,
          "sec-fetch-site": "same-origin",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: "reviewer@example.invalid",
          password: ["synthetic", "test", "password", "only"].join("-"),
        }),
      }));
      assert.equal(result.status, 303, origin);
      assert.equal(result.headers.get("location"), "/", origin);
      assert.match(result.headers.get("set-cookie"), /HttpOnly/);
    }
  });

  it("rejects mismatched or malformed Origin without exact same-origin metadata", async () => {
    setTestCredentials();
    for (const origin of ["https://attacker.invalid", "invalid-origin"]) {
      for (const site of ["cross-site", "same-site", "Same-Origin"]) {
        const result = await proxy(request("/__hub/login", {
          method: "POST",
          headers: {
            origin,
            "sec-fetch-site": site,
            referer: "https://hub.example.invalid/login",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ email: "reviewer@example.invalid", password: "wrong-password" }),
        }));
        assert.equal(result.status, 403, `${origin}: ${site}`);
      }
    }
  });

  it("accepts same-origin browser metadata when Origin is omitted", async () => {
    setTestCredentials();
    const body = new URLSearchParams({
      email: "reviewer@example.invalid",
      password: ["synthetic", "test", "password", "only"].join("-"),
    });
    const result = await proxy(request("/__hub/login", {
      method: "POST",
      headers: {
        "sec-fetch-site": "same-origin",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    }));
    assert.equal(result.status, 303);
    assert.equal(result.headers.get("location"), "/");
  });

  it("rejects incorrect credentials and cross-origin login posts", async () => {
    setTestCredentials();
    const wrongBody = new URLSearchParams({ email: "reviewer@example.invalid", password: "wrong-password" });
    const wrong = await proxy(request("/__hub/login", {
      method: "POST",
      headers: { origin: "https://hub.example.invalid", "content-type": "application/x-www-form-urlencoded" },
      body: wrongBody,
    }));
    assert.equal(wrong.status, 401);
    assert.match(await wrong.text(), /Email or password is incorrect/);

    const crossOrigin = await proxy(request("/__hub/login", {
      method: "POST",
      headers: { origin: "https://attacker.invalid", "content-type": "application/x-www-form-urlencoded" },
      body: wrongBody,
    }));
    assert.equal(crossOrigin.status, 403);
  });

  it("allows a valid session through and rejects modified or expired cookies", async () => {
    setTestCredentials();
    const body = new URLSearchParams({ email: "reviewer@example.invalid", password: ["synthetic", "test", "password", "only"].join("-") });
    const login = await proxy(request("/__hub/login", {
      method: "POST",
      headers: { origin: "https://hub.example.invalid", "content-type": "application/x-www-form-urlencoded" },
      body,
    }));
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const allowed = await proxy(request("/reports/UAT_Report.pdf", { headers: { cookie } }));
    assert.equal(allowed.status, 200);
    assert.match(allowed.headers.get("cache-control"), /no-store/);

    const [cookieName, token] = cookie.split("=");
    const tokenParts = token.split(".");
    tokenParts[2] = `${tokenParts[2][0] === "A" ? "B" : "A"}${tokenParts[2].slice(1)}`;
    const modified = await proxy(request("/reports/UAT_Report.pdf", {
      headers: { cookie: `${cookieName}=${tokenParts.join(".")}` },
    }));
    assert.equal(modified.status, 303);
    assert.equal(modified.headers.get("location"), "/login");

    const expiredPayload = `${Math.floor(Date.now() / 1000) - 1}.AAAAAAAAAAAAAAAAAAAAAAAA`;
    const expiredSignature = createHmac("sha256", process.env.HUB_SESSION_SECRET)
      .update(expiredPayload).digest("base64url");
    const expired = await proxy(request("/reports/UAT_Report.pdf", {
      headers: { cookie: `${cookieName}=${expiredPayload}.${expiredSignature}` },
    }));
    assert.equal(expired.status, 303);
    assert.equal(expired.headers.get("location"), "/login");
  });

  it("clears the cookie on same-origin logout", async () => {
    setTestCredentials();
    const result = await proxy(request("/__hub/logout", {
      method: "POST",
      headers: { origin: "https://hub.example.invalid" },
    }));
    assert.equal(result.status, 303);
    assert.equal(result.headers.get("location"), "/login?signedout=1");
    assert.match(result.headers.get("set-cookie"), /Max-Age=0/);
  });
});
