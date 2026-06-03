import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApifyClient } from "apify-client";
import "dotenv/config";

type CompanyRow = {
  company_name: string;
  company_aliases: string;
  linkedin_company_url: string;
  linkedin_search_url: string;
  official_domains: string;
  old_domains: string;
  email_domains: string;
  career_domains: string;
  job_board_domains: string;
  job_board_slugs: string;
  domain_confidence: string;
  skip_domain_scrape: string;
  last_scraped_at: string;
  status: string;
};

const REQUIRED_COLUMNS: Array<keyof CompanyRow> = [
  "company_name",
  "company_aliases",
  "linkedin_company_url",
  "linkedin_search_url",
  "official_domains",
  "old_domains",
  "email_domains",
  "career_domains",
  "job_board_domains",
  "job_board_slugs",
  "domain_confidence",
  "skip_domain_scrape",
  "last_scraped_at",
  "status",
];

type ApifyLinkedInPostInput = {
  urls: string[];
  limitPerSource: number;
  deepScrape: boolean;
  rawData: boolean;
  scrapeUntil?: string;
};

type CompanyScrapePlan = {
  companyName: string;
  sourceUrl: string;
  status: string;
  skipDomainScrape: boolean;
  knownDomains: string;
  companyAliases: string;
  jobBoardSlugs: string;
  apifyInput: ApifyLinkedInPostInput;
};

type ApifyRunCache = {
  companyName: string;
  actorId: string;
  runId: string;
  datasetId: string;
  itemCount: number;
  input: ApifyLinkedInPostInput;
  items: unknown[];
  cachedAt: string;
};

type RunOptions = {
  isLiveRun: boolean;
  selectedCompanyName?: string;
  limitPerSource: number;
};

const DEFAULT_LIMIT_PER_SOURCE = 5;

function printUsage() {
  console.log(`
RecruiterRadar LinkedIn scrape planner

Commands:
  npm run scrape:linkedin:dry
  npm run scrape:linkedin:dry -- "Example Company"
  npm run scrape:linkedin:dry -- "Example Company" 3
  npm run scrape:linkedin:live -- "Example Company" 3

Notes:
  - Dry-run does not call Apify or spend credits.
  - Live mode requires APIFY_TOKEN in a local .env file.
  - The optional number controls limitPerSource.
`.trim());
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let currentValue = "";
  let isInsideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"' && nextCharacter === '"') {
      currentValue += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      isInsideQuotes = !isInsideQuotes;
      continue;
    }

    if (character === "," && !isInsideQuotes) {
      values.push(currentValue.trim());
      currentValue = "";
      continue;
    }

    currentValue += character;
  }

  values.push(currentValue.trim());

  return values;
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

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getArgValue(flag: string): string | undefined {
  const inlineArg = process.argv.find((argument) => argument.startsWith(`${flag}=`));

  if (inlineArg) {
    return inlineArg.slice(flag.length + 1);
  }

  const flagIndex = process.argv.indexOf(flag);

  if (flagIndex === -1) {
    return undefined;
  }

  return process.argv[flagIndex + 1];
}

function parsePositiveInteger(value: string, label: string): number {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsedValue;
}

function getSelectedCompanyName(args: string[]): string | undefined {
  const explicitCompanyName = getArgValue("--company");

  if (explicitCompanyName) {
    return explicitCompanyName;
  }

  return args
    .find((argument) => !argument.startsWith("--") && argument !== "live" && !/^\d+$/.test(argument));
}

function getRunOptions(): RunOptions {
  const args = process.argv.slice(2);
  const limitArg = getArgValue("--limit");
  const positionalLimitArg = args.find((argument) => /^\d+$/.test(argument));

  return {
    isLiveRun: args.includes("--live"),
    selectedCompanyName: getSelectedCompanyName(args),
    limitPerSource: limitArg || positionalLimitArg
      ? parsePositiveInteger(limitArg || positionalLimitArg || "", "limit")
      : DEFAULT_LIMIT_PER_SOURCE,
  };
}

function filterCompanies(companies: CompanyRow[], companyName?: string): CompanyRow[] {
  if (!companyName) {
    return companies;
  }

  const filteredCompanies = companies.filter(
    (company) => company.company_name.toLowerCase() === companyName.toLowerCase(),
  );

  if (filteredCompanies.length === 0) {
    throw new Error(`No company found matching --company "${companyName}".`);
  }

  return filteredCompanies;
}

