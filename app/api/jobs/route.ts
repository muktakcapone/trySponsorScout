import { analyzeJob, isLikelyUSLocation, isTargetTitle, type HistorySignal, type JobAnalysis } from "@/lib/job-intelligence";

export const dynamic = "force-dynamic";

type Source = {
  company: string;
  provider: "greenhouse" | "ashby" | "tesla";
  board: string;
  historySignal: HistorySignal;
};

const SOURCES: Source[] = [
  { company: "OpenAI", provider: "ashby", board: "openai", historySignal: "strong" },
  { company: "Cloudflare", provider: "greenhouse", board: "cloudflare", historySignal: "strong" },
  { company: "Figma", provider: "greenhouse", board: "figma", historySignal: "strong" },
  { company: "Reddit", provider: "greenhouse", board: "reddit", historySignal: "strong" },
  { company: "Samsara", provider: "greenhouse", board: "samsara", historySignal: "strong" },
  { company: "Scale AI", provider: "greenhouse", board: "scaleai", historySignal: "strong" },
  { company: "Datadog", provider: "greenhouse", board: "datadog", historySignal: "strong" },
  { company: "Databricks", provider: "greenhouse", board: "databricks", historySignal: "strong" },
  { company: "Notion", provider: "ashby", board: "notion", historySignal: "strong" },
  { company: "Ramp", provider: "ashby", board: "ramp", historySignal: "moderate" },
  { company: "Vanta", provider: "ashby", board: "vanta", historySignal: "moderate" },
];

const COMPANY_BOARD_ALIASES: Record<string, Partial<Record<Source["provider"], string>>> = {
  anthropic: { greenhouse: "anthropic" },
  openai: { ashby: "openai" },
  "scale ai": { greenhouse: "scaleai" },
  datadog: { greenhouse: "datadog" },
  databricks: { greenhouse: "databricks" },
  notion: { ashby: "notion" },
  ramp: { ashby: "ramp" },
  vanta: { ashby: "vanta" },
};

// Tesla's global careers-state response is large and is intermittently blocked
// at the edge. This current employer-index snapshot keeps company search useful
// when that request is unavailable; every card still links to Tesla directly.
const TESLA_TARGET_FALLBACK = [
  ["282262", "Product Manager, Design Technology", "Palo Alto, California"],
  ["276028", "Robotics Technical Program Manager, Electronics, Optimus", "Palo Alto, California"],
  ["281985", "Program Manager, Business Process & Software", "Fremont, California"],
  ["272894", "Technical Program Manager, People Products", "Palo Alto, California"],
  ["281592", "Sr. Data Operations Program Manager, Optimus", "Palo Alto, California"],
  ["281584", "Technical Program Manager, Service NPI", "Fremont, California"],
  ["281499", "Technical Program Manager, Cell Manufacturing Engineering", "Sparks, Nevada"],
  ["279987", "Technical Program Manager, Change Adoption & Sustainment, Industrial Storage OPX", "Palo Alto, California"],
  ["274094", "Staff Engineering Program Manager, Megapack Hardware", "Palo Alto, California"],
  ["281273", "Sr. Technical Program Manager, Packaging PMO", "Fremont, California"],
  ["280955", "Technical Program Manager, Sensing Products", "Palo Alto, California"],
  ["281087", "Sr. Technical Program Manager, NPI, Semi", "Sparks, Nevada"],
  ["280968", "Systems & Automation Program Manager", "Fremont, California"],
  ["279530", "Program Manager, Robotaxi Customer Operations", "Palo Alto, California"],
  ["275085", "Technical Program Manager, Fleet Operations", "Palo Alto, California"],
  ["266469", "Sr. Technical Program Manager, Battery Manufacturing Development", "Palo Alto, California"],
  ["279986", "Technical Program Manager, Commissioning & Site Lifecycle, Industrial Storage OPX", "Palo Alto, California"],
  ["274080", "Sr. Technical Program Manager, Energy Products", "Palo Alto, California"],
  ["279058", "Product Manager, Home Charging Software", "Palo Alto, California"],
  ["280232", "Sr. Technical Program Manager, Applications Engineering", "Fremont, California"],
] as const;

