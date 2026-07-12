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

type SupremeCoderLinkedInPostInput = {
  urls: string[];
  limitPerSource: number;
  deepScrape: boolean;
  rawData: boolean;
  scrapeUntil?: string;
};

type HarvestApiLinkedInProfilePostsInput = {
  targetUrls: string[];
  maxPosts: number;
  scrapeReactions: boolean;
  scrapeComments: boolean;
  postedLimitDate?: string;
};

type HarvestApiLinkedInPostSearchInput = {
  searchQueries: string[];
  authorsCompanyPublicIdentifiers: string[];
  maxPosts: number;
  postedLimit?: "1h" | "24h" | "week" | "month" | "3months" | "6months" | "year";
  postedLimitDate?: string;
  sortBy: "relevance" | "date";
  scrapeReactions: boolean;
  scrapeComments: boolean;
};

type ApifyLinkedInPostInput =
  | SupremeCoderLinkedInPostInput
  | HarvestApiLinkedInProfilePostsInput
  | HarvestApiLinkedInPostSearchInput;

type CompanyScrapePlan = {
  companyName: string;
  sourceUrl: string;
  actorId: string;
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
  maxEstimatedPosts: number;
};

const DEFAULT_LIMIT_PER_SOURCE = 5;
const DEFAULT_MAX_ESTIMATED_POSTS = 50;
const DEFAULT_POST_SEARCH_WINDOW: HarvestApiLinkedInPostSearchInput["postedLimit"] = "3months";
const LINKEDIN_QUERY_CHARACTER_LIMIT = 85;

