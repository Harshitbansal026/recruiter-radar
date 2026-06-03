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
  personName: string;
  personRole: string;
  personProfileUrl: string;
  email: string;
  emailDomain: string;
  emailSource: "direct_found" | "pattern_inferred" | "generated_inferred";
  sourceUrl: string;
  sourceText: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

type ExtractedDomain = {
  companyName: string;
  domain: string;
  domainType: "email_domain" | "career_domain";
  sourceUrl: string;
  sourceText: string;
  reason: string;
};

type CompanyPerson = {
  companyName: string;
  personName: string;
  personRole: string;
  personProfileUrl: string;
  sourceUrl: string;
  sourceText: string;
};

type TrustedItem = {
  record: Record<string, unknown>;
  sourceUrl: string;
  sourceText: string;
  personName: string;
  personRole: string;
  personProfileUrl: string;
};

type EmailPattern = "first.last" | "first" | "firstlast" | "first_initial_last" | "first_last";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_PATTERN = /https?:\/\/[^\s)]+/gi;
const JOB_BOARD_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workdayjobs.com",
  "myworkdayjobs.com",
];
const EXTERNAL_SOURCE_DOMAINS = [
  "linkedin.com",
  "lnkd.in",
  "bit.ly",
  "tinyurl.com",
  "t.co",
];
const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
];
const GENERIC_COMPANY_WORDS = [
  "company",
  "companies",
  "inc",
  "ltd",
  "limited",
  "private",
  "pvt",
  "llc",
  "technologies",
  "technology",
  "tech",
  "solutions",
  "systems",
  "labs",
  "group",
];
const FALLBACK_EMAIL_PATTERNS: EmailPattern[] = [
  "first.last",
  "first",
  "firstlast",
  "first_initial_last",
  "first_last",
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

function isPersonalEmailDomain(domain: string): boolean {
  return PERSONAL_EMAIL_DOMAINS.includes(domain);
}

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isJobBoardDomain(domain: string): boolean {
  return JOB_BOARD_DOMAINS.some((jobBoardDomain) => domain.endsWith(jobBoardDomain));
}

function isExternalSourceDomain(domain: string): boolean {
  return EXTERNAL_SOURCE_DOMAINS.some((externalDomain) => domain.endsWith(externalDomain));
}

function normalizeIdentityValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getCompanyTokens(companyName: string): string[] {
  const words = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word && !GENERIC_COMPANY_WORDS.includes(word));
  const normalizedCompanyName = normalizeIdentityValue(companyName);

  return Array.from(new Set([normalizedCompanyName, ...words].filter((token) => token.length >= 2)));
}

function getDomainLabels(domain: string): string[] {
  return domain
    .toLowerCase()
    .split(".")
    .filter((label) => label && !["www", "com", "co", "in", "io", "ai", "net", "org"].includes(label));
}

function domainMatchesCompanyIdentity(domain: string, companyName: string): boolean {
  if (!domain || isPersonalEmailDomain(domain) || isJobBoardDomain(domain) || isExternalSourceDomain(domain)) {
    return false;
  }

  const companyTokens = getCompanyTokens(companyName);
  const domainLabels = getDomainLabels(domain);
  const normalizedDomain = normalizeIdentityValue(domainLabels.join(""));

  return companyTokens.some(
    (token) =>
      domainLabels.includes(token) ||
      normalizedDomain.includes(token) ||
      token.includes(normalizedDomain),
  );
}

function isCompanyAffiliatedAuthor(item: TrustedItem, companyName: string): boolean {
  const normalizedAuthorName = normalizeIdentityValue(item.personName);
  const normalizedCompanyName = normalizeIdentityValue(companyName);
  const normalizedRole = item.personRole.toLowerCase();

  return (
    normalizedAuthorName === normalizedCompanyName ||
    normalizedRole.includes(` at ${companyName.toLowerCase()}`) ||
    normalizedRole.includes(companyName.toLowerCase()) ||
    normalizedRole === "company page"
  );
}

