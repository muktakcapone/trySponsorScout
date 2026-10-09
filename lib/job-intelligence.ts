export type Provider = "greenhouse" | "ashby" | "catalog" | "tesla" | "manual";
export type HistorySignal = "strong" | "moderate" | "unknown";
export type SponsorshipStatus =
  | "confirmed"
  | "transfer"
  | "likely"
  | "unknown"
  | "no";
export type Recommendation = "apply" | "verify" | "review" | "skip";

export interface RawJob {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  applyUrl?: string;
  postedAt?: string;
  compensation?: string;
  provider: Provider;
  historySignal?: HistorySignal;
}

export interface JobAnalysis extends RawJob {
  score: number;
  sponsorship: SponsorshipStatus;
  sponsorEvidence: string;
  recommendation: Recommendation;
  matchReasons: string[];
  cautions: string[];
  resumeVariant: string;
  storyHighlights: string[];
}

const NO_SPONSOR_PATTERNS = [
  /not eligible for (?:employment )?(?:visa )?sponsorship/i,
  /(?:do|does|will|can) not (?:provide|offer|support) (?:employment )?(?:visa )?sponsorship/i,
  /unable to (?:provide|offer|support) (?:employment )?(?:visa )?sponsorship/i,
  /no (?:employment )?(?:visa )?sponsorship(?: is)? available/i,
  /must be (?:legally )?authorized[^.]{0,90}without[^.]{0,40}sponsorship/i,
  /cannot sponsor/i,
  /not sponsor[^.]{0,45}now or in the future/i,
  /without (?:current or future )?(?:employment )?(?:visa )?sponsorship/i,
];

const TRANSFER_PATTERNS = [
  /h[- ]?1b transfers?(?: are)? (?:accepted|considered|available|supported)/i,
  /(?:accept|consider|support)(?:s|ing)? h[- ]?1b transfers?/i,
  /visa transfer(?:s)? (?:accepted|considered|available|supported)/i,
];

const YES_SPONSOR_PATTERNS = [
  /(?:visa|immigration) sponsorship (?:is |may be )?available/i,
  /h[- ]?1b (?:visa )?sponsorship/i,
  /(?:provide|offer|support)(?:s|ing)? (?:employment )?(?:visa|immigration) sponsorship/i,
  /immigration support (?:is |may be )?available/i,
  /sponsorship[^.]{0,45}(?:case[- ]by[- ]case|role[- ]dependent)/i,
];

const US_LOCATIONS = [
  "united states",
  "remote - us",
  "remote, us",
  "remote us",
  "new york",
  "new jersey",
  "san francisco",
  "san jose",
  "seattle",
  "austin",
  "dallas",
  "chicago",
  "boston",
  "washington, dc",
  "washington dc",
  "virginia",
  "maryland",
  "california",
  "texas",
  "massachusetts",
  "florida",
  "colorado",
  "georgia",
  "north carolina",
  "pennsylvania",
  "illinois",
  "oregon",
  "arizona",
  "atlanta",
  "denver",
  "miami",
  "orlando",
  "raleigh",
  "charlotte",
  "philadelphia",
  "pittsburgh",
  "mountain view",
  "menlo park",
  "palo alto",
  "redwood city",
  "sunnyvale",
  "bellevue",
];

const NON_US_MARKERS = [
  "canada",
  "united kingdom",
  "ireland",
  "india",
  "germany",
  "france",
  "spain",
  "poland",
  "netherlands",
  "singapore",
  "australia",
  "japan",
  "korea",
  "brazil",
  "mexico",
  "israel",
  "sweden",
  "switzerland",
];

export const TARGET_ROLE_PATTERNS = [
  /technical program manager/i,
  /technology program manager/i,
  /product manager/i,
  /product lead/i,
  /program manager/i,
  /program lead/i,
  /ai governance/i,
  /responsible ai/i,
  /ai risk/i,
  /cybersecurity manager/i,
  /security manager/i,
  /platform manager/i,
  /technology transformation/i,
  /director[^,]*(?:product|program|security|platform|ai)/i,
  /(?:product|program|security|platform|ai)[^,]*director/i,
];

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  bull: "•",
  copy: "©",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  trade: "™",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi,
    (match, entity: string) => {
      const normalized = entity.toLowerCase();

      if (normalized.startsWith("#")) {
        const radix = normalized.startsWith("#x") ? 16 : 10;
        const digits = normalized.slice(radix === 16 ? 2 : 1);
        const codePoint = Number.parseInt(digits, radix);

        if (
          Number.isInteger(codePoint) &&
          codePoint > 0 &&
          codePoint <= 0x10ffff &&
          !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return String.fromCodePoint(codePoint);
        }

        return match;
      }

      return HTML_ENTITIES[normalized] ?? match;
    },
  );
}