function teslaFallback(source: Source): JobAnalysis[] {
  return TESLA_TARGET_FALLBACK.map(([id, title, location]) => {
    const url = `https://www.tesla.com/careers/search/job/${id}`;
    return analyzeJob({ id: `tesla:${id}`, title, company: source.company, location, description: "", url, applyUrl: url, provider: "tesla", historySignal: source.historySignal });
  });
}

function companySlug(company: string) {
  return company.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "").trim();
}

function sourcesForCompany(company: string): Source[] {
  const normalized = company.trim().toLowerCase();
  if (normalizedCompanyName(company) === "tesla") return [{ company: "Tesla", provider: "tesla", board: "tesla", historySignal: "strong" }];
  const known = SOURCES.filter((source) => source.company.toLowerCase() === normalized);
  if (known.length) return known;

  const aliases = COMPANY_BOARD_ALIASES[normalized];
  const fallbackSlug = companySlug(company);
  return (["greenhouse", "ashby"] as const).map((provider) => ({
    company: company.trim(),
    provider,
    board: aliases?.[provider] || fallbackSlug,
    historySignal: "unknown",
  }));
}

async function fetchTesla(source: Source): Promise<JobAnalysis[]> {
  type TeslaListing = { id?: string; t?: string; l?: string };
  type TeslaState = { listings?: TeslaListing[]; lookup?: { locations?: Record<string, string> } };
  type TeslaDetail = {
    id?: string;
    title?: string;
    location?: string;
    state?: string;
    country?: string;
    jobDescription?: string;
    jobResponsibilities?: string;
    jobRequirements?: string;
    jobCompensationAndBenefits?: string;
    url?: string;
    applyUrl?: string;
    postUntilDate?: string;
  };
  let state: TeslaState;
  try {
    state = await getTeslaJson<TeslaState>("https://www.tesla.com/cua-api/apps/careers/state", 30000);
  } catch {
    return teslaFallback(source);
  }
  const candidates = (state.listings ?? []).filter((job) => job.id && job.t && isTargetTitle(job.t)).flatMap((job) => {
    const location = job.l ? state.lookup?.locations?.[job.l] || "" : "";
    return isLikelyUSLocation(location) ? [{ job, location }] : [];
  }).slice(0, 18);
  const details = await Promise.allSettled(candidates.map(({ job }) => getTeslaJson<TeslaDetail>(`https://www.tesla.com/cua-api/careers/job/${job.id}`, 14000)));
  return details.flatMap((result, index) => {
    if (result.status !== "fulfilled") return [];
    const job = result.value;
    const fallback = candidates[index];
    const title = job.title || fallback?.job.t || "";
    const location = [job.location || fallback?.location, job.state, job.country].filter(Boolean).join(", ");
    if (!title || !isLikelyUSLocation(location)) return [];
    const description = [job.jobDescription, job.jobResponsibilities, job.jobRequirements, job.jobCompensationAndBenefits].filter(Boolean).join("\n");
    const directUrl = job.url?.startsWith("http") ? job.url : `https://www.tesla.com${job.url || `/careers/search/job/${job.id}`}`;
    return [analyzeJob({
      id: `tesla:${job.id || fallback?.job.id}`,
      title,
      company: source.company,
      location,
      description,
      url: directUrl,
      applyUrl: job.applyUrl || directUrl,
      postedAt: job.postUntilDate,
      provider: "tesla",
      historySignal: source.historySignal,
    })];
  });
}