function itemHasCompanyDomainEvidence(item: TrustedItem, companyName: string): boolean {
  const emails = getUniqueMatches(item.sourceText, EMAIL_PATTERN);
  const urls = getUniqueMatches(item.sourceText, URL_PATTERN);

  return (
    emails.some((email) => domainMatchesCompanyIdentity(getDomainFromEmail(email), companyName)) ||
    urls.some((url) => domainMatchesCompanyIdentity(getDomainFromUrl(url), companyName))
  );
}

function getTrustedItems(cachedRun: CachedApifyRun): TrustedItem[] {
  const trustedItems: TrustedItem[] = [];

  for (const item of cachedRun.items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const trustedItem: TrustedItem = {
      record,
      sourceUrl: getStringValue(record, ["url", "postUrl", "link"]),
      sourceText: getStringValue(record, ["text", "content", "description"]),
      personName: getStringValue(record, ["authorName", "author", "name", "profileName"]),
      personRole: getStringValue(record, ["authorTitle", "title", "headline", "profileHeadline"]),
      personProfileUrl: getStringValue(record, [
        "authorProfileUrl",
        "profileUrl",
        "authorUrl",
        "profileLink",
      ]),
    };

    if (
      isCompanyAffiliatedAuthor(trustedItem, cachedRun.companyName) ||
      itemHasCompanyDomainEvidence(trustedItem, cachedRun.companyName)
    ) {
      trustedItems.push(trustedItem);
    }
  }

  return trustedItems;
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
    "personName",
    "personRole",
    "personProfileUrl",
    "email",
    "emailDomain",
    "emailSource",
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

function isLikelyPersonName(name: string, companyName: string): boolean {
  return Boolean(name) && name.toLowerCase() !== companyName.toLowerCase() && name.trim().includes(" ");
}

function normalizeNameParts(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s-]/g, "")
    .split(/[\s-]+/)
    .filter(Boolean);
}

function getPersonNameParts(name: string): { firstName: string; lastName: string } | undefined {
  const nameParts = normalizeNameParts(name);
  const firstName = nameParts[0];
  const lastName = nameParts[nameParts.length - 1];

  if (!firstName || !lastName) {
    return undefined;
  }

  return { firstName, lastName };
}

function generateEmailForPattern(personName: string, domain: string, pattern: EmailPattern): string | undefined {
  const nameParts = getPersonNameParts(personName);

  if (!nameParts) {
    return undefined;
  }

  const { firstName, lastName } = nameParts;
  const localPartsByPattern: Record<EmailPattern, string> = {
    "first.last": `${firstName}.${lastName}`,
    first: firstName,
    firstlast: `${firstName}${lastName}`,
    first_initial_last: `${firstName[0]}${lastName}`,
    first_last: `${firstName}_${lastName}`,
  };

  return `${localPartsByPattern[pattern]}@${domain}`;
}

function detectEmailPattern(email: string, personName: string): EmailPattern | undefined {
  const nameParts = getPersonNameParts(personName);

  if (!nameParts) {
    return undefined;
  }

  const localPart = email.split("@")[0]?.toLowerCase();
  const { firstName, lastName } = nameParts;
  const patternByLocalPart = new Map<string, EmailPattern>([
    [`${firstName}.${lastName}`, "first.last"],
    [firstName, "first"],
    [`${firstName}${lastName}`, "firstlast"],
    [`${firstName[0]}${lastName}`, "first_initial_last"],
    [`${firstName}_${lastName}`, "first_last"],
  ]);

  return patternByLocalPart.get(localPart);
}

function getPatternPriorityByDomain(directContacts: ExtractedContact[]): Map<string, EmailPattern[]> {
  const patternsByDomain = new Map<string, EmailPattern[]>();

  for (const contact of directContacts) {
    const pattern = detectEmailPattern(contact.email, contact.personName);

    if (!pattern) {
      continue;
    }

    const existingPatterns = patternsByDomain.get(contact.emailDomain) ?? [];

    if (!existingPatterns.includes(pattern)) {
      existingPatterns.push(pattern);
      patternsByDomain.set(contact.emailDomain, existingPatterns);
    }
  }

  return patternsByDomain;
}

