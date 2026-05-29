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

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

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

function cleanCsvValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function contactsToCsv(contacts: ExtractedContact[]): string {
  const headers: Array<keyof ExtractedContact> = [
    "companyName",
    "email",
    "emailDomain",
    "sourceUrl",
    "sourceText",
    "confidence",
    "reason",
  ];

  const rows = contacts.map((contact) =>
    headers.map((header) => cleanCsvValue(contact[header])).join(","),
  );

  return [headers.join(","), ...rows].join("\n");
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

async function saveText(filePath: string, text: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${text}\n`, "utf8");
}

async function main() {
  const inputPath = path.resolve(process.argv[2] ?? "data/samples/apify-run-sample.json");
  const allContactsPath = path.resolve("data/output/all_contacts.csv");
  const qualifiedContactsPath = path.resolve("data/output/qualified_contacts.csv");
  const cachedRunText = await readFile(inputPath, "utf8");
  const cachedRun = JSON.parse(cachedRunText) as CachedApifyRun;
  const contacts = extractContactsFromRun(cachedRun);
  const qualifiedContacts = contacts.filter((contact) => contact.confidence === "high");
  const allContactsCsv = contactsToCsv(contacts);
  const qualifiedContactsCsv = contactsToCsv(qualifiedContacts);

  await saveText(allContactsPath, allContactsCsv);
  await saveText(qualifiedContactsPath, qualifiedContactsCsv);

  console.log(`Read cached Apify run from ${inputPath}`);
  console.log(`Extracted ${contacts.length} contacts`);
  console.log(`Qualified ${qualifiedContacts.length} contacts`);
  console.log(`Saved all contacts to ${allContactsPath}`);
  console.log(`Saved qualified contacts to ${qualifiedContactsPath}`);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});