export function stripHtml(value: string): string {
  let decoded = value;

  // Some ATS feeds encode markup more than once. Decode a bounded number of
  // layers before stripping tags so encoded HTML never leaks into excerpts.
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decodeHtmlEntities(decoded);
    if (next === decoded) break;
    decoded = next;
  }

  return decoded
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isTargetTitle(title: string): boolean {
  const excluded = /intern|student|new grad|account executive|sales|marketing|designer|recruiter/i;
  return TARGET_ROLE_PATTERNS.some((pattern) => pattern.test(title)) && !excluded.test(title);
}

export function isLikelyUSLocation(location: string): boolean {
  const normalized = location.toLowerCase();
  if (!normalized.trim()) return true;
  if (NON_US_MARKERS.some((marker) => normalized.includes(marker))) return false;
  if (normalized === "remote" || normalized.includes("multiple locations")) return true;
  if (US_LOCATIONS.some((marker) => normalized.includes(marker))) return true;
  return /\b[A-Z]{2}\b/.test(location);
}

function sentenceFor(text: string, pattern: RegExp): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  const sentence = sentences.find((item) => pattern.test(item));
  if (!sentence) return "";
  const words = sentence.trim().split(/\s+/).slice(0, 22);
  return `${words.join(" ")}${sentence.trim().split(/\s+/).length > 22 ? "…" : ""}`;
}

function sponsorshipFor(job: RawJob): {
  status: SponsorshipStatus;
  evidence: string;
} {
  const text = `${job.title}. ${job.description}`;
  for (const pattern of NO_SPONSOR_PATTERNS) {
    if (pattern.test(text)) {
      return {
        status: "no",
        evidence: sentenceFor(text, pattern) || "The role explicitly excludes sponsorship.",
      };
    }
  }
  for (const pattern of TRANSFER_PATTERNS) {
    if (pattern.test(text)) {
      return {
        status: "transfer",
        evidence: sentenceFor(text, pattern) || "The role mentions H-1B or visa transfers.",
      };
    }
  }
  for (const pattern of YES_SPONSOR_PATTERNS) {
    if (pattern.test(text)) {
      return {
        status: "confirmed",
        evidence: sentenceFor(text, pattern) || "The role includes affirmative sponsorship language.",
      };
    }
  }
  if (job.historySignal === "strong") {
    return {
      status: "likely",
      evidence:
        "No role-level language found; the employer has a strong historical sponsorship signal. Verify this requisition.",
    };
  }
  if (job.historySignal === "moderate") {
    return {
      status: "likely",
      evidence:
        "No role-level language found; prior employer filings are a supporting signal only. Verify this requisition.",
    };
  }
  return {
    status: "unknown",
    evidence: "No role-level sponsorship language was found. Ask the recruiter before investing in a full application.",
  };
}

function domainSignals(text: string) {
  return {
    ai: /\bai\b|artificial intelligence|machine learning|generative ai|genai|llm|responsible ai/i.test(text),
    security: /cyber|security|zero trust|casb|dlp|iam|identity|risk|compliance|nist|sse/i.test(text),
    cloud: /cloud|aws|azure|gcp|kubernetes|terraform|infrastructure/i.test(text),
    platform: /platform|api|developer experience|enterprise systems|ecosystem/i.test(text),
    program: /program|portfolio|transformation|cross-functional|stakeholder|roadmap|delivery/i.test(text),
  };
}

function chooseResumeVariant(signals: ReturnType<typeof domainSignals>, title: string) {
  if (signals.ai && /product|governance|risk/i.test(title)) return "AI Product & Governance";
  if (signals.security) return "Security & Cloud Platform";
  if (/technical program|program manager|program lead/i.test(title)) return "Technical Program Management";
  if (signals.ai) return "AI Transformation";
  return "Product & Platform Leadership";
}

function storyHighlightsFor(signals: ReturnType<typeof domainSignals>, title: string) {
  const stories: string[] = [];
  if (signals.ai) {
    stories.push("Representative enterprise AI rollout with governance, adoption, and risk controls");
    stories.push("Sample AI publishing operating model with compliance gates and durable ownership");
  }
  if (signals.security) {
    stories.push("Representative cloud-security control strategy, proof of concept, and policy tuning");
    stories.push("Sample enterprise security rollout with monitoring, incident response, and root-cause analysis");
  }
  if (signals.cloud || signals.platform) {
    stories.push("Enterprise platform work spanning AWS, Azure, GCP, APIs, Kubernetes, and Terraform");
  }
  if (signals.program || /manager|lead|director/i.test(title)) {
    stories.push("Cross-functional delivery, executive communication, vendor leadership, budgets, and engineering teams");
  }
  return [...new Set(stories)].slice(0, 4);
}