function shouldSkipDomainScrape(company: CompanyRow): boolean {
  return toBoolean(company.skip_domain_scrape) && Boolean(getKnownDomains(company));
}

function getKnownDomains(company: CompanyRow): string {
  return [
    company.official_domains,
    company.old_domains,
    company.email_domains,
    company.career_domains,
  ]
    .filter(Boolean)
    .join(";");
}

function buildApifyInput(company: CompanyRow, limitPerSource: number): ApifyLinkedInPostInput {
  const sourceUrl = company.linkedin_company_url || company.linkedin_search_url;
  const input: ApifyLinkedInPostInput = {
    urls: [sourceUrl],
    limitPerSource,
    deepScrape: false,
    rawData: false,
  };

  if (company.last_scraped_at) {
    input.scrapeUntil = company.last_scraped_at;
  }

  return input;
}

function buildScrapePlan(company: CompanyRow, limitPerSource: number): CompanyScrapePlan {
  const sourceUrl = company.linkedin_company_url || company.linkedin_search_url;

  return {
    companyName: company.company_name,
    sourceUrl,
    status: company.status || "pending",
    skipDomainScrape: toBoolean(company.skip_domain_scrape),
    knownDomains: getKnownDomains(company) || "none",
    companyAliases: company.company_aliases || "none",
    jobBoardSlugs: company.job_board_slugs || "none",
    apifyInput: buildApifyInput(company, limitPerSource),
  };
}

async function saveJson(filePath: string, data: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function runApifyActor(company: CompanyRow, input: ApifyLinkedInPostInput) {
  const token = process.env.APIFY_TOKEN;
  const actorId = process.env.APIFY_LINKEDIN_POST_ACTOR || "supreme_coder/linkedin-post";

  if (!token) {
    throw new Error("APIFY_TOKEN is missing. Add it to a local .env file before running with --live.");
  }

  const client = new ApifyClient({ token });
  const run = await client.actor(actorId).call(input);
  const datasetItems = await client.dataset(run.defaultDatasetId).listItems();
  const cacheData: ApifyRunCache = {
    companyName: company.company_name,
    actorId,
    runId: run.id,
    datasetId: run.defaultDatasetId,
    itemCount: datasetItems.items.length,
    input,
    items: datasetItems.items,
    cachedAt: new Date().toISOString(),
  };
  const cachePath = path.resolve(
    "data/cache/apify-runs",
    `${toSlug(company.company_name)}-${createTimestamp()}.json`,
  );

  await saveJson(cachePath, cacheData);

  return {
    actorId,
    runId: run.id,
    datasetId: run.defaultDatasetId,
    itemCount: datasetItems.items.length,
    cachePath,
  };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("help")) {
    printUsage();
    return;
  }

  const options = getRunOptions();
  const csvPath = path.resolve("data/input/companies.sample.csv");
  const csvText = await readFile(csvPath, "utf8");
  const companies = parseCompaniesCsv(csvText);
  const selectedCompanies = filterCompanies(companies, options.selectedCompanyName);
  const skippedCompanies = selectedCompanies.filter(shouldSkipDomainScrape);
  const companiesToScrape = selectedCompanies.filter((company) => !shouldSkipDomainScrape(company));

  console.log(`Loaded ${companies.length} companies from ${csvPath}`);
  console.log(`Selected ${selectedCompanies.length} companies for this run`);
  console.log(`Skipped ${skippedCompanies.length} companies with existing domain data`);
  console.log(options.isLiveRun ? "Mode: live Apify run" : "Mode: dry run");
  console.log(`limitPerSource: ${options.limitPerSource}`);

  const scrapePlans = companiesToScrape.map((company) =>
    buildScrapePlan(company, options.limitPerSource),
  );
  const dryRunPath = path.resolve("data/cache/apify-dry-run-payloads.json");
  await saveJson(dryRunPath, scrapePlans);
  console.log(`Saved dry-run payloads to ${dryRunPath}`);

  for (const scrapePlan of scrapePlans) {
    console.log(scrapePlan);

    if (options.isLiveRun) {
      const company = companiesToScrape.find((row) => row.company_name === scrapePlan.companyName);

      if (!company) {
        throw new Error(`Could not find company row for ${scrapePlan.companyName}.`);
      }

      const result = await runApifyActor(company, scrapePlan.apifyInput);
      console.log({
        company: scrapePlan.companyName,
        ...result,
      });
    }
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
