# Project Decisions

## Initial Script Language

We will start with Python for the CSV-based pipeline.

Reasons:

- Python has strong built-in CSV support.
- It is beginner-friendly for scripts.
- DNS, email parsing, and data-cleaning libraries are mature.
- It lets us prove the backend pipeline before building the Next.js dashboard.

Later, the product UI will use Next.js with TypeScript.

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

