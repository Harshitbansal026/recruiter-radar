import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApifyClient } from "apify-client";
import "dotenv/config";

type DiagnosticInput = {
  searchQueries: string[];
  maxPosts: number;
  postedLimit: "1h" | "24h" | "week" | "month" | "3months" | "6months" | "year";
  sortBy: "relevance" | "date";
  scrapeReactions: boolean;
  scrapeComments: boolean;
  targetUrls?: string[];
  authorsCompanyPublicIdentifiers?: string[];
};

type DiagnosticCache = {
  scenario: string;
  actorId: string;
  runId: string;
  datasetId: string;
  input: DiagnosticInput;
  itemCount: number;
  items: unknown[];
  authorSummary: Array<{
    authorName: string;
    authorType: string;
    authorInfo: string;
    authorUrl: string;
    postUrl: string;
    textSnippet: string;
  }>;
  cachedAt: string;
};

const ACTOR_ID = "harvestapi/linkedin-post-search";
const POSTED_LIMIT: DiagnosticInput["postedLimit"] = "3months";
const SCENARIOS: Record<string, DiagnosticInput> = {
  impossible_company_filter: {
    searchQueries: ["referral"],
    authorsCompanyPublicIdentifiers: ["some-impossible-company-xyz"],
    maxPosts: 1,
    postedLimit: POSTED_LIMIT,
    sortBy: "date",
    scrapeReactions: false,
    scrapeComments: false,
  },
  policybazaar_author_filter: {
    searchQueries: ["referral"],
    authorsCompanyPublicIdentifiers: ["policybazaar"],
    maxPosts: 3,
    postedLimit: POSTED_LIMIT,
    sortBy: "date",
    scrapeReactions: false,
    scrapeComments: false,
  },
  policybazaar_target_url: {
    searchQueries: ["hiring"],
    targetUrls: ["https://www.linkedin.com/company/policybazaar/"],
    maxPosts: 3,
    postedLimit: POSTED_LIMIT,
    sortBy: "date",
    scrapeReactions: false,
    scrapeComments: false,
  },
  policybazaar_mentioned: {
    searchQueries: ["policybazaar hiring", "policybazaar referral", "@policybazaar.com"],
    maxPosts: 1,
    postedLimit: POSTED_LIMIT,
    sortBy: "date",
    scrapeReactions: false,
    scrapeComments: false,
  },
};

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function createTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getRecordString(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  return typeof value === "string" ? value : "";
}

function summarizeItems(items: unknown[]): DiagnosticCache["authorSummary"] {
  return items.map((item) => {
    const record = item && typeof item === "object" && !Array.isArray(item)
      ? (item as Record<string, unknown>)
      : {};
    const author = record.author && typeof record.author === "object" && !Array.isArray(record.author)
      ? (record.author as Record<string, unknown>)
      : {};
    const text = getRecordString(record, "content") || getRecordString(record, "text");

    return {
      authorName: getRecordString(author, "name") || getRecordString(record, "authorName"),
      authorType: getRecordString(author, "type"),
      authorInfo: getRecordString(author, "info"),
      authorUrl: getRecordString(author, "linkedinUrl"),
      postUrl: getRecordString(record, "linkedinUrl") || getRecordString(record, "shareLinkedinUrl"),
      textSnippet: text.replace(/\s+/g, " ").slice(0, 220),
    };
  });
}

async function saveJson(filePath: string, data: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function main() {
  const scenario = process.argv[2];
  const input = scenario ? SCENARIOS[scenario] : undefined;
  const token = process.env.APIFY_TOKEN;

  if (!scenario || !input) {
    console.log(`Available scenarios: ${Object.keys(SCENARIOS).join(", ")}`);
    throw new Error("Pass one diagnostic scenario name.");
  }

  if (!token) {
    throw new Error("APIFY_TOKEN is missing. Add it to .env before running diagnostics.");
  }

  const client = new ApifyClient({ token });
  const run = await client.actor(ACTOR_ID).call(input);
  const datasetItems = await client.dataset(run.defaultDatasetId).listItems();
  const authorSummary = summarizeItems(datasetItems.items);
  const cache: DiagnosticCache = {
    scenario,
    actorId: ACTOR_ID,
    runId: run.id,
    datasetId: run.defaultDatasetId,
    input,
    itemCount: datasetItems.items.length,
    items: datasetItems.items,
    authorSummary,
    cachedAt: new Date().toISOString(),
  };
  const cachePath = path.resolve(
    "data/cache/apify-diagnostics",
    `${toSlug(scenario)}-${createTimestamp()}.json`,
  );

  await saveJson(cachePath, cache);

  console.log({
    scenario,
    runId: run.id,
    datasetId: run.defaultDatasetId,
    itemCount: datasetItems.items.length,
    cachePath,
  });
  console.table(authorSummary);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});
