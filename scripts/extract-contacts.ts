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

type CompanyIdentity = {
  canonicalName: string;
  aliases: string[];
  tokens: string[];
  trustedDomains: string[];
  emailDomains: string[];
  careerDomains: string[];
  jobBoardDomains: string[];
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
const DOMAIN_PATTERN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;
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
const CONTACT_USEFULNESS_KEYWORDS = [
  "hiring",
  "we are hiring",
  "open role",
  "open roles",
  "opening",
  "openings",
  "referral",
  "refer",
  "send resume",
  "send your resume",
  "recruiter",
  "talent acquisition",
  "hr",
  "people team",
  "apply",
];
const COMPANY_CSV_PATH = "data/input/companies.sample.csv";

function getStringValue(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function getObjectValue(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getNestedStringValue(record: Record<string, unknown>, pathParts: string[]): string {
  let currentValue: unknown = record;

  for (const pathPart of pathParts) {
    if (!currentValue || typeof currentValue !== "object" || Array.isArray(currentValue)) {
      return "";
    }

    currentValue = (currentValue as Record<string, unknown>)[pathPart];
  }

  return typeof currentValue === "string" && currentValue.trim() ? currentValue.trim() : "";
}

function getUniqueMatches(text: string, pattern: RegExp): string[] {
  return Array.from(new Set(text.match(pattern) ?? []));
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

function parseCompanyCsv(csvText: string): CompanyRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);

    return Object.fromEntries(
      headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]),
    ) as CompanyRow;
  });
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

function cleanDomain(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[),.;:!?]+$/g, "");
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

function getCompanyTokens(identityNames: string[]): string[] {
  const words = identityNames
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word && !GENERIC_COMPANY_WORDS.includes(word));
  const normalizedNames = identityNames.map(normalizeIdentityValue);

  return unique([...normalizedNames, ...words].filter((token) => token.length >= 2));
}

function createFallbackCompanyIdentity(companyName: string): CompanyIdentity {
  const aliases = [companyName];

  return {
    canonicalName: companyName,
    aliases,
    tokens: getCompanyTokens(aliases),
    trustedDomains: [],
    emailDomains: [],
    careerDomains: [],
    jobBoardDomains: [],
  };
}

function buildCompanyIdentity(companyName: string, companyRow?: CompanyRow): CompanyIdentity {
  if (!companyRow) {
    return createFallbackCompanyIdentity(companyName);
  }

  const aliases = unique([companyRow.company_name, ...splitList(companyRow.company_aliases)]);
  const emailDomains = splitList(companyRow.email_domains).map(cleanDomain);
  const careerDomains = splitList(companyRow.career_domains).map(cleanDomain);
  const jobBoardDomains = splitList(companyRow.job_board_domains).map(cleanDomain);
  const trustedDomains = unique([
    ...splitList(companyRow.official_domains).map(cleanDomain),
    ...splitList(companyRow.old_domains).map(cleanDomain),
    ...emailDomains,
    ...careerDomains,
  ]);

  return {
    canonicalName: companyRow.company_name || companyName,
    aliases,
    tokens: getCompanyTokens(aliases),
    trustedDomains,
    emailDomains,
    careerDomains,
    jobBoardDomains,
  };
}

async function loadCompanyIdentity(companyName: string): Promise<CompanyIdentity> {
  const csvPath = path.resolve(COMPANY_CSV_PATH);
  const csvText = await readFile(csvPath, "utf8");
  const companyRows = parseCompanyCsv(csvText);
  const companyRow = companyRows.find(
    (row) => row.company_name.toLowerCase() === companyName.toLowerCase(),
  );

  return buildCompanyIdentity(companyName, companyRow);
}

function getDomainLabels(domain: string): string[] {
  return domain
    .toLowerCase()
    .split(".")
    .filter((label) => label && !["www", "com", "co", "in", "io", "ai", "net", "org"].includes(label));
}

