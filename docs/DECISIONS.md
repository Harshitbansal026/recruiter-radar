# Project Decisions

## Initial Script Language

We will start with TypeScript running on Node.js for the CSV-based pipeline.

Reasons:

- The final app will use Next.js with TypeScript, so starting with TypeScript reduces context switching.
- Scraper and validation logic can later move into Next.js API routes or backend workers more easily.
- TypeScript teaches types early, which makes larger codebases easier to reason about.
- Node.js has strong support for API calls, filesystem operations, CSV parsing, DNS lookup, and email-related networking.

This means the project starts with scripts but still follows the same language direction as the final full-stack app.

## Data Source Order

1. Apify LinkedIn post scraper for hiring posts and domain signals.
2. Custom extraction and confidence scoring.
3. Firecrawl only as fallback when domain information is missing or weak.

## Verification Language

The app should use confidence language instead of absolute validation language.

Preferred:

- high confidence
- medium confidence
- low confidence
- risky
- unknown
- invalid

Avoid:

- guaranteed valid
- definitely correct
- 100% verified