function extractCompanyPeople(cachedRun: CachedApifyRun, trustedItems: TrustedItem[]): CompanyPerson[] {
  const peopleByKey = new Map<string, CompanyPerson>();

  for (const item of trustedItems) {
    if (!isCompanyAffiliatedAuthor(item, cachedRun.companyName)) {
      continue;
    }

    if (!isLikelyPersonName(item.personName, cachedRun.companyName)) {
      continue;
    }

    const key = `${item.personName.toLowerCase()}:${item.personProfileUrl}`;

    if (!peopleByKey.has(key)) {
      peopleByKey.set(key, {
        companyName: cachedRun.companyName,
        personName: item.personName,
        personRole: item.personRole,
        personProfileUrl: item.personProfileUrl,
        sourceUrl: item.sourceUrl,
        sourceText: item.sourceText,
      });
    }
  }

  return Array.from(peopleByKey.values());
}

function extractContactsFromRun(cachedRun: CachedApifyRun, trustedItems: TrustedItem[]): ExtractedContact[] {
  const contactsByEmail = new Map<string, ExtractedContact>();

  for (const item of trustedItems) {
    const emails = getUniqueMatches(item.sourceText, EMAIL_PATTERN);

    for (const email of emails) {
      const normalizedEmail = email.toLowerCase();
      const emailDomain = getDomainFromEmail(normalizedEmail);

      if (!domainMatchesCompanyIdentity(emailDomain, cachedRun.companyName)) {
        continue;
      }

      if (!contactsByEmail.has(normalizedEmail)) {
        contactsByEmail.set(normalizedEmail, {
          companyName: cachedRun.companyName,
          personName: item.personName,
          personRole: item.personRole,
          personProfileUrl: item.personProfileUrl,
          email: normalizedEmail,
          emailDomain,
          emailSource: "direct_found",
          sourceUrl: item.sourceUrl,
          sourceText: item.sourceText,
          confidence: "high",
          reason: "Company-domain email was found directly in a high-trust company-related post.",
        });
      }
    }
  }

  return Array.from(contactsByEmail.values());
}

function extractDomainsFromRun(cachedRun: CachedApifyRun, trustedItems: TrustedItem[]): ExtractedDomain[] {
  const domainsByKey = new Map<string, ExtractedDomain>();

  for (const item of trustedItems) {
    const emails = getUniqueMatches(item.sourceText, EMAIL_PATTERN);
    const urls = getUniqueMatches(item.sourceText, URL_PATTERN);

    for (const email of emails) {
      const domain = getDomainFromEmail(email);
      const key = `${domain}:email_domain`;

      if (domainMatchesCompanyIdentity(domain, cachedRun.companyName) && !domainsByKey.has(key)) {
        domainsByKey.set(key, {
          companyName: cachedRun.companyName,
          domain,
          domainType: "email_domain",
          sourceUrl: item.sourceUrl,
          sourceText: item.sourceText,
          reason: "Company-matching domain was extracted from a public email in a trusted post.",
        });
      }
    }

    for (const url of urls) {
      const domain = getDomainFromUrl(url);
      const key = `${domain}:career_domain`;

      if (
        /career|jobs|job|apply/i.test(url) &&
        domainMatchesCompanyIdentity(domain, cachedRun.companyName) &&
        !domainsByKey.has(key)
      ) {
        domainsByKey.set(key, {
          companyName: cachedRun.companyName,
          domain,
          domainType: "career_domain",
          sourceUrl: item.sourceUrl,
          sourceText: item.sourceText,
          reason: "Company-matching career/apply domain was extracted from a trusted post.",
        });
      }
    }
  }

  return Array.from(domainsByKey.values());
}

function getCandidateEmailDomains(domains: ExtractedDomain[]): string[] {
  return Array.from(new Set(domains.map((domain) => domain.domain).filter(Boolean)));
}

