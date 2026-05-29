# RecruiterRadar Project Plan

RecruiterRadar is an AI-assisted recruiter discovery and outreach tool for job seekers. It will identify recruiter/hiring contacts from public company and LinkedIn post data, discover company domains, score email confidence, export qualified contacts, and later support cold email drafting/sending.

## Mandatory Workflow Rule

Before every commit:

1. Open and review this file.
2. Update phase/task checkboxes for completed work.
3. Add any new blockers, risks, or decisions discovered.
4. Confirm no completed task is left unchecked.

After every commit:

1. Open and review this file again.
2. Add the commit hash/message under the commit log.
3. Confirm the plan still matches the current codebase.

No project commit should be considered complete unless this file has been checked before and after the commit.

## Phase 0: Project Setup

- [x] Create Git repository.
- [x] Add README with project summary.
- [x] Add `.gitignore`.
- [x] Decide initial implementation language for scripts.
- [x] Create sample company input CSV.
- [x] Add environment variable template.
- [x] Document required API keys and optional API keys.

## Phase 1: CSV-Based Apify LinkedIn Post Scraper

Goal: Prove the data pipeline before building the full UI.

- [x] Accept a CSV of up to 30 companies.
- [x] Support company fields:
  - `company_name`
  - `linkedin_company_url`
  - `linkedin_search_url`
  - `identified_domains`
  - `email_domains`
  - `career_domains`
  - `job_board_domains`
  - `domain_confidence`
  - `skip_domain_scrape`
  - `last_scraped_at`
  - `status`
- [ ] Integrate Apify actor `supreme_coder/linkedin-post`.
- [x] Use tight scrape parameters:
  - low `limitPerSource`
  - date boundary with `scrapeUntil`
  - `deepScrape` disabled by default
  - `rawData` disabled by default
- [ ] Make scraping incremental using `last_scraped_at`.
- [ ] Cache raw or normalized Apify results locally.
- [ ] Avoid re-scraping companies with `skip_domain_scrape = true` when domain data is already strong.

## Phase 2: Domain and Email Extraction

Goal: Extract useful contact and domain intelligence from scraped post data.

- [ ] Extract visible emails from post text.
- [ ] Extract domains from emails.
- [ ] Extract domains from URLs and apply links in posts.
- [ ] Classify domains:
  - primary company domain
  - email domain
  - career domain
  - job-board domain
  - unrelated domain
- [ ] Identify and ignore non-company email domains where appropriate.
- [ ] Track source post URL and source text snippet.
- [ ] Add domain confidence scoring.
- [ ] Update company CSV with identified domains.
- [ ] Produce `all_contacts.csv`.
- [ ] Produce `qualified_contacts.csv` using confidence thresholds.

## Phase 3: Custom Email Confidence Service

Goal: Build our own email confidence layer without depending on third-party verification APIs.

- [ ] Validate email syntax.
- [ ] Check whether the domain exists.
- [ ] Check MX records.
- [ ] Add free/disposable domain detection.
- [ ] Detect likely catch-all domains where possible.
- [ ] Add limited SMTP handshake checks:
  - connect to MX server
  - send `HELO` or `EHLO`
  - send `MAIL FROM`
  - send `RCPT TO`
  - stop before sending message data
- [ ] Return statuses:
  - `high_confidence`
  - `medium_confidence`
  - `low_confidence`
  - `risky`
  - `invalid`
  - `unknown`
- [ ] Cache all verification results.
- [ ] Add low concurrency and rate limits.
- [ ] Document that SMTP probing does not guarantee mailbox validity.

Cost notes:

- DNS/MX lookup cost: free.
- Local SMTP probing code cost: free.
- Possible infrastructure cost: a small VPS may be needed if hosting providers block outbound SMTP, usually around USD 4-6/month.
- Third-party verification APIs are optional fallback only, not part of the core plan.

## Phase 4: Next.js Dashboard

Goal: Turn the pipeline into a usable product interface.

- [ ] Create Next.js app with TypeScript.
- [ ] Add Tailwind CSS.
- [ ] Build company input/upload screen.
- [ ] Build run status screen.
- [ ] Build company domain intelligence table.
- [ ] Build contacts table.
- [ ] Add confidence badges.
- [ ] Add source post links/snippets.
- [ ] Add filters for company, confidence, status, and domain.
- [ ] Add export buttons:
  - export all contacts
  - export qualified contacts
  - export selected contacts