function printUsage() {
  console.log(`
RecruiterRadar LinkedIn scrape planner

Commands:
  npm run scrape:linkedin:dry
  npm run scrape:linkedin:dry -- "Example Company"
  npm run scrape:linkedin:dry -- "Example Company" 3
  npm run scrape:linkedin:live -- "Example Company" 3
  npm run scrape:linkedin:live -- "Example Company" 3 --max-estimated-posts 25

Notes:
  - Dry-run does not call Apify or spend credits.
  - Live mode requires APIFY_TOKEN in a local .env file.
  - The optional number controls max posts per source/search query.
  - Live runs are blocked if estimated posts exceed --max-estimated-posts.
  - APIFY_LINKEDIN_POST_ACTOR controls the actor adapter.
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

function splitList(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function getLinkedInPublicIdentifier(linkedInUrl: string): string {
  const match = linkedInUrl.match(/linkedin\.com\/company\/([^/?#]+)/i);

  return match?.[1]?.toLowerCase() || "";
}

function fitLinkedInQuery(query: string): string {
  return query.length <= LINKEDIN_QUERY_CHARACTER_LIMIT
    ? query
    : query.slice(0, LINKEDIN_QUERY_CHARACTER_LIMIT).trim();
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
  const maxEstimatedPostsArg = getArgValue("--max-estimated-posts");
  const positionalLimitArg = args.find((argument) => /^\d+$/.test(argument));

  return {
    isLiveRun: args.includes("--live"),
    selectedCompanyName: getSelectedCompanyName(args),
    limitPerSource: limitArg || positionalLimitArg
      ? parsePositiveInteger(limitArg || positionalLimitArg || "", "limit")
      : DEFAULT_LIMIT_PER_SOURCE,
    maxEstimatedPosts: maxEstimatedPostsArg
      ? parsePositiveInteger(maxEstimatedPostsArg, "max-estimated-posts")
      : DEFAULT_MAX_ESTIMATED_POSTS,
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

function getLinkedInPostActorId(): string {
  return process.env.APIFY_LINKEDIN_POST_ACTOR || "harvestapi/linkedin-post-search";
}

function buildSupremeCoderInput(company: CompanyRow, limitPerSource: number): SupremeCoderLinkedInPostInput {
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

function buildHarvestApiInput(
  company: CompanyRow,
  limitPerSource: number,
): HarvestApiLinkedInProfilePostsInput {
  const sourceUrl = company.linkedin_company_url || company.linkedin_search_url;
  const input: HarvestApiLinkedInProfilePostsInput = {
    targetUrls: [sourceUrl],
    maxPosts: limitPerSource,
    scrapeReactions: false,
    scrapeComments: false,
  };

  if (company.last_scraped_at) {
    input.postedLimitDate = company.last_scraped_at;
  }

  return input;
}

function buildSearchQueries(company: CompanyRow): string[] {
  const domains = unique([
    ...splitList(company.email_domains),
    ...splitList(company.official_domains),
  ]);
  const hiringIntentQueries = [
    "hiring software engineer",
    "we are hiring",
    "send resume",
    "referral",
    "recruiter",
  ];
  const emailPatternQueries = domains.flatMap((domain) => [
    `@${domain}`,
    `${domain} email`,
  ]);

  return unique([...hiringIntentQueries, ...emailPatternQueries]).map(fitLinkedInQuery);
}

function buildCompanyPublicIdentifiers(company: CompanyRow): string[] {
  const linkedInIdentifier = getLinkedInPublicIdentifier(company.linkedin_company_url);
  const slugIdentifiers = splitList(company.job_board_slugs).map((slug) => slug.toLowerCase());

  return unique([linkedInIdentifier, ...slugIdentifiers]);
}

function buildHarvestApiPostSearchInput(
  company: CompanyRow,
  limitPerSource: number,
): HarvestApiLinkedInPostSearchInput {
  const authorsCompanyPublicIdentifiers = buildCompanyPublicIdentifiers(company);

  if (authorsCompanyPublicIdentifiers.length === 0) {
    throw new Error(
      `${company.company_name} must include a LinkedIn company URL or company public identifier for post search.`,
    );
  }

  const input: HarvestApiLinkedInPostSearchInput = {
    searchQueries: buildSearchQueries(company),
    authorsCompanyPublicIdentifiers,
    maxPosts: limitPerSource,
    postedLimit: DEFAULT_POST_SEARCH_WINDOW,
    sortBy: "date",
    scrapeReactions: false,
    scrapeComments: false,
  };

  if (company.last_scraped_at) {
    delete input.postedLimit;
    input.postedLimitDate = company.last_scraped_at;
  }

  return input;
}

function buildApifyInput(
  company: CompanyRow,
  limitPerSource: number,
  actorId: string,
): ApifyLinkedInPostInput {
  if (actorId === "harvestapi/linkedin-post-search") {
    return buildHarvestApiPostSearchInput(company, limitPerSource);
  }

  if (actorId === "harvestapi/linkedin-profile-posts") {
    return buildHarvestApiInput(company, limitPerSource);
  }

  return buildSupremeCoderInput(company, limitPerSource);
}

function buildScrapePlan(company: CompanyRow, limitPerSource: number): CompanyScrapePlan {
  const sourceUrl = company.linkedin_company_url || company.linkedin_search_url;
  const actorId = getLinkedInPostActorId();

  return {
    companyName: company.company_name,
    sourceUrl,
    actorId,
    status: company.status || "pending",
    skipDomainScrape: toBoolean(company.skip_domain_scrape),
    knownDomains: getKnownDomains(company) || "none",
    companyAliases: company.company_aliases || "none",
    jobBoardSlugs: company.job_board_slugs || "none",
    apifyInput: buildApifyInput(company, limitPerSource, actorId),
  };
}

function getEstimatedMaxPosts(input: ApifyLinkedInPostInput): number {
  if ("searchQueries" in input) {
    return input.searchQueries.length * input.maxPosts;
  }

  if ("maxPosts" in input) {
    return input.maxPosts * input.targetUrls.length;
  }

  return input.limitPerSource * input.urls.length;
}

async function saveJson(filePath: string, data: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function runApifyActor(company: CompanyRow, input: ApifyLinkedInPostInput) {
  const token = process.env.APIFY_TOKEN;
  const actorId = getLinkedInPostActorId();

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
  console.log(`maxEstimatedPosts guard: ${options.maxEstimatedPosts}`);

  const scrapePlans = companiesToScrape.map((company) =>
    buildScrapePlan(company, options.limitPerSource),
  );
  const dryRunPath = path.resolve("data/cache/apify-dry-run-payloads.json");
  await saveJson(dryRunPath, scrapePlans);
  console.log(`Saved dry-run payloads to ${dryRunPath}`);

  for (const scrapePlan of scrapePlans) {
    console.log(scrapePlan);
    const estimatedMaxPosts = getEstimatedMaxPosts(scrapePlan.apifyInput);
    console.log({
      company: scrapePlan.companyName,
      estimatedMaxPosts,
    });

    if (options.isLiveRun) {
      if (estimatedMaxPosts > options.maxEstimatedPosts) {
        throw new Error(
          `${scrapePlan.companyName} live run is blocked: estimated ${estimatedMaxPosts} posts exceeds maxEstimatedPosts ${options.maxEstimatedPosts}. Lower the query limit or pass a higher --max-estimated-posts value intentionally.`,
        );
      }

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
