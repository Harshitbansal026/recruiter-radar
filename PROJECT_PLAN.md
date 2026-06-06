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
- [x] Support company CSV fields:
  - `company_name`
  - `company_aliases`
  - `linkedin_company_url`
  - `linkedin_search_url`
  - `official_domains`
  - `old_domains`
  - `email_domains`
  - `career_domains`
  - `job_board_domains`
  - `job_board_slugs`
  - `domain_confidence`
  - `skip_domain_scrape`
  - `last_scraped_at`
  - `status`
- [x] Support company identity fields:
  - `company_aliases`
  - `official_domains`
  - `old_domains`
  - `email_domains`
  - `career_domains`
  - `job_board_slugs`
- [x] Integrate Apify actor `supreme_coder/linkedin-post`.
- [x] Use tight scrape parameters:
  - low `limitPerSource`
  - date boundary with `scrapeUntil`
  - `deepScrape` disabled by default
  - `rawData` disabled by default
- [x] Make scraping incremental using `last_scraped_at`.
- [x] Cache raw or normalized Apify results locally.
- [x] Avoid re-scraping companies with `skip_domain_scrape = true` when domain data is already strong.

## Phase 2: Domain and Email Extraction

Goal: Extract only high-trust company-related contact and domain intelligence from scraped post data.

- [x] Extract visible emails from post text.
- [x] Extract domains from emails.
- [x] Extract domains from URLs and apply links in posts.
- [x] Classify domains:
  - primary company domain
  - email domain
  - career domain
  - job-board domain
  - unrelated domain
- [x] Identify and ignore non-company email domains where appropriate.
- [x] Track source post URL and source text snippet.
- [ ] Build a company identity graph from company names, aliases, official domains, old domains, email domains, career domains, job-board slugs, and source evidence.
- [x] Process only high-trust company-related posts/pages:
  - official company page
  - author clearly works at target company
  - email/domain matches company identity
  - official company/career domain appears
- [x] Ignore external agencies, staffing agents, random hiring posters, personal email domains, and posts with only company-name mentions but no company proof.
- [x] Exclude personal/free email domains from all contact CSV outputs.
- [x] Exclude job-board, LinkedIn, URL shortener, and unrelated external domains from candidate email domains.
- [ ] Add domain confidence scoring.
- [ ] Update company CSV with identified domains.
- [x] Produce `all_contacts.csv`.
- [x] Produce `qualified_contacts.csv` using confidence thresholds.

## Phase 3: Firecrawl Company Identity Enrichment

Goal: Use Firecrawl as a fallback/enrichment source to discover official company identity when Apify/LinkedIn data is incomplete.

- [ ] Use Firecrawl only when company identity is missing or low confidence.
- [ ] Scrape/search official company websites, careers pages, contact pages, about/team pages, and blog/author pages.
- [ ] Discover and classify:
  - official domains
  - old/rebranded domains
  - email domains
  - career domains
  - job-board links/slugs
  - company aliases
- [ ] Exclude job-board, URL shortener, personal email, and unrelated external domains from candidate email domains.
- [ ] Cache Firecrawl responses locally.
- [ ] Add Firecrawl result source URLs and confidence reasons to the company identity graph.
- [ ] Keep Firecrawl calls low-volume and targeted to control credit usage.

## Phase 4: Company-Affiliated Contact Discovery and Email Generation

Goal: Turn company identity and domain intelligence into clean, company-affiliated contact candidates and work-email candidates.

- [x] Remove keyword-based outreach-context fields from main CSV outputs:
  - `contactContext`
  - `isHiringContext`
  - `matchedContextKeywords`
- [x] Decide whether a person/contact belongs to the target company using company identity, author fields, profile fields, source URL, and source domains.
- [x] Extract recruiter/person names when available from post author fields, profile fields, or post text.
- [x] Extract recruiter/person roles or titles when available.
- [x] Link recruiter/person candidates to company domains and source evidence.
- [x] Keep company-affiliated people even when their visible email is personal, but do not keep the personal email as an outreach email.
- [x] Infer company email patterns from directly found company emails:
  - `first.last@domain`
  - `first@domain`
  - `firstlast@domain`
  - `first_initial_last@domain`
  - `first_last@domain`
- [x] Prioritize inferred company email patterns before fallback patterns when generating emails for other company-affiliated people.
- [x] Generate candidate email patterns from recruiter/person names and verified company email domains:
  - `first.last@domain`
  - `first@domain`
  - `firstlast@domain`
  - `first_initial_last@domain`
  - `first_last@domain`
- [x] Mark generated emails as inferred, not directly verified.
- [x] Preserve source URLs and reasoning for every generated candidate email.
- [x] Add generated company-affiliated contact candidates to `all_contacts.csv`.
- [x] Add only high-confidence company-affiliated contact candidates to `qualified_contacts.csv`.

## Phase 5: Custom Email Confidence Service

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

## Phase 6: Next.js Dashboard

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

## Phase 7: PostgreSQL Persistence

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

## Phase 8: AI Extraction and Scoring

Goal: Use an LLM carefully for structured extraction and summaries.

- [ ] Add Gemini API first because of free-tier availability.
- [ ] Keep OpenAI optional.
- [ ] Extract recruiter/hiring context from post text.
- [ ] Improve recruiter/person extraction from messy post text and actor output.
- [ ] Improve candidate email pattern selection using confirmed company email patterns.
- [ ] Use schema-validated structured JSON output.
- [ ] Reject extracted contacts without source evidence.
- [ ] Add confidence reasoning:
  - source found
  - HR/recruiter context
  - domain match
  - MX valid
  - public email found
