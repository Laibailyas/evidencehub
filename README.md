# Plusquam Evidence Hub

Open `index.html` to review the Plusquam staging evidence, reports, model comparison and Visual Pack, and downloadable staging source.

## Model evaluation scope

The frozen 96.2% evaluation is a prompt-level offline result, not an end-to-end result for the deployed assessment workflow. The live workflow adds Qwen-generated search-query creation and OpenAlex literature retrieval. The evaluation dataset and scoring harness are not included in this package, so the run cannot be reproduced from this archive. The report’s accuracy, borderline-share, and precision alert thresholds are proposed monitoring, not deployed alerts.

## Source package

The source archive contains five functions in the SAM application template plus `PublicNotFoundFunction` (`plusquam-staging-public-not-found`), the public GET 404 fallback in `zap-security.template.json` used by the staging ZAP configuration. All five DynamoDB tables enable server-side encryption; point-in-time recovery is enabled only for projects, assessments, and users. The bundled landing-page source now names OpenAlex only. This copy correction has not been deployed to the live staging site.

## Contents

- `reports/` — security audit, UAT report, model reports, and Visual Pack.
- `assets/visuals/` — four visuals in high-resolution PNG, SVG, and preview formats.
- `code/Plusquam-Staging-Deployment/` — backend and frontend source.
- `code/Plusquam_Staging_Source_Code.zip` — downloadable source package.
- `proxy.js`, `vercel.json`, and `package.json` — server-side Vercel sign-in gate.