function domainMatchesCompanyIdentity(domain: string, identity: CompanyIdentity): boolean {
  if (!domain || isPersonalEmailDomain(domain) || isJobBoardDomain(domain) || isExternalSourceDomain(domain)) {
    return false;
  }

  const trustedDomainMatch = identity.trustedDomains.some(
    (trustedDomain) => domain === trustedDomain || domain.endsWith(`.${trustedDomain}`),
  );

  if (trustedDomainMatch) {
    return true;
  }

  const domainLabels = getDomainLabels(domain);
  const normalizedDomain = normalizeIdentityValue(domainLabels.join(""));

  return identity.tokens.some(
    (token) =>
      domainLabels.includes(token) ||
      normalizedDomain.includes(token) ||
      token.includes(normalizedDomain),
  );
}

function isCompanyAffiliatedAuthor(item: TrustedItem, identity: CompanyIdentity): boolean {
  const normalizedAuthorName = normalizeIdentityValue(item.personName);
  const normalizedRole = item.personRole.toLowerCase();
  const normalizedAliases = identity.aliases.map(normalizeIdentityValue);
  const lowerCaseAliases = identity.aliases.map((alias) => alias.toLowerCase());

  return (
    normalizedAliases.includes(normalizedAuthorName) ||
    lowerCaseAliases.some((alias) => normalizedRole.includes(` at ${alias}`) || normalizedRole.includes(alias)) ||
    normalizedRole === "company page"
  );
}

function itemHasCompanyDomainEvidence(item: TrustedItem, identity: CompanyIdentity): boolean {
  const emails = getUniqueMatches(item.sourceText, EMAIL_PATTERN);
  const urls = getUniqueMatches(item.sourceText, URL_PATTERN);

  return (
    emails.some((email) => domainMatchesCompanyIdentity(getDomainFromEmail(email), identity)) ||
    urls.some((url) => domainMatchesCompanyIdentity(getDomainFromUrl(url), identity))
  );
}

function hasContactUsefulnessSignal(item: TrustedItem): boolean {
  const searchableText = `${item.sourceText} ${item.personRole}`.toLowerCase();

  return CONTACT_USEFULNESS_KEYWORDS.some((keyword) => searchableText.includes(keyword));
}

