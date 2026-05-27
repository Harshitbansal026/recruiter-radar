import { readFile } from "node:fs/promises";
import path from "node:path";

type CompanyRow = {
  company_name: string;
  linkedin_company_url: string;
  linkedin_search_url: string;
  identified_domains: string;
  email_domains: string;
  career_domains: string;
  job_board_domains: string;
  domain_confidence: string;
  skip_domain_scrape: string;
  last_scraped_at: string;
  status: string;
};

const REQUIRED_COLUMNS: Array<keyof CompanyRow> = [
  "company_name",
  "linkedin_company_url",
  "linkedin_search_url",
  "identified_domains",
  "email_domains",
  "career_domains",
  "job_board_domains",
  "domain_confidence",
  "skip_domain_scrape",
  "last_scraped_at",
  "status",
];

function parseCsvLine(line: string): string[] {
  return line.split(",").map((value) => value.trim());
}

function parseCompaniesCsv(csvText: string): CompanyRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV must include a header row and at least one company row.");
  }

  const headers = parseCsvLine(lines[0]);
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));

  if (missingColumns.length > 0) {
    throw new Error(`CSV is missing required columns: ${missingColumns.join(", ")}`);
  }

  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(
      headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]),
    ) as CompanyRow;

    if (!row.company_name) {
      throw new Error(`Row ${index + 2} is missing company_name.`);
    }

    if (!row.linkedin_company_url && !row.linkedin_search_url) {
      throw new Error(
        `Row ${index + 2} (${row.company_name}) must include linkedin_company_url or linkedin_search_url.`,
      );
    }

    return row;
  });
}

function toBoolean(value: string): boolean {
  return value.toLowerCase() === "true";
}

async function main() {
  const csvPath = path.resolve("data/input/companies.sample.csv");
  const csvText = await readFile(csvPath, "utf8");
  const companies = parseCompaniesCsv(csvText);

  console.log(`Loaded ${companies.length} companies from ${csvPath}`);

  for (const company of companies) {
    const skipDomainScrape = toBoolean(company.skip_domain_scrape);
    const sourceUrl = company.linkedin_company_url || company.linkedin_search_url;

    console.log({
      company: company.company_name,
      sourceUrl,
      status: company.status || "pending",
      skipDomainScrape,
      identifiedDomains: company.identified_domains || "none",
    });
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});