async function getTeslaJson<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.tesla.com/careers/search/?site=US",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      },
    });
    if (!response.ok) throw new Error(`Tesla returned ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(url: string, timeoutMs = 8500): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "SponsorScout/1.0 (+career-research)",
      },
    });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function countryIsUS(country?: string | null) {
  if (!country) return null;
  return /^(usa|us|u\.s\.|united states|united states of america)$/i.test(country.trim());
}

async function fetchGreenhouse(source: Source, includeAllTitles = false): Promise<JobAnalysis[]> {
  type ListJob = {
    id: number;
    title: string;
    absolute_url: string;
    updated_at?: string;
    location?: { name?: string };
  };
  type DetailJob = ListJob & { content?: string };

  const base = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board)}`;
  const list = await getJson<{ jobs?: ListJob[] }>(`${base}/jobs`);
  const candidates = (list.jobs ?? [])
    .filter((job) => includeAllTitles || isTargetTitle(job.title))
    .filter((job) => isLikelyUSLocation(job.location?.name ?? ""))
    .slice(0, includeAllTitles ? 80 : 10);

  const details = await Promise.allSettled(
    candidates.map((job) => getJson<DetailJob>(`${base}/jobs/${job.id}`, 6500)),
  );

  return details.flatMap((result, index) => {
    const fallback = candidates[index];
    const job = result.status === "fulfilled" ? result.value : fallback;
    if (!job) return [];
    return [
      analyzeJob({
        id: `greenhouse:${source.board}:${job.id}`,
        title: job.title,
        company: source.company,
        location: job.location?.name || "Location not listed",
        description: "content" in job && typeof job.content === "string" ? job.content : "",
        url: job.absolute_url,
        applyUrl: job.absolute_url,
        postedAt: job.updated_at,
        provider: "greenhouse",
        historySignal: source.historySignal,
      }),
    ];
  });
}

async function fetchAshby(source: Source, includeAllTitles = false): Promise<JobAnalysis[]> {
  type AshbyJob = {
    id?: string;
    title: string;
    location?: string;
    secondaryLocations?: { location?: string; address?: { addressCountry?: string } }[];
    isListed?: boolean;
    isRemote?: boolean;
    workplaceType?: string;
    descriptionPlain?: string;
    descriptionHtml?: string;
    publishedAt?: string;
    employmentType?: string;
    jobUrl?: string;
    applyUrl?: string;
    address?: { postalAddress?: { addressCountry?: string } };
    compensation?: {
      compensationTierSummary?: string;
      scrapeableCompensationSalarySummary?: string;
    };
  };

  const data = await getJson<{ jobs?: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.board)}?includeCompensation=true`,
    10500,
  );

  return (data.jobs ?? [])
    .filter((job) => job.isListed !== false && (!job.employmentType || job.employmentType === "FullTime"))
    .filter((job) => includeAllTitles || isTargetTitle(job.title))
    .filter((job) => {
      const primaryCountry = job.address?.postalAddress?.addressCountry;
      const secondaryCountries = job.secondaryLocations?.map((item) => item.address?.addressCountry).filter(Boolean) ?? [];
      const countryMatches = [primaryCountry, ...secondaryCountries].map(countryIsUS).filter((value) => value !== null);
      if (countryMatches.length) return countryMatches.some(Boolean);
      return job.isRemote === true || isLikelyUSLocation(job.location ?? "");
    })
    .slice(0, includeAllTitles ? 80 : 14)
    .map((job, index) =>
      analyzeJob({
        id: `ashby:${source.board}:${job.id ?? index}`,
        title: job.title,
        company: source.company,
        location: [job.location, job.workplaceType].filter(Boolean).join(" · ") || "Location not listed",
        description: job.descriptionPlain || job.descriptionHtml || "",
        url: job.jobUrl || job.applyUrl || `https://jobs.ashbyhq.com/${source.board}`,
        applyUrl: job.applyUrl || job.jobUrl,
        postedAt: job.publishedAt,
        compensation:
          job.compensation?.scrapeableCompensationSalarySummary ||
          job.compensation?.compensationTierSummary,
        provider: "ashby",
        historySignal: source.historySignal,
      }),
    );
}

