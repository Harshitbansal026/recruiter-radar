# RecruiterRadar

RecruiterRadar is an AI-assisted recruiter discovery and outreach tool for job seekers.

The project starts with a CSV-based pipeline that uses public LinkedIn post data through Apify to identify hiring-related posts, extract visible recruiter emails and company domains, score email confidence, and export useful outreach lists. Later phases will add a dashboard, database persistence, AI extraction, and reviewed email sending.

## Initial Scope

- Work with up to 30 target companies.
- Use Apify `supreme_coder/linkedin-post` as the first data source.
- Extract only publicly visible emails and domain signals.
- Build a custom email confidence service using syntax, DNS, MX, and limited SMTP checks.
- Export all contacts and qualified contacts separately.

## Project Goals

- Build a resume-worthy full-stack project.
- Learn practical software engineering from scratch.
- Keep scraping and outreach low-volume, source-backed, and reviewable.

## Current Status

Phase 0 setup is in progress.

## Current Script Commands

Run TypeScript checks:

```bash
npm run typecheck
```

Build dry-run Apify payloads for every company in the sample CSV:

```bash
npm run scrape:linkedin:dry
```

Build a dry-run payload for one company:

```bash
npm run scrape:linkedin:dry -- "Example Company"
```

Override the default post limit for a dry-run:

```bash
npm run scrape:linkedin:dry -- "Example Company" 3
```

Live scraping requires a local `.env` file with `APIFY_TOKEN`. Do not run the live command until the token and test company are confirmed.