- [ ] Add safeguards against hallucinated contacts.

## Phase 9: Cold Email Drafting

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

## Phase 10: Email Sending

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

## Phase 11: Deployment and Resume Polish

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
- Apify Free plan currently includes $5 monthly platform usage credits; the LinkedIn post actor is pay-per-event and listed as "$1 per 1k" on its Apify page.
- HarvestAPI `harvestapi/linkedin-profile-posts` is the current replacement test actor; treat its cost as USD 2 per 1,000 posts.
- Firecrawl Free plan currently includes 1,000 credits/month; scrape/crawl/map cost 1 credit per page and search costs 2 credits per 10 results.
- Firecrawl has no pure pay-per-use monthly plan; upgrade tiers are monthly subscriptions, so the project should use Firecrawl only as targeted fallback/enrichment.
- Actor output shape may change.
- Live Apify result caching is implemented and verified with `harvestapi/linkedin-profile-posts` using an HCLTech low-limit run on June 4, 2026.
- Live Apify test on June 3, 2026 with HCLTech returned zero items while the actor page showed "Actor is under maintenance"; avoid repeated live retries until the actor is stable or a replacement actor is selected.
- Scraper code now supports actor-specific Apify input adapters so the project can switch between `supreme_coder/linkedin-post` and `harvestapi/linkedin-profile-posts`.
- HarvestAPI live output uses `linkedinUrl`, `content`, and nested `author` fields; extraction mapping is implemented and verified against the HCLTech cache.
- LinkedIn scraping has platform and compliance risk; use public data only and low volume.
- Many posts will not contain emails.
- Strict company-trust filtering may reduce contact volume but should improve output quality.
- Current high-trust filtering uses company-name and company-domain matching from cached post data; full alias/domain identity graph enrichment is still pending.
- Company identity matching can fail for acquisitions, rebrands, abbreviations, and unusual domains unless aliases/domains are maintained.
- Email verification cannot guarantee mailbox validity.
- SMTP checks may be blocked by mail servers or hosting providers.
- Serverless platforms may block outbound SMTP.
- Firecrawl remains optional fallback for domain discovery, not the first source.
- Firecrawl should enrich company identity, not replace Apify's LinkedIn hiring/post signal pipeline.
- Recruiter/person email generation must be clearly labeled as inferred unless directly found in source text.
- Personal emails should not be exported as outreach emails; company-affiliated people with personal emails can still be used for company-domain candidate email generation.
- Job-board domains are source evidence only and must not be used as candidate email domains.
- LLMs can hallucinate unless source-backed extraction is enforced.
- Cold email sending can affect sender reputation if used aggressively.

## Current Decisions

- Project name: RecruiterRadar.
- Initial data source: Apify `supreme_coder/linkedin-post`.
- Current Apify status: `supreme_coder/linkedin-post` is under maintenance as of June 3, 2026, so live scraping is paused to avoid wasting credits.
- Current replacement Apify test actor: `harvestapi/linkedin-profile-posts`.
- HarvestAPI live test result: HCLTech company URL with `maxPosts = 3` returned 3 posts and cached successfully on June 4, 2026.
- HarvestAPI extraction test result: HCLTech cache produced 0 contacts and 1 company career domain (`careers.hcltech.com`), confirming the pipeline does not invent contacts from marketing/career-branding posts.
- Initial scope: 30 companies.
- Firecrawl role: fallback only when domain is not identified from LinkedIn/post data.
- Email verification strategy: custom confidence service first, third-party APIs optional.
- Export strategy: all contacts and qualified contacts.
- Product positioning: recruiter discovery and outreach assistant, not a spam or bulk-scraping tool.
- Company identity graph, high-trust source filtering, and company-affiliated generated candidate emails are core project features, not optional add-ons.
- Main CSV outputs should stay clean and exclude agency/external/personal-email noise.
- Initial script language: TypeScript running on Node.js.
- Decision update: The initial script language was changed from Python to TypeScript before Phase 1 so the scraper pipeline and future Next.js app use the same language.

## Commit Log

- `fabdaca` - Initial project setup.
- `df60c7b` - Update plan commit log.
- `ea811ec` - Use TypeScript for initial scripts.
- `1880ec9` - Add TypeScript CSV company reader.
- `c4cc141` - Add Apify dry run payload builder.
- `a4942f1` - Save Apify dry run payload cache.
- `fe25e57` - Cache live Apify run results.
- `63fa072` - Add single company scrape filter.
- `022acdf` - Lower default LinkedIn scrape limit.
- `e01843b` - Add configurable scrape limit.
- `6ac6eb5` - Add cached post contact extraction.
- `5bde83c` - Extract domains from cached posts.
- `0d39f36` - Classify job board domains.
- `665e10b` - Filter personal email domains from qualified contacts.
- `593b70a` - Add scrape command help.
- `b83b500` - Skip companies with known domains.
- `7ec6932` - Demonstrate incremental scrape boundary.
- `f9a68ea` - Add recruiter email generation phase.
- `9a0641c` - Detect hiring context for extracted emails.
- `a34e1de` - Classify outreach context for contacts.
- `02270b8` - Extract contact person identity fields.
- `34e5361` - Clarify high-trust company identity plan.
- `c50543c` - Add Firecrawl company identity phase.
- `87dca3e` - Apply high-trust contact filtering.
- `0d80080` - Update plan log for contact filtering.
- `f80a5f0` - Add HarvestAPI actor support.
