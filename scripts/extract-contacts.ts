import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type CachedApifyRun = {
  companyName: string;
  actorId: string;
  runId: string;
  datasetId: string;
  itemCount: number;
  input: unknown;
  items: unknown[];
  cachedAt: string;
};

type ExtractedContact = {
  companyName: string;
  email: string;
  emailDomain: string;
  sourceUrl: string;
  sourceText: string;
  confidence: "high" | "medium";
  reason: string;
};

type ExtractedDomain = {
  companyName: string;
  domain: string;
  domainType: "email_domain" | "career_domain" | "job_board_domain" | "external_domain";
  sourceUrl: string;
  sourceText: string;
  reason: string;
};

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_PATTERN = /https?:\/\/[^\s)]+/gi;
const JOB_BOARD_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workdayjobs.com",
  "myworkdayjobs.com",
];

function getStringValue(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function getUniqueMatches(text: string, pattern: RegExp): string[] {
  return Array.from(new Set(text.match(pattern) ?? []));
}

function getDomainFromEmail(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function classifyUrlDomain(url: string): ExtractedDomain["domainType"] {
  const domain = getDomainFromUrl(url);

  if (JOB_BOARD_DOMAINS.some((jobBoardDomain) => domain.endsWith(jobBoardDomain))) {
    return "job_board_domain";
  }

  return /career|jobs|job|apply/i.test(url) ? "career_domain" : "external_domain";
}

function cleanCsvValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function recordsToCsv<T extends Record<string, string>>(records: T[], headers: Array<keyof T>): string {
  const rows = records.map((record) =>
    headers.map((header) => cleanCsvValue(record[header])).join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}

function contactsToCsv(contacts: ExtractedContact[]): string {
  return recordsToCsv(contacts, [
    "companyName",
    "email",
    "emailDomain",
    "sourceUrl",
    "sourceText",
    "confidence",
    "reason",
  ]);
}

function domainsToCsv(domains: ExtractedDomain[]): string {
  return recordsToCsv(domains, [
    "companyName",
    "domain",
    "domainType",
    "sourceUrl",
    "sourceText",
    "reason",
  ]);
}

function extractContactsFromRun(cachedRun: CachedApifyRun): ExtractedContact[] {
  const contacts: ExtractedContact[] = [];

  for (const item of cachedRun.items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const itemRecord = item as Record<string, unknown>;
    const sourceUrl = getStringValue(itemRecord, ["url", "postUrl", "link"]);
    const sourceText = getStringValue(itemRecord, ["text", "content", "description"]);
    const emails = getUniqueMatches(sourceText, EMAIL_PATTERN);

    for (const email of emails) {
      contacts.push({
        companyName: cachedRun.companyName,
        email: email.toLowerCase(),
        emailDomain: getDomainFromEmail(email),
        sourceUrl,
        sourceText,
        confidence: "high",
        reason: "Email was found directly in scraped post text.",
      });
    }
  }

  return contacts;
}

function extractDomainsFromRun(cachedRun: CachedApifyRun): ExtractedDomain[] {
  const domainsByKey = new Map<string, ExtractedDomain>();

  for (const item of cachedRun.items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const itemRecord = item as Record<string, unknown>;
    const sourceUrl = getStringValue(itemRecord, ["url", "postUrl", "link"]);
    const sourceText = getStringValue(itemRecord, ["text", "content", "description"]);
    const emails = getUniqueMatches(sourceText, EMAIL_PATTERN);
    const urls = getUniqueMatches(sourceText, URL_PATTERN);

    for (const email of emails) {
      const domain = getDomainFromEmail(email);
      const key = `${domain}:email_domain`;

      if (domain && !domainsByKey.has(key)) {
        domainsByKey.set(key, {
          companyName: cachedRun.companyName,
          domain,
          domainType: "email_domain",
          sourceUrl,
          sourceText,
          reason: "Domain was extracted from a public email in post text.",
        });
      }
    }

    for (const url of urls) {
      const domain = getDomainFromUrl(url);
      const domainType = classifyUrlDomain(url);
      const key = `${domain}:${domainType}`;

      if (domain && !domainsByKey.has(key)) {
        domainsByKey.set(key, {
          companyName: cachedRun.companyName,
          domain,
          domainType,
          sourceUrl,
          sourceText,
          reason:
            domainType === "career_domain"
              ? "Domain was extracted from a hiring/apply URL in post text."
              : domainType === "job_board_domain"
                ? "Domain was identified as a known job-board domain in post text."
                : "Domain was extracted from a URL in post text.",
        });
      }
    }
  }

  return Array.from(domainsByKey.values());
}

async function saveText(filePath: string, text: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${text}\n`, "utf8");
}

async function main() {
  const inputPath = path.resolve(process.argv[2] ?? "data/samples/apify-run-sample.json");
  const allContactsPath = path.resolve("data/output/all_contacts.csv");
  const qualifiedContactsPath = path.resolve("data/output/qualified_contacts.csv");
  const companyDomainsPath = path.resolve("data/output/company_domains.csv");
  const cachedRunText = await readFile(inputPath, "utf8");
  const cachedRun = JSON.parse(cachedRunText) as CachedApifyRun;
  const contacts = extractContactsFromRun(cachedRun);
  const domains = extractDomainsFromRun(cachedRun);
  const qualifiedContacts = contacts.filter((contact) => contact.confidence === "high");
  const allContactsCsv = contactsToCsv(contacts);
  const qualifiedContactsCsv = contactsToCsv(qualifiedContacts);
  const companyDomainsCsv = domainsToCsv(domains);

  await saveText(allContactsPath, allContactsCsv);
  await saveText(qualifiedContactsPath, qualifiedContactsCsv);
  await saveText(companyDomainsPath, companyDomainsCsv);

  console.log(`Read cached Apify run from ${inputPath}`);
  console.log(`Extracted ${contacts.length} contacts`);
  console.log(`Extracted ${domains.length} domains`);
  console.log(`Qualified ${qualifiedContacts.length} contacts`);
  console.log(`Saved all contacts to ${allContactsPath}`);
  console.log(`Saved qualified contacts to ${qualifiedContactsPath}`);
  console.log(`Saved company domains to ${companyDomainsPath}`);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});