## Phase 5: PostgreSQL Persistence

Goal: Replace CSV-only state with a real database.

- [ ] Add PostgreSQL using Supabase, Neon, or local Postgres.
- [ ] Add Prisma ORM.
- [ ] Design tables:
  - companies
  - scrape_runs
  - domains
  - posts
  - contacts
  - email_checks
  - exports
- [ ] Add migrations.
- [ ] Store scrape state for incremental runs.
- [ ] Store source evidence for every contact/domain.
- [ ] Keep CSV import/export support.

## Phase 6: AI Extraction and Scoring

Goal: Use an LLM carefully for structured extraction and summaries.

- [ ] Add Gemini API first because of free-tier availability.
- [ ] Keep OpenAI optional.
- [ ] Extract recruiter/hiring context from post text.
- [ ] Use schema-validated structured JSON output.
- [ ] Reject extracted contacts without source evidence.
- [ ] Add confidence reasoning:
  - source found
  - HR/recruiter context
  - domain match
  - MX valid
  - public email found
- [ ] Add safeguards against hallucinated contacts.

## Phase 7: Cold Email Drafting

Goal: Generate useful outreach drafts without sending automatically at first.

- [ ] Add cold email template system.
- [ ] Generate personalized drafts from:
  - candidate profile summary
  - company
  - role/job context
  - recruiter/contact context
- [ ] Add multiple tone options.
- [ ] Add manual edit UI.
- [ ] Add opt-out line support.
- [ ] Store generated drafts.

## Phase 8: Email Sending

Goal: Send reviewed outreach emails safely.

- [ ] Choose email provider:
  - Resend
  - SendGrid
  - Mailgun
  - Gmail API
  - Amazon SES
- [ ] Add manual send button only.
- [ ] Track send status.
- [ ] Track bounces where provider supports it.
- [ ] Add follow-up reminders.
- [ ] Add follow-up sending later.
- [ ] Add safeguards:
  - low daily send limits
  - no bulk auto-send by default
  - only send to qualified contacts unless overridden

## Phase 9: Deployment and Resume Polish

Goal: Make the project presentable for recruiters and interviews.

- [ ] Deploy frontend.
- [ ] Deploy backend/API routes.
- [ ] Configure production environment variables.
- [ ] Add demo mode using sample data.
- [ ] Add screenshots to README.
- [ ] Add architecture diagram.
- [ ] Add limitations and ethical usage section.
- [ ] Add resume bullets.
- [ ] Prepare interview explanation:
  - architecture
  - scraping strategy
  - email confidence logic
  - cost controls
  - compliance limitations
  - future improvements

## Known Risks and Constraints

- Apify actor usage may require paid credits.
- Actor output shape may change.
- Live Apify result caching is implemented in code but still needs verification with a real `APIFY_TOKEN` and one low-limit live run.
- LinkedIn scraping has platform and compliance risk; use public data only and low volume.
- Many posts will not contain emails.
- Email verification cannot guarantee mailbox validity.
- SMTP checks may be blocked by mail servers or hosting providers.
- Serverless platforms may block outbound SMTP.
- Firecrawl remains optional fallback for domain discovery, not the first source.
- LLMs can hallucinate unless source-backed extraction is enforced.
- Cold email sending can affect sender reputation if used aggressively.

## Current Decisions

- Project name: RecruiterRadar.
- Initial data source: Apify `supreme_coder/linkedin-post`.
- Initial scope: 30 companies.
- Firecrawl role: fallback only when domain is not identified from LinkedIn/post data.
- Email verification strategy: custom confidence service first, third-party APIs optional.
- Export strategy: all contacts and qualified contacts.
- Product positioning: recruiter discovery and outreach assistant, not a spam or bulk-scraping tool.
- Initial script language: TypeScript running on Node.js.
- Decision update: The initial script language was changed from Python to TypeScript before Phase 1 so the scraper pipeline and future Next.js app use the same language.

## Commit Log

- `fabdaca` - Initial project setup.
- `df60c7b` - Update plan commit log.
- `ea811ec` - Use TypeScript for initial scripts.
- `1880ec9` - Add TypeScript CSV company reader.
- `c4cc141` - Add Apify dry run payload builder.
- `a4942f1` - Save Apify dry run payload cache.