function normalizedCompanyName(value: string) {
  return value.toLowerCase().replace(/\b(inc|incorporated|corp|corporation|llc|ltd|limited)\b/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

function externalLocation(job: Record<string, unknown>) {
  if (typeof job.location === "string" && job.location.trim()) return job.location.trim();
  if (Array.isArray(job.locations)) {
    const locations = job.locations.flatMap((value) => {
      if (typeof value === "string") return [value];
      if (value && typeof value === "object") {
        const item = value as Record<string, unknown>;
        return [item.name, item.city, item.state, item.country].filter((part): part is string => typeof part === "string");
      }
      return [];
    });
    if (locations.length) return [...new Set(locations)].join(" · ");
  }
  const parts = [job.city, job.state, job.country].filter((part): part is string => typeof part === "string" && Boolean(part.trim()));
  return parts.join(", ") || "United States";
}

function externalUrl(job: Record<string, unknown>) {
  for (const key of ["apply_url", "application_url", "source_url", "job_url", "external_url", "url"]) {
    const value = job[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  }
  const slug = typeof job.public_slug === "string" ? job.public_slug : "";
  return slug ? `https://freehire.me/jobs/${encodeURIComponent(slug)}` : "https://freehire.me/jobs";
}

async function fetchCatalogCompany(company: string): Promise<{ found: boolean; jobs: JobAnalysis[] }> {
  type CompanyRow = { slug?: string; name?: string; job_count?: number };
  const companyResults = await getJson<{ data?: CompanyRow[] }>(
    `https://freehire.me/api/v1/companies?q=${encodeURIComponent(company)}&countries=US&limit=20`,
    10000,
  );
  const requested = normalizedCompanyName(company);
  const candidates = companyResults.data ?? [];
  const match = candidates.find((item) => normalizedCompanyName(item.name || item.slug || "") === requested)
    ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!match?.slug) return { found: false, jobs: [] };

  const response = await getJson<{ data?: Record<string, unknown>[] }>(
    `https://freehire.me/api/v1/agent/jobs/search?company_slug=${encodeURIComponent(match.slug)}&countries=US&description_format=text&sort=posted_at&order=desc&limit=100`,
    14000,
  );
  const jobs = (response.data ?? []).flatMap((job, index) => {
    const title = typeof job.title === "string" ? job.title : "";
    const description = typeof job.description === "string" ? job.description : "";
    const location = externalLocation(job);
    if (!title || !isLikelyUSLocation(location)) return [];
    const employer = typeof job.company === "string"
      ? job.company
      : typeof job.company_name === "string"
      ? job.company_name
      : job.company && typeof job.company === "object" && typeof (job.company as Record<string, unknown>).name === "string"
        ? String((job.company as Record<string, unknown>).name)
        : match.name || company;
    const url = externalUrl(job);
    const salaryMin = typeof job.salary_min === "number" ? job.salary_min : null;
    const salaryMax = typeof job.salary_max === "number" ? job.salary_max : null;
    const currency = typeof job.salary_currency === "string" ? job.salary_currency : "USD";
    const compensation = salaryMin || salaryMax
      ? `${currency} ${salaryMin ? salaryMin.toLocaleString("en-US") : "?"}–${salaryMax ? salaryMax.toLocaleString("en-US") : "?"}`
      : undefined;
    return [analyzeJob({
      id: `catalog:${match.slug}:${String(job.id || job.public_slug || index)}`,
      title,
      company: employer,
      location,
      description,
      url,
      applyUrl: url,
      postedAt: typeof job.posted_at === "string" ? job.posted_at : typeof job.created_at === "string" ? job.created_at : undefined,
      compensation,
      provider: "catalog",
      historySignal: "unknown",
    })];
  });
  return { found: true, jobs };
}

async function fetchCatalogSearch(searchTerms: string): Promise<JobAnalysis[]> {
  const response = await getJson<{ data?: Record<string, unknown>[] }>(
    `https://freehire.me/api/v1/agent/jobs/search?q=${encodeURIComponent(searchTerms.slice(0, 180))}&countries=US&description_format=text&sort=posted_at&order=desc&limit=100`,
    16000,
  );
  const terms = searchTerms.toLowerCase().split(/[,;|\n]+|\s{2,}/).map((term) => term.trim()).filter((term) => term.length > 2);
  return (response.data ?? []).flatMap((job, index) => {
    const title = typeof job.title === "string" ? job.title : "";
    const description = typeof job.description === "string" ? job.description : "";
    const location = externalLocation(job);
    const haystack = `${title} ${description}`.toLowerCase();
    if (!title || !isLikelyUSLocation(location) || (terms.length && !terms.some((term) => haystack.includes(term)))) return [];
    const employer = typeof job.company === "string" ? job.company : typeof job.company_name === "string" ? job.company_name : "Employer not listed";
    const url = externalUrl(job);
    return [analyzeJob({
      id: `catalog:profile:${String(job.id || job.public_slug || index)}`,
      title,
      company: employer,
      location,
      description,
      url,
      applyUrl: url,
      postedAt: typeof job.posted_at === "string" ? job.posted_at : typeof job.created_at === "string" ? job.created_at : undefined,
      provider: "catalog",
      historySignal: "unknown",
    })];
  });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const query = (requestUrl.searchParams.get("q") || "").trim().toLowerCase();
  const company = (requestUrl.searchParams.get("company") || "").trim();
  const profileQuery = (requestUrl.searchParams.get("profileQuery") || "").trim();
  if (profileQuery) {
    try {
      const jobs = await fetchCatalogSearch(profileQuery);
      return Response.json({ jobs, generatedAt: new Date().toISOString(), sources: { configured: 1, successful: 1, failed: 0, companies: [...new Set(jobs.map((job) => job.company))] }, search: { mode: "profile", supported: true, source: "expanded public job sources" }, note: "Only target-title and skill keywords are used for job discovery." });
    } catch {
      return Response.json({ jobs: [], generatedAt: new Date().toISOString(), sources: { configured: 1, successful: 0, failed: 1, companies: [] }, search: { mode: "profile", supported: false, source: "expanded public job sources" }, note: "Profile search is temporarily unavailable." });
    }
  }
  const activeSources = company ? sourcesForCompany(company) : SOURCES;
  const settled = await Promise.allSettled(
    activeSources.map((source) => source.provider === "greenhouse" ? fetchGreenhouse(source, Boolean(company)) : source.provider === "ashby" ? fetchAshby(source, Boolean(company)) : fetchTesla(source)),
  );

  let successfulSources = settled.filter((item) => item.status === "fulfilled").length;
  let failedSources = settled.length - successfulSources;
  const unique = new Map<string, JobAnalysis>();

  settled.forEach((result) => {
    if (result.status !== "fulfilled") return;
    result.value.forEach((job) => {
      const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}::${job.location.toLowerCase()}`;
      const existing = unique.get(key);
      if (!existing || job.score > existing.score) unique.set(key, job);
    });
  });

  let catalogUsed = false;
  if (company && successfulSources === 0) {
    try {
      const catalog = await fetchCatalogCompany(company);
      if (catalog.found) {
        catalogUsed = true;
        successfulSources = 1;
        failedSources = 0;
        catalog.jobs.forEach((job) => unique.set(`${job.company.toLowerCase()}::${job.title.toLowerCase()}::${job.location.toLowerCase()}`, job));
      }
    } catch {
      // Keep the unsupported result: the UI distinguishes source failure from zero suitable roles.
    }
  }

  const jobs = [...unique.values()]
    .filter((job) => {
      if (!query) return true;
      return `${job.title} ${job.company} ${job.location} ${job.description}`.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Date.parse(b.postedAt || "0") - Date.parse(a.postedAt || "0");
    })
    .slice(0, 80);

  return Response.json({
    jobs,
    generatedAt: new Date().toISOString(),
    sources: {
      configured: activeSources.length,
      successful: successfulSources,
      failed: failedSources,
      companies: activeSources.map((source) => source.company),
    },
    search: company ? { mode: "company", company, supported: successfulSources > 0, source: catalogUsed ? "expanded catalog" : "direct employer feed" } : { mode: "default" },
    note:
      "Sponsorship classifications are screening signals, not legal determinations. Confirm each role with the recruiter or employer immigration counsel.",
  });
}