function getPatternOrder(domain: string, patternsByDomain: Map<string, EmailPattern[]>): EmailPattern[] {
  const inferredPatterns = patternsByDomain.get(domain) ?? [];

  return Array.from(new Set([...inferredPatterns, ...FALLBACK_EMAIL_PATTERNS]));
}

function generateInferredContacts(
  companyPeople: CompanyPerson[],
  directContacts: ExtractedContact[],
  domains: ExtractedDomain[],
): ExtractedContact[] {
  const candidateEmailDomains = getCandidateEmailDomains(domains);
  const patternsByDomain = getPatternPriorityByDomain(directContacts);
  const inferredContacts: ExtractedContact[] = [];
  const existingEmails = new Set(directContacts.map((contact) => contact.email));

  for (const person of companyPeople) {
    for (const domain of candidateEmailDomains) {
      for (const pattern of getPatternOrder(domain, patternsByDomain)) {
        const generatedEmail = generateEmailForPattern(person.personName, domain, pattern);

        if (!generatedEmail || existingEmails.has(generatedEmail)) {
          continue;
        }

        existingEmails.add(generatedEmail);
        inferredContacts.push({
          companyName: person.companyName,
          personName: person.personName,
          personRole: person.personRole,
          personProfileUrl: person.personProfileUrl,
          email: generatedEmail,
          emailDomain: domain,
          emailSource: patternsByDomain.get(domain)?.includes(pattern)
            ? "pattern_inferred"
            : "generated_inferred",
          sourceUrl: person.sourceUrl,
          sourceText: person.sourceText,
          confidence: "medium",
          reason: patternsByDomain.get(domain)?.includes(pattern)
            ? `Email was generated from a company-affiliated person using an inferred ${pattern} company email pattern.`
            : "Email was generated from a company-affiliated person and candidate company email domain; it is not directly verified.",
        });
      }
    }
  }

  return inferredContacts;
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
  const generatedContactsPath = path.resolve("data/output/generated_contacts.csv");
  const cachedRunText = await readFile(inputPath, "utf8");
  const cachedRun = JSON.parse(cachedRunText) as CachedApifyRun;
  const trustedItems = getTrustedItems(cachedRun);
  const companyPeople = extractCompanyPeople(cachedRun, trustedItems);
  const directContacts = extractContactsFromRun(cachedRun, trustedItems);
  const domains = extractDomainsFromRun(cachedRun, trustedItems);
  const generatedContacts = generateInferredContacts(companyPeople, directContacts, domains);
  const contacts = [...directContacts, ...generatedContacts];
  const qualifiedContacts = contacts.filter((contact) => contact.confidence === "high");
  const allContactsCsv = contactsToCsv(contacts);
  const qualifiedContactsCsv = contactsToCsv(qualifiedContacts);
  const generatedContactsCsv = contactsToCsv(generatedContacts);
  const companyDomainsCsv = domainsToCsv(domains);

  await saveText(allContactsPath, allContactsCsv);
  await saveText(qualifiedContactsPath, qualifiedContactsCsv);
  await saveText(generatedContactsPath, generatedContactsCsv);
  await saveText(companyDomainsPath, companyDomainsCsv);

  console.log(`Read cached Apify run from ${inputPath}`);
  console.log(`Trusted ${trustedItems.length} company-related items`);
  console.log(`Found ${companyPeople.length} company-affiliated people`);
  console.log(`Extracted ${directContacts.length} direct company-domain contacts`);
  console.log(`Generated ${generatedContacts.length} inferred company-domain contacts`);
  console.log(`Extracted ${domains.length} company domains`);
  console.log(`Qualified ${qualifiedContacts.length} contacts`);
  console.log(`Saved all contacts to ${allContactsPath}`);
  console.log(`Saved qualified contacts to ${qualifiedContactsPath}`);
  console.log(`Saved generated contacts to ${generatedContactsPath}`);
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
