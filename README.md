# Plusquam Evidence Hub

Open `index.html` to review the Plusquam staging evidence. The page includes the security audit, UAT report and fillable sign-off checklist, model reports, Visual Pack, staging links, and a downloadable backend/frontend source package.

## Vercel sign-in gate

The Hub includes a server-side Vercel Routing Middleware gate. Before deploying, add these environment variables in the Vercel project settings for the deployment environment:

- `HUB_LOGIN_EMAIL` — the authorized sign-in email.
- `HUB_LOGIN_PASSWORD` — a strong password of at least 14 characters.
- `HUB_SESSION_SECRET` — a random secret of at least 32 bytes; generate one with `openssl rand -hex 32`.

Redeploy after setting the variables. The middleware fails closed when they are missing. It checks every page, report, image, and source ZIP request before Vercel serves the static file. Successful sign-in creates an eight-hour, secure, HTTP-only, same-site cookie. Credentials are never included in this package. This is one shared email/password gate for the Hub.

Before sharing the Hub publicly, add a Vercel Firewall rate-limit rule for `POST /__hub/login`.

Run the middleware regression checks locally with `npm install` and `npm test`.

## Contents

- `reports/` — security audit, 12/12 UAT report, fillable PDF sign-off checklist, model evaluation/comparison, and Visual Pack.
- `assets/visuals/` — the five individual visuals in PNG, SVG, and preview formats.
- `code/Plusquam-Staging-Deployment/` — browsable backend and frontend source.
- `code/Plusquam_Staging_Source_Code.zip` — downloadable source package.
- `proxy.js`, `vercel.json`, and `package.json` — server-side Vercel sign-in gate and its runtime dependency.

The source package keeps project files and dependency lockfiles while omitting regenerable dependency/build directories. The Hub documents staging work only.
