# Plusquam Staging Source

This package contains the Plusquam staging backend and frontend source.

## Project folders

- `plusquam/api/` — AWS SAM templates, API handlers, and backend dependencies.
- `plusquam/scripts/` — staging deployment and setup scripts.
- `plusquam-frontend/app/` — React application source and locked dependencies.
- `plusquam-frontend/public/` — public pages, assets, and sign-in files.

## Runtime responsibilities

The application SAM template defines CorsFunction, AuthFunction, ProjectsFunction, AdminFunction, and AssessFunction. The separate `api/zap-security.template.json` defines `PublicNotFoundFunction` (physical name `plusquam-staging-public-not-found`), the public GET 404 fallback used by the staging ZAP configuration. AssessFunction handles assessment start, status, results, and report PDF routes. ProjectsFunction handles project and user-state routes.

All five DynamoDB tables enable server-side encryption. Point-in-time recovery is enabled on the projects, assessments, and users tables only.

## Evaluation and landing copy

The frozen model evaluation was prompt-level and offline. Its evaluation data and scoring harness are not part of this source package; it does not measure the full live workflow, which adds query generation and OpenAlex retrieval. The report’s accuracy, borderline-share, and precision thresholds are proposed monitoring, not implemented alerts.

The included landing-page source names OpenAlex as the literature provider. This copy update is in the downloadable source only and has not been deployed to staging.

## Build inputs

The frontend lockfile and backend `requirements.txt` are included. Generated build folders and installed dependencies are omitted.