export function analyzeJob(job: RawJob): JobAnalysis {
  const title = job.title.trim();
  const text = `${title} ${job.description}`;
  const signals = domainSignals(text);
  const sponsor = sponsorshipFor(job);
  const matchReasons: string[] = [];
  const cautions: string[] = [];
  let score = 18;

  if (/technical program manager|technology program manager/i.test(title)) {
    score += 31;
    matchReasons.push("Direct technical program leadership match");
  } else if (/product manager|product lead/i.test(title)) {
    score += 29;
    matchReasons.push("Direct product leadership match");
  } else if (/program manager|program lead/i.test(title)) {
    score += 25;
    matchReasons.push("Direct enterprise program match");
  } else if (/ai governance|responsible ai|ai risk/i.test(title)) {
    score += 30;
    matchReasons.push("Direct AI governance and risk match");
  } else if (/security manager|cybersecurity manager|platform manager/i.test(title)) {
    score += 27;
    matchReasons.push("Direct security or platform management match");
  } else if (/director/i.test(title) && /product|program|security|platform|ai/i.test(title)) {
    score += 23;
    matchReasons.push("Relevant director-level scope");
  } else if (isTargetTitle(title)) {
    score += 18;
  }

  if (/senior|sr\.?|principal|lead|director|head/i.test(title)) {
    score += 8;
    matchReasons.push("Seniority aligns with the sample candidate’s 12+ years of experience");
  }
  if (signals.ai) {
    score += 7;
    matchReasons.push("Uses enterprise AI, GenAI, or AI-governance experience");
  }
  if (signals.security) {
    score += 8;
    matchReasons.push("Uses cybersecurity, risk, and control expertise");
  }
  if (signals.cloud) {
    score += 5;
    matchReasons.push("Uses multi-cloud and infrastructure background");
  }
  if (signals.platform) {
    score += 4;
    matchReasons.push("Platform and API scope fits prior work");
  }
  if (signals.program) score += 3;
  if (isLikelyUSLocation(job.location)) score += 2;

  const leadershipMatches = [
    /executive/i,
    /cross-functional/i,
    /roadmap/i,
    /strategy/i,
    /stakeholder/i,
    /vendor/i,
    /governance/i,
    /enterprise/i,
  ].filter((pattern) => pattern.test(text)).length;
  score += Math.min(leadershipMatches * 1.5, 7.5);

  if (/intern|new grad|entry.level|junior/i.test(title)) {
    score -= 42;
    cautions.push("Seniority is below target");
  }
  if (/engineer|developer|architect|scientist|designer|analyst|account executive|sales/i.test(title)) {
    score -= 24;
    cautions.push("Title emphasizes a different primary discipline");
  }
  if (/active (?:u\.?s\.? )?security clearance|must (?:be|remain) (?:a )?u\.?s\.? citizen|u\.?s\.? citizenship required/i.test(text)) {
    score -= 35;
    cautions.push("Citizenship or clearance requirement detected");
  }
  if (sponsor.status === "no") cautions.push("Role explicitly excludes sponsorship");
  if (sponsor.status === "unknown") cautions.push("Sponsorship must be confirmed");

  score = Math.max(0, Math.min(99, Math.round(score)));

  let recommendation: Recommendation = "review";
  if (sponsor.status === "no" || cautions.some((item) => item.includes("clearance"))) {
    recommendation = "skip";
  } else if (score >= 80 && ["confirmed", "transfer", "likely"].includes(sponsor.status)) {
    recommendation = "apply";
  } else if (score >= 72 && sponsor.status === "unknown") {
    recommendation = "verify";
  } else if (score < 58) {
    recommendation = "skip";
  }

  return {
    ...job,
    title,
    description: stripHtml(job.description).slice(0, 12000),
    score,
    sponsorship: sponsor.status,
    sponsorEvidence: sponsor.evidence,
    recommendation,
    matchReasons: matchReasons.slice(0, 5),
    cautions,
    resumeVariant: chooseResumeVariant(signals, title),
    storyHighlights: storyHighlightsFor(signals, title),
  };
}

export const DEFAULT_PROFILE = {
  name: "Sample Candidate",
  headline: "Technical program, cloud, cybersecurity & enterprise AI leader",
  experience: "12+ years (fictional demo profile)",
  targetTitles:
    "Principal / Senior Technical Program Manager; Cloud Program Manager; Cybersecurity Program Manager; AI Governance Lead",
  domains: "Cybersecurity, cloud security, enterprise AI, GenAI governance, security platforms, AI transformation",
  locations: "Remote US; major US technology hubs; open to relocation",
  salaryMinimum: "$160,000 preferred (sample input)",
  immigration:
    "Sample candidate requires future employment-based visa sponsorship. Exact eligibility must be confirmed with the employer and qualified immigration counsel.",
};
