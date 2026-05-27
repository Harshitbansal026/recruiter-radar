# API Keys

This project uses API keys through environment variables. Real secrets must stay in `.env` or the deployment platform's secret manager and must not be committed to Git.

## Required For Phase 1

### Apify

- Variable: `APIFY_TOKEN`
- Used for: running the `supreme_coder/linkedin-post` actor.
- Cost note: actor usage may consume Apify credits, so scraping must use tight limits and cached results.

## Optional Later

### Gemini

- Variable: `GEMINI_API_KEY`
- Used for: structured AI extraction and summarization.

### OpenAI

- Variable: `OPENAI_API_KEY`
- Used for: optional AI extraction or cold email draft generation.

### Email Providers

- Variables: `RESEND_API_KEY`, `SENDGRID_API_KEY`, `MAILGUN_API_KEY`
- Used for: reviewed email sending in later phases.

## Learning Note

An environment variable is a value provided outside the code. It is commonly used for secrets like API keys so the code can be shared publicly without exposing private credentials.