function getTrustedItems(cachedRun: CachedApifyRun, identity: CompanyIdentity): TrustedItem[] {
  const trustedItems: TrustedItem[] = [];

  for (const item of cachedRun.items) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as Record<string, unknown>;
    const author = getObjectValue(record, "author");
    const authorType = author ? getStringValue(author, ["type"]) : "";
    const authorName = author ? getStringValue(author, ["name", "universalName"]) : "";
    const authorProfileUrl = author ? getStringValue(author, ["linkedinUrl"]) : "";
    const trustedItem: TrustedItem = {
      record,
      sourceUrl: getStringValue(record, [
        "url",
        "postUrl",
        "link",
        "linkedinUrl",
        "shareLinkedinUrl",
      ]),
      sourceText: getStringValue(record, ["text", "content", "description"]),
      personName: getStringValue(record, ["authorName", "name", "profileName"]) || authorName,
      personRole:
        getStringValue(record, ["authorTitle", "title", "headline", "profileHeadline"]) ||
        getNestedStringValue(record, ["header", "text"]) ||
        (authorType === "company" ? "Company Page" : authorType),
      personProfileUrl:
        getStringValue(record, ["authorProfileUrl", "profileUrl", "authorUrl", "profileLink"]) ||
        authorProfileUrl,
    };

    if (
      isCompanyAffiliatedAuthor(trustedItem, identity) ||
      itemHasCompanyDomainEvidence(trustedItem, identity)
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

function extractCompanyPeople(
  cachedRun: CachedApifyRun,
  trustedItems: TrustedItem[],
  identity: CompanyIdentity,
): CompanyPerson[] {
  const peopleByKey = new Map<string, CompanyPerson>();

  for (const item of trustedItems) {
    if (!hasContactUsefulnessSignal(item)) {
      continue;
    }

    if (!isCompanyAffiliatedAuthor(item, identity)) {
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

function extractContactsFromRun(
  cachedRun: CachedApifyRun,
  trustedItems: TrustedItem[],
  identity: CompanyIdentity,
): ExtractedContact[] {
  const contactsByEmail = new Map<string, ExtractedContact>();

  for (const item of trustedItems) {
    const emails = getUniqueMatches(item.sourceText, EMAIL_PATTERN);
    const hasUsefulContactSignal = hasContactUsefulnessSignal(item);

    for (const email of emails) {
      const normalizedEmail = email.toLowerCase();
      const emailDomain = getDomainFromEmail(normalizedEmail);

      if (!domainMatchesCompanyIdentity(emailDomain, identity)) {
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
          confidence: hasUsefulContactSignal ? "high" : "medium",
          reason: hasUsefulContactSignal
            ? "Company-domain email was found directly in a high-trust company-related hiring/referral post."
            : "Company-domain email was found directly in a trusted company-related post and is useful for email pattern discovery, but the post did not include a hiring/referral signal.",
        });
      }
    }
  }

  return Array.from(contactsByEmail.values());
}

function extractDomainsFromRun(
  cachedRun: CachedApifyRun,
  trustedItems: TrustedItem[],
  identity: CompanyIdentity,
): ExtractedDomain[] {
  const domainsByKey = new Map<string, ExtractedDomain>();

  for (const item of trustedItems) {
    const emails = getUniqueMatches(item.sourceText, EMAIL_PATTERN);
    const urls = getUniqueMatches(item.sourceText, URL_PATTERN);
    const plainDomains = getUniqueMatches(item.sourceText, DOMAIN_PATTERN)
      .map(cleanDomain)
      .filter((domain) => domain && !emails.some((email) => email.toLowerCase().endsWith(`@${domain}`)));

    for (const email of emails) {
      const domain = getDomainFromEmail(email);
      const key = `${domain}:email_domain`;

      if (domainMatchesCompanyIdentity(domain, identity) && !domainsByKey.has(key)) {
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
        domainMatchesCompanyIdentity(domain, identity) &&
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

    for (const domain of plainDomains) {
      const key = `${domain}:career_domain`;

      if (
        /career|jobs|job|apply/i.test(domain) &&
        domainMatchesCompanyIdentity(domain, identity) &&
        !domainsByKey.has(key)
      ) {
        domainsByKey.set(key, {
          companyName: cachedRun.companyName,
          domain,
          domainType: "career_domain",
          sourceUrl: item.sourceUrl,
          sourceText: item.sourceText,
          reason: "Company-matching career domain was extracted from plain text in a trusted post.",
        });
      }
    }
  }

  return Array.from(domainsByKey.values());
}

function getCandidateEmailDomains(domains: ExtractedDomain[], identity: CompanyIdentity): string[] {
  return unique([
    ...identity.emailDomains,
    ...domains.map((domain) => domain.domain),
  ]);
}

function getPatternOrder(domain: string, patternsByDomain: Map<string, EmailPattern[]>): EmailPattern[] {
  const inferredPatterns = patternsByDomain.get(domain) ?? [];

  return Array.from(new Set([...inferredPatterns, ...FALLBACK_EMAIL_PATTERNS]));
}

function generateInferredContacts(
  companyPeople: CompanyPerson[],
  directContacts: ExtractedContact[],
  domains: ExtractedDomain[],
  identity: CompanyIdentity,
): ExtractedContact[] {
  const candidateEmailDomains = getCandidateEmailDomains(domains, identity);
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
  const identity = await loadCompanyIdentity(cachedRun.companyName);
  const trustedItems = getTrustedItems(cachedRun, identity);
  const companyPeople = extractCompanyPeople(cachedRun, trustedItems, identity);
  const directContacts = extractContactsFromRun(cachedRun, trustedItems, identity);
  const domains = extractDomainsFromRun(cachedRun, trustedItems, identity);
  const generatedContacts = generateInferredContacts(companyPeople, directContacts, domains, identity);
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
  console.log(`Loaded company identity for ${identity.canonicalName}`);
  console.log(`Known identity domains: ${identity.trustedDomains.join(", ") || "none"}`);
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
