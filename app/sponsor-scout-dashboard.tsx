"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AccountPanel, accountRequest, type Account } from "./account-panel";
import {
  AlertTriangle,
  ArrowRight,
  Bookmark,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  ExternalLink,
  FileSearch,
  Filter,
  Gauge,
  MapPin,
  Network,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  analyzeJob,
  isLikelyUSLocation,
  type JobAnalysis,
  type Recommendation,
  type SponsorshipStatus,
} from "@/lib/job-intelligence";

type Decision = "saved" | "skipped" | "applied";
type DecisionMap = Record<string, Decision>;
type ApiPayload = {
  jobs: JobAnalysis[];
  generatedAt: string;
  sources: {
    configured: number;
    successful: number;
    failed: number;
    companies: string[];
  };
  search?: { mode: "default" | "company" | "profile"; company?: string; supported?: boolean; source?: string };
  note: string;
};

const SPONSORSHIP_META: Record<
  SponsorshipStatus,
  { label: string; className: string; dot: string }
> = {
  confirmed: {
    label: "Confirmed",
    className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    dot: "bg-emerald-300",
  },
  transfer: {
    label: "Transfer noted",
    className: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
    dot: "bg-cyan-300",
  },
  likely: {
    label: "Likely",
    className: "border-sky-400/30 bg-sky-400/10 text-sky-200",
    dot: "bg-sky-300",
  },
  unknown: {
    label: "Verify",
    className: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    dot: "bg-amber-300",
  },
  no: {
    label: "No sponsorship",
    className: "border-rose-400/30 bg-rose-400/10 text-rose-200",
    dot: "bg-rose-300",
  },
};

const RECOMMENDATION_META: Record<Recommendation, { label: string; className: string }> = {
  apply: { label: "Apply", className: "bg-emerald-300 text-slate-950" },
  verify: { label: "Verify first", className: "bg-amber-300 text-slate-950" },
  review: { label: "Review", className: "bg-sky-300 text-slate-950" },
  skip: { label: "Skip", className: "bg-slate-700 text-slate-200" },
};

const LANE_FILTERS = [
  { value: "all", label: "All target lanes" },
  { value: "tpm", label: "Technical program" },
  { value: "product", label: "Product" },
  { value: "ai", label: "AI & governance" },
  { value: "security", label: "Security & cloud" },
];

const emptyManual = {
  title: "",
  company: "",
  location: "",
  url: "",
  description: "",
};

type VisitorProfile = {
  name: string;
  headline: string;
  experienceYears: string;
  targetTitles: string;
  skills: string;
  locations: string;
  sponsorship: "needed" | "not-needed" | "unsure";
  resumeHighlights: string;
};

const EMPTY_VISITOR_PROFILE: VisitorProfile = {
  name: "",
  headline: "",
  experienceYears: "",
  targetTitles: "",
  skills: "",
  locations: "",
  sponsorship: "unsure",
  resumeHighlights: "",
};

const SWATI_OPTICS_EXAMPLE: VisitorProfile = {
  name: "Swati",
  headline: "Photonics researcher and optical-systems engineer",
  experienceYears: "5",
  targetTitles: "Photonics Engineer, Optical Engineer, Optical Systems Engineer, Research Scientist, Laser Engineer",
  skills: "photonics, optics, waveguides, femtosecond laser writing, Zemax, Lumerical FDTD, optical characterization, fiber optics",
  locations: "United States; open to relocation",
  sponsorship: "needed",
  resumeHighlights: "Designed, fabricated, and characterized waveguide optical devices\nBuilt a femtosecond-laser-writing platform\nModeled photonic structures with Zemax and Lumerical FDTD\nPublished and presented photonics research",
};

function profileTerms(value: string) {
  return value.toLowerCase().split(/[,;|\n]+/).map((term) => term.trim()).filter((term) => term.length > 2);
}

function personalizeJob(job: JobAnalysis, profile: VisitorProfile): JobAnalysis {
  const text = `${job.title} ${job.description}`.toLowerCase();
  const titles = profileTerms(profile.targetTitles);
  const skills = profileTerms(profile.skills);
  const highlights = profile.resumeHighlights.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const titleMatches = titles.filter((term) => job.title.toLowerCase().includes(term) || term.includes(job.title.toLowerCase()));
  const skillMatches = skills.filter((term) => text.includes(term));
  let score = 22;
  const matchReasons: string[] = [];
  if (titleMatches.length) { score += 40; matchReasons.push(`Matches target title: ${titleMatches[0]}`); }
  else if (titles.some((term) => term.split(/\s+/).some((word) => word.length > 5 && job.title.toLowerCase().includes(word)))) { score += 22; matchReasons.push("Related to a selected target role"); }
  if (skillMatches.length) { score += Math.min(25, 7 + skillMatches.length * 4); matchReasons.push(`Relevant skills: ${skillMatches.slice(0, 3).join(", ")}`); }
  if (/senior|sr\.?|staff|principal|lead|director/i.test(job.title) && Number(profile.experienceYears) >= 7) { score += 8; matchReasons.push("Seniority aligns with the experience profile"); }
  if (isLikelyUSLocation(job.location)) score += 5;
  const matchingHighlights = highlights.filter((line) => profileTerms(line.replace(/\s+/g, ",")).some((term) => term.length > 4 && text.includes(term)));
  if (matchingHighlights.length) { score += Math.min(10, matchingHighlights.length * 3); matchReasons.push("Resume highlights overlap with the role"); }
  score = Math.max(0, Math.min(99, Math.round(score)));
  let recommendation: Recommendation = "review";
  if (job.sponsorship === "no" || job.cautions.some((item) => item.toLowerCase().includes("clearance"))) recommendation = "skip";
  else if (score >= 80 && ["confirmed", "transfer", "likely"].includes(job.sponsorship)) recommendation = "apply";
  else if (score >= 72 && job.sponsorship === "unknown") recommendation = "verify";
  else if (score < 55) recommendation = "skip";
  return { ...job, score, recommendation, matchReasons: matchReasons.length ? matchReasons.slice(0, 5) : ["Review against the complete profile"], resumeVariant: "Personalized profile", storyHighlights: matchingHighlights.slice(0, 4).length ? matchingHighlights.slice(0, 4) : highlights.slice(0, 4) };
}

function laneMatches(job: JobAnalysis, lane: string) {
  const text = `${job.title} ${job.description}`;
  if (lane === "tpm") return /technical program|program manager|program lead|transformation/i.test(text);
  if (lane === "product") return /product manager|product lead|product strategy/i.test(text);
  if (lane === "ai") return /\bai\b|genai|generative ai|llm|responsible ai|ai governance/i.test(text);
  if (lane === "security") return /cyber|security|cloud|casb|dlp|iam|risk|compliance|platform/i.test(text);
  return true;
}

function relativeDate(value?: string) {
  if (!value) return "Date not listed";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Date not listed";
  const hours = Math.max(0, Math.floor((Date.now() - timestamp) / 3_600_000));
  if (hours < 1) return "Updated recently";
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `Updated ${days}d ago`;
  return `Updated ${new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function linkedinSearchUrl(job: JobAnalysis) {
  const keywords = encodeURIComponent(`${job.company} ${job.title} recruiter hiring manager`);
  return `https://www.linkedin.com/search/results/people/?keywords=${keywords}`;
}

function ScoreBadge({ score, compact = false }: { score: number; compact?: boolean }) {
  const tone = score >= 85 ? "text-emerald-200" : score >= 72 ? "text-cyan-200" : "text-slate-300";
  return (
    <div
      className={`relative grid shrink-0 place-items-center rounded-2xl border border-white/10 bg-slate-950/55 ${
        compact ? "h-14 w-14" : "h-[4.35rem] w-[4.35rem]"
      }`}
      aria-label={`Fit score ${score} out of 100`}
    >
      <span className={`text-xl font-semibold tabular-nums ${tone}`}>{score}</span>
      <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">fit</span>
      <span className="absolute inset-x-2 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <span className="block h-full bg-current text-primary" style={{ width: `${score}%` }} />
      </span>
    </div>
  );
}

function SponsorPill({ status }: { status: SponsorshipStatus }) {
  const meta = SPONSORSHIP_META[status];
  return (
    <Badge variant="outline" className={`gap-1.5 rounded-full px-2.5 py-1 font-medium ${meta.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </Badge>
  );
}

function JobCard({
  job,
  decision,
  onOpen,
  onDecision,
}: {
  job: JobAnalysis;
  decision?: Decision;
  onOpen: () => void;
  onDecision: (decision: Decision) => void;
}) {
  const recommendation = RECOMMENDATION_META[job.recommendation];
  return (
    <article
      className={`group relative overflow-hidden rounded-2xl border bg-card/80 p-5 shadow-[0_20px_55px_-42px_rgba(101,217,255,0.8)] transition hover:-translate-y-0.5 hover:border-cyan-300/35 hover:bg-card ${
        decision === "skipped" ? "opacity-55" : ""
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        aria-label={`Open ${job.title} at ${job.company}`}
      />
      <div className="pointer-events-none relative z-10 flex items-start gap-4">
        <ScoreBadge score={job.score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SponsorPill status={job.sponsorship} />
            <Badge className={`rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] ${recommendation.className}`}>
              {recommendation.label}
            </Badge>
            {decision && <span className="text-xs capitalize text-slate-400">Marked {decision}</span>}
          </div>
          <h3 className="mt-3 text-lg font-semibold leading-snug text-white transition group-hover:text-cyan-100">{job.title}</h3>
          <p className="mt-1 font-medium text-slate-300">{job.company}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
            <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" /> {job.location}</span>
            <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" /> {relativeDate(job.postedAt)}</span>
            {job.compensation && <span>{job.compensation}</span>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {job.matchReasons.slice(0, 3).map((reason) => (
              <span key={reason} className="rounded-md bg-slate-950/45 px-2 py-1 text-xs text-slate-300">{reason}</span>
            ))}
          </div>
        </div>
        <ChevronRight className="mt-2 size-5 shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-cyan-300" />
      </div>
      <div className="relative z-20 mt-5 flex items-center justify-between border-t border-white/8 pt-4">
        <span className="pointer-events-none text-xs text-slate-500">Use: {job.resumeVariant}</span>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={decision === "saved" ? "text-primary" : "text-slate-300"}
            onClick={() => onDecision("saved")}
          >
            <Bookmark className={`size-4 ${decision === "saved" ? "fill-current" : ""}`} /> Save
          </Button>
          <Button type="button" size="sm" variant="ghost" className="text-slate-400 hover:text-rose-200" onClick={() => onDecision("skipped")}>
            <X className="size-4" /> Skip
          </Button>
        </div>
      </div>
    </article>
  );
}

export function SponsorScoutDashboard() {
  const accountIdRef = useRef<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountReady, setAccountReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("roles");
  const [payload, setPayload] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [activeCompany, setActiveCompany] = useState("");
  const [lane, setLane] = useState("all");
  const [sponsorFilter, setSponsorFilter] = useState("all");
  const [scoreFloor, setScoreFloor] = useState("0");
  const [decisionFilter, setDecisionFilter] = useState("all");
  const [selected, setSelected] = useState<JobAnalysis | null>(null);
  const [decisions, setDecisions] = useState<DecisionMap>({});
  const [manual, setManual] = useState(emptyManual);
  const [manualResult, setManualResult] = useState<JobAnalysis | null>(null);
  const [profile, setProfile] = useState<VisitorProfile>(EMPTY_VISITOR_PROFILE);
  const [customProfileActive, setCustomProfileActive] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");

  async function loadJobs(company = activeCompany) {
    setLoading(true);
    setError("");
    try {
      const companyQuery = company.trim();
      const response = await fetch(companyQuery ? `/api/jobs?company=${encodeURIComponent(companyQuery)}` : "/api/jobs", { cache: "no-store" });
      if (!response.ok) throw new Error("The live sources did not respond.");
      setPayload((await response.json()) as ApiPayload);
      setActiveCompany(companyQuery);
    } catch {
      setError("Live career systems could not be reached just now. You can still analyze any job description in the JD Analyzer.");
    } finally {
      setLoading(false);
    }
  }

  function restoreAccount(next: Account | null) {
    accountIdRef.current = next?.id || null;
    setAccount(next);
    const restored = next?.profile?.targetTitles ? { ...EMPTY_VISITOR_PROFILE, ...next.profile } as VisitorProfile : { ...EMPTY_VISITOR_PROFILE, name: next?.name || "" };
    setProfile(restored);
    setDecisions(next?.decisions || {});
    setCustomProfileActive(Boolean(restored.targetTitles));
    setSelected(null); setManualResult(null); setManual(emptyManual);
    setQuery(""); setLane("all"); setScoreFloor("0"); setDecisionFilter("all"); setSponsorFilter("all");
    setProfileMessage(next ? "Signed in. Your account profile and saved roles are available." : "Signed out. Your account data has been cleared from this screen.");
    if (next) setActiveTab("profile");
    if (restored.targetTitles) {
      setLoading(true);setError("");setPayload(null);
      const discoveryTerms = `${restored.targetTitles}; ${restored.skills}`.slice(0, 180);
      void fetch(`/api/jobs?profileQuery=${encodeURIComponent(discoveryTerms)}`, { cache: "no-store" })
        .then(response => { if (!response.ok) throw new Error(); return response.json(); })
        .then(data => {setPayload(data as ApiPayload);setActiveCompany("");})
        .catch(() => setError("Your account is loaded, but personalized roles are temporarily unavailable."))
        .finally(() => setLoading(false));
    } else {setPayload(null);void loadJobs("");}
  }

  useEffect(() => {
    // Older device-local data is never silently imported into another person's account.
    fetch("/api/account/me", { cache: "no-store", credentials: "same-origin" })
      .then(response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => restoreAccount((data as {account: Account|null}).account))
      .catch(() => { setError("Account service could not be reached. Reload before signing in; you can still browse jobs."); void loadJobs(""); })
      .finally(() => setAccountReady(true));
  }, []);

  async function clearProfile() {
    try {
      if (account) await accountRequest("clear-profile");
      setProfile(EMPTY_VISITOR_PROFILE);setCustomProfileActive(false);setProfileMessage("Personal profile cleared.");
      setPayload(null);void loadJobs("");
    } catch(e) {setProfileMessage((e as Error).message);}
  }

  async function applyProfile() {
    if (!profile.targetTitles.trim() || !profile.skills.trim()) {
      setProfileMessage("Add at least one target title and a few skills.");
      return;
    }
    if (!account) { setProfileMessage("Sign in or create an account to save your profile and personalize your search."); return; }
    setSaving(true);
    try { await accountRequest("profile", { profile }); }
    catch(e) { setProfileMessage((e as Error).message); setSaving(false); return; }
    setCustomProfileActive(true);
    setProfileMessage("Profile saved to your account. Searching current U.S. roles…");
    setLoading(true);
    setError("");
    try {
      const discoveryTerms = `${profile.targetTitles}; ${profile.skills}`.slice(0, 180);
      const response = await fetch(`/api/jobs?profileQuery=${encodeURIComponent(discoveryTerms)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Profile search failed");
      setPayload((await response.json()) as ApiPayload);
      setActiveCompany("");
      setLane("all");
      setScoreFloor("55");
      setProfileMessage("Personalized results are ready. Your profile is saved to your account.");
      setActiveTab("roles");
    } catch {
      setProfileMessage("The personalized search source is temporarily unavailable. Your profile remains saved to your account.");
    } finally {
      setLoading(false);
      setSaving(false);
    }
  }

  const scoredJobs = useMemo(() => (payload?.jobs ?? []).map((job) => customProfileActive ? personalizeJob(job, profile) : job).sort((a, b) => b.score - a.score), [payload, customProfileActive, profile]);

  async function setDecision(id: string, value: Decision) {
    if (!account) {setProfileMessage("Sign in or create an account to save roles to your personal queue.");setActiveTab("profile");return;}
    const accountId = account.id;
    try { await accountRequest("decision", { id, value }); if (accountIdRef.current === accountId) setDecisions(current => ({...current, [id]:value})); }
    catch(e) {setError((e as Error).message);}
  }

  const filteredJobs = useMemo(() => {
    const search = query.trim().toLowerCase();
    return scoredJobs.filter((job) => {
      const decision = decisions[job.id];
      if (search && !`${job.title} ${job.company} ${job.location} ${job.description}`.toLowerCase().includes(search)) return false;
      if (!laneMatches(job, lane)) return false;
      if (job.score < Number(scoreFloor)) return false;
      if (sponsorFilter === "actionable" && !["confirmed", "transfer", "likely", "unknown"].includes(job.sponsorship)) return false;
      if (sponsorFilter !== "all" && sponsorFilter !== "actionable" && job.sponsorship !== sponsorFilter) return false;
      if (decisionFilter === "active" && decision === "skipped") return false;
      if (decisionFilter !== "all" && decisionFilter !== "active" && decision !== decisionFilter) return false;
      return true;
    });
  }, [scoredJobs, query, lane, sponsorFilter, scoreFloor, decisionFilter, decisions]);

  const stats = useMemo(() => {
    const jobs = scoredJobs;
    return {
      highFit: jobs.filter((job) => job.score >= 85).length,
      apply: jobs.filter((job) => job.recommendation === "apply").length,
      verify: jobs.filter((job) => ["likely", "unknown"].includes(job.sponsorship)).length,
      saved: Object.values(decisions).filter((decision) => decision === "saved").length,
    };
  }, [scoredJobs, decisions]);

  function analyzeManualJob() {
    if (!manual.title.trim() || !manual.description.trim()) return;
    const result = analyzeJob({
        id: `manual:${Date.now()}`,
        title: manual.title,
        company: manual.company || "Company not listed",
        location: manual.location || "Location not listed",
        description: manual.description,
        url: manual.url || "#",
        applyUrl: manual.url || undefined,
        provider: "manual",
        historySignal: "unknown",
      });
    setManualResult(customProfileActive ? personalizeJob(result, profile) : result);
  }

  return (
    <main className="signal-grid min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-px overflow-hidden bg-white/5"><div className="scanline mx-auto h-px w-1/2" /></div>

      <header className="sticky top-0 z-40 border-b border-white/8 bg-[#07111f]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-5 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-[0_0_28px_-10px_rgba(114,232,197,0.9)]"><Radar className="size-5" /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold tracking-tight text-white">SponsorScout</span>
                <Badge variant="outline" className="hidden rounded-full border-cyan-300/25 bg-cyan-300/5 text-[10px] uppercase tracking-[0.16em] text-cyan-200 sm:inline-flex">V1</Badge>
              </div>
              <p className="truncate text-xs text-slate-400">Your job search · your personal account</p>
            </div>
          </div>
          <AccountPanel account={account} ready={accountReady} onAccount={restoreAccount} />
        </div>
      </header>

      <div className="mx-auto max-w-[1480px] px-4 py-5 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 text-sm leading-6 text-cyan-50/85">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-cyan-300" />
          <p><span className="font-semibold text-cyan-100">Public tool.</span> Search without preset criteria, or create an account to save a profile tailored to your own career. Job listings come from public sources; sponsorship labels are screening signals, not legal advice.</p>
        </div>
        <Tabs value={activeTab} onValueChange={(value) => value && setActiveTab(value)} className="gap-5">
          <div className="flex flex-col gap-4 border-b border-white/8 pb-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Career signal desk</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Find the roles worth your time.</h1>
            </div>
            <TabsList variant="line" className="h-auto w-full flex-wrap justify-start gap-2 lg:w-fit">
              <TabsTrigger value="roles" className="px-3 py-2.5"><BriefcaseBusiness /> Live roles</TabsTrigger>
              <TabsTrigger value="analyzer" className="px-3 py-2.5"><FileSearch /> JD Analyzer</TabsTrigger>
              <TabsTrigger value="profile" className="border-cyan-200! bg-cyan-300! px-4 py-2.5 font-semibold text-slate-950! shadow-[0_0_18px_rgba(103,232,249,0.16)]! hover:bg-cyan-200! data-[state=active]:bg-cyan-200! focus-visible:ring-cyan-200 after:bg-cyan-300"><Target /> Personalize <span className="ml-1 rounded-full bg-slate-950/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">Start here</span></TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="roles" className="space-y-5">
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Job search summary">
              {[
                { label: "High-fit roles", value: stats.highFit, icon: Gauge, color: "text-emerald-300" },
                { label: "Apply queue", value: stats.apply, icon: CheckCircle2, color: "text-cyan-300" },
                { label: "Verify with recruiter", value: stats.verify, icon: CircleHelp, color: "text-amber-300" },
                { label: "Saved", value: stats.saved, icon: Bookmark, color: "text-violet-300" },
              ].map((item) => (
                <article key={item.label} className="rounded-2xl border border-white/8 bg-card/60 px-4 py-3.5">
                  <div className="flex items-center justify-between"><span className="text-sm text-slate-400">{item.label}</span><item.icon className={`size-4 ${item.color}`} /></div>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{loading ? "—" : item.value}</p>
                </article>
              ))}
            </section>

            <section className="rounded-2xl border border-white/8 bg-[#0a1727]/90 p-3 sm:p-4">
              <div className="mb-4 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.045] p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="min-w-0 lg:w-64">
                    <p className="text-sm font-semibold text-cyan-100">Search a specific company</p>
                    <p className="mt-0.5 text-xs text-slate-400">Search direct feeds first, then expanded public job sources.</p>
                  </div>
                  <label className="relative block min-w-0 flex-1">
                    <span className="sr-only">Company name</span>
                    <Network className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-cyan-300/70" />
                    <Input
                      value={companyName}
                      onChange={(event) => setCompanyName(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter" && companyName.trim()) void loadJobs(companyName); }}
                      placeholder="Try Anthropic, Reddit, Databricks…"
                      className="h-10 border-white/10 bg-slate-950/45 pl-9 text-base placeholder:text-slate-600"
                    />
                  </label>
                  <Button type="button" onClick={() => void loadJobs(companyName)} disabled={loading || !companyName.trim()} className="h-10 bg-cyan-300 text-slate-950 hover:bg-cyan-200">
                    <Search className="size-4" /> Scan company
                  </Button>
                  {activeCompany && <Button type="button" variant="outline" onClick={() => { setCompanyName(""); void loadJobs(""); }} disabled={loading} className="h-10 border-white/10 bg-transparent text-slate-300"><X className="size-4" /> Clear</Button>}
                </div>
                {activeCompany && (
                  <p className={`mt-3 text-xs ${payload?.search?.supported ? "text-cyan-100/80" : "text-amber-200"}`}>
                    {payload?.search?.supported
                      ? `Showing all available U.S. roles from ${activeCompany} via ${payload.search.source || "public career data"}. Add filters below to narrow the results.`
                      : `SponsorScout could not verify current roles for ${activeCompany} from either a direct feed or the expanded catalogue. Try the JD Analyzer with a role link or description.`}
                  </p>
                )}
              </div>
              <div className="grid gap-3 xl:grid-cols-[minmax(240px,1fr)_190px_175px_160px_auto]">
                <label className="relative block">
                  <span className="sr-only">Search roles</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, company, skill…" className="h-10 border-white/10 bg-slate-950/45 pl-9 text-base placeholder:text-slate-600" />
                </label>
                <Select value={lane} onValueChange={(value) => value && setLane(value)}>
                  <SelectTrigger className="h-10 w-full border-white/10 bg-slate-950/45"><SelectValue /></SelectTrigger>
                  <SelectContent>{LANE_FILTERS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={sponsorFilter} onValueChange={(value) => value && setSponsorFilter(value)}>
                  <SelectTrigger className="h-10 w-full border-white/10 bg-slate-950/45"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="actionable">Sponsorship: actionable</SelectItem>
                    <SelectItem value="confirmed">Confirmed only</SelectItem>
                    <SelectItem value="transfer">Transfer noted</SelectItem>
                    <SelectItem value="likely">Likely only</SelectItem>
                    <SelectItem value="unknown">Needs verification</SelectItem>
                    <SelectItem value="no">No sponsorship</SelectItem>
                    <SelectItem value="all">All signals</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={scoreFloor} onValueChange={(value) => value && setScoreFloor(value)}>
                  <SelectTrigger className="h-10 w-full border-white/10 bg-slate-950/45"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="85">Fit: 85+</SelectItem>
                    <SelectItem value="70">Fit: 70+</SelectItem>
                    <SelectItem value="55">Fit: 55+</SelectItem>
                    <SelectItem value="0">Any fit score</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={() => void loadJobs()} disabled={loading} className="h-10 bg-primary text-primary-foreground hover:bg-primary/90"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>{payload ? `${payload.sources.successful} of ${payload.sources.configured} employer feeds responding · ${payload.jobs.length} target roles found` : "Checking sponsor-forward employer career systems…"}</span>
                <Select value={decisionFilter} onValueChange={(value) => value && setDecisionFilter(value)}>
                  <SelectTrigger size="sm" className="border-white/8 bg-transparent text-xs"><Filter className="size-3.5" /> <SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Hide skipped</SelectItem>
                    <SelectItem value="saved">Saved only</SelectItem>
                    <SelectItem value="applied">Applied only</SelectItem>
                    <SelectItem value="skipped">Skipped only</SelectItem>
                    <SelectItem value="all">All decisions</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </section>

            <div className="grid items-start gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
              <aside className="space-y-4 lg:sticky lg:top-24">
                <section className="rounded-2xl border border-primary/15 bg-primary/[0.055] p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary"><ShieldCheck className="size-4" /> Sponsorship logic</div>
                  <div className="mt-4 space-y-3 text-sm text-slate-300">
                    <div className="flex gap-2"><span className="mt-1 size-2 shrink-0 rounded-full bg-emerald-300" /><span>Role text confirms sponsorship</span></div>
                    <div className="flex gap-2"><span className="mt-1 size-2 shrink-0 rounded-full bg-sky-300" /><span>Employer history supports a likely signal</span></div>
                    <div className="flex gap-2"><span className="mt-1 size-2 shrink-0 rounded-full bg-amber-300" /><span>No language: verify before applying</span></div>
                    <div className="flex gap-2"><span className="mt-1 size-2 shrink-0 rounded-full bg-rose-300" /><span>Explicit restriction: skip</span></div>
                  </div>
                </section>
                <section className="rounded-2xl border border-white/8 bg-card/55 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Current profile</p>
                  <p className="mt-2 text-sm font-medium text-white">{customProfileActive ? `${profile.name || "My profile"} · ${profile.experienceYears || "—"}+ years` : "Sample profile · 12+ years · TPM"}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{customProfileActive ? profile.headline : "Cloud, cybersecurity, enterprise platforms, and AI governance."}</p>
                  <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.055] p-3 text-xs leading-5 text-amber-100/80">{customProfileActive ? (profile.sponsorship === "needed" ? "Needs employment-based sponsorship; verify each role." : profile.sponsorship === "not-needed" ? "Does not require sponsorship." : "Work-authorization needs are not yet specified.") : "Requires future employment-based sponsorship; role-level eligibility must be verified."}</div>
                  <Button type="button" variant="outline" onClick={() => setActiveTab("profile")} className="mt-3 w-full border-white/10">Edit profile</Button>
                </section>
                <a href="https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub" target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-white/8 px-4 py-3 text-sm text-slate-300 transition hover:border-cyan-300/25 hover:text-cyan-200">USCIS employer data hub <ExternalLink className="size-3.5" /></a>
              </aside>

              <section aria-live="polite" aria-busy={loading}>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm text-slate-400">{loading ? "Scanning live feeds…" : `${filteredJobs.length} prioritized role${filteredJobs.length === 1 ? "" : "s"}`}</p>
                  {payload?.generatedAt && <p className="hidden text-xs text-slate-600 sm:block">Last scan {new Date(payload.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>}
                </div>
                {loading && <div className="grid gap-3">{[1, 2, 3].map((item) => <div key={item} className="h-48 animate-pulse rounded-2xl border border-white/8 bg-card/50" />)}</div>}
                {!loading && error && (
                  <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-6">
                    <AlertTriangle className="size-6 text-amber-300" /><h2 className="mt-3 font-semibold text-white">Live scan paused</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{error}</p>
                    <Button className="mt-4" variant="outline" onClick={() => void loadJobs()}><RefreshCw /> Try again</Button>
                  </div>
                )}
                {!loading && !error && filteredJobs.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/15 bg-card/35 p-8 text-center">
                    <Search className="mx-auto size-7 text-slate-500" /><h2 className="mt-3 font-semibold text-white">No roles match these filters</h2><p className="mt-2 text-sm text-slate-400">Lower the fit threshold or include roles that need sponsorship verification.</p>
                  </div>
                )}
                {!loading && !error && filteredJobs.length > 0 && (
                  <div className="grid gap-3">{filteredJobs.map((job) => <JobCard key={job.id} job={job} decision={decisions[job.id]} onOpen={() => setSelected(job)} onDecision={(decision) => setDecision(job.id, decision)} />)}</div>
                )}
              </section>
            </div>
          </TabsContent>

          <TabsContent value="analyzer">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)]">
              <section className="rounded-2xl border border-white/8 bg-card/65 p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-cyan-300/10 p-2.5 text-cyan-300"><FileSearch className="size-5" /></div>
                  <div><h2 className="text-xl font-semibold text-white">Analyze any job description</h2><p className="mt-1 text-sm leading-6 text-slate-400">Paste a role from LinkedIn or another site. The analyzer checks fit, sponsorship wording, and the resume stories to emphasize.</p></div>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-sm text-slate-300"><span>Job title *</span><Input value={manual.title} onChange={(event) => setManual({ ...manual, title: event.target.value })} placeholder="Senior Technical Program Manager" className="bg-slate-950/40" /></label>
                  <label className="space-y-2 text-sm text-slate-300"><span>Company</span><Input value={manual.company} onChange={(event) => setManual({ ...manual, company: event.target.value })} placeholder="Company name" className="bg-slate-950/40" /></label>
                  <label className="space-y-2 text-sm text-slate-300"><span>Location</span><Input value={manual.location} onChange={(event) => setManual({ ...manual, location: event.target.value })} placeholder="New York, NY / Remote" className="bg-slate-950/40" /></label>
                  <label className="space-y-2 text-sm text-slate-300"><span>Job URL</span><Input value={manual.url} onChange={(event) => setManual({ ...manual, url: event.target.value })} placeholder="https://…" className="bg-slate-950/40" /></label>
                </div>
                <label className="mt-4 block space-y-2 text-sm text-slate-300">
                  <span>Complete job description *</span>
                  <Textarea value={manual.description} onChange={(event) => setManual({ ...manual, description: event.target.value })} placeholder="Paste the complete role description, including work-authorization language…" className="min-h-72 resize-y bg-slate-950/40 text-base leading-6" />
                </label>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">Nothing is submitted or applied to automatically.</p>
                  <Button onClick={analyzeManualJob} disabled={!manual.title.trim() || !manual.description.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90"><Sparkles className="size-4" /> Analyze role</Button>
                </div>
              </section>

              <section className="min-h-[34rem] rounded-2xl border border-white/8 bg-[#091626]/75 p-5 sm:p-6">
                {!manualResult ? (
                  <div className="grid h-full min-h-[30rem] place-items-center text-center"><div><div className="mx-auto grid size-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.035] text-slate-500"><Gauge className="size-6" /></div><h2 className="mt-4 font-semibold text-white">Your analysis will appear here</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-400">The result separates job fit from sponsorship confidence so an attractive role does not hide an immigration blocker.</p></div></div>
                ) : (
                  <div>
                    <div className="flex items-start justify-between gap-4">
                      <div><div className="flex flex-wrap gap-2"><SponsorPill status={manualResult.sponsorship} /><Badge className={`rounded-full ${RECOMMENDATION_META[manualResult.recommendation].className}`}>{RECOMMENDATION_META[manualResult.recommendation].label}</Badge></div><h2 className="mt-4 text-xl font-semibold text-white">{manualResult.title}</h2><p className="mt-1 text-slate-400">{manualResult.company} · {manualResult.location}</p></div>
                      <ScoreBadge score={manualResult.score} compact />
                    </div>
                    <div className="mt-6 rounded-xl border border-white/8 bg-slate-950/40 p-4"><p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Sponsorship evidence</p><p className="mt-2 text-sm leading-6 text-slate-200">{manualResult.sponsorEvidence}</p></div>
                    <div className="mt-5"><p className="text-sm font-semibold text-white">Why it matches</p><ul className="mt-3 space-y-2">{manualResult.matchReasons.map((reason) => <li key={reason} className="flex gap-2 text-sm text-slate-300"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{reason}</li>)}</ul></div>
                    {manualResult.cautions.length > 0 && <div className="mt-5"><p className="text-sm font-semibold text-white">Watch-outs</p><ul className="mt-3 space-y-2">{manualResult.cautions.map((caution) => <li key={caution} className="flex gap-2 text-sm text-amber-100/80"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />{caution}</li>)}</ul></div>}
                    <div className="mt-5 rounded-xl border border-primary/15 bg-primary/[0.055] p-4"><p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">Use resume</p><p className="mt-1 font-semibold text-white">{manualResult.resumeVariant}</p><ul className="mt-3 space-y-2">{manualResult.storyHighlights.map((story) => <li key={story} className="text-sm leading-6 text-slate-300">• {story}</li>)}</ul></div>
                  </div>
                )}
              </section>
            </div>
          </TabsContent>

          <TabsContent value="profile">
            {!account && <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-cyan-300/25 bg-cyan-300/5 p-5"><div><h2 className="font-semibold text-white">Make this search yours</h2><p className="mt-1 text-sm text-slate-400">Create an account to save your profile and job choices across devices.</p></div><p className="text-sm text-cyan-200">Use Sign in / Create account above to get started.</p></div>}
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
              <section className="rounded-2xl border border-white/8 bg-card/65 p-5 sm:p-7">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Target className="size-5" /></div><div><h2 className="text-xl font-semibold text-white">Build your search profile</h2><p className="mt-1 text-sm text-slate-400">Tell SponsorScout what work fits you. You can change it anytime.</p></div></div><Button type="button" variant="outline" onClick={() => { setProfile(SWATI_OPTICS_EXAMPLE); setProfileMessage("Optics example loaded. Review it, then run the search."); }} className="shrink-0 border-cyan-300/20 text-cyan-100">Load optics example</Button></div>
                <div className="mt-7 grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-sm text-slate-300"><span>Name or label</span><Input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} placeholder="My profile" className="bg-slate-950/40" /></label>
                  <label className="space-y-2 text-sm text-slate-300"><span>Years of relevant experience</span><Input value={profile.experienceYears} onChange={(event) => setProfile({ ...profile, experienceYears: event.target.value.replace(/[^0-9]/g, "").slice(0, 2) })} inputMode="numeric" placeholder="8" className="bg-slate-950/40" /></label>
                  <label className="space-y-2 text-sm text-slate-300 sm:col-span-2"><span>Professional headline</span><Input value={profile.headline} onChange={(event) => setProfile({ ...profile, headline: event.target.value })} placeholder="Photonics researcher and optical-systems engineer" className="bg-slate-950/40" /></label>
                  <label className="space-y-2 text-sm text-slate-300 sm:col-span-2"><span>Target job titles *</span><Textarea value={profile.targetTitles} onChange={(event) => setProfile({ ...profile, targetTitles: event.target.value })} placeholder="Photonics Engineer, Optical Engineer, Research Scientist" className="min-h-24 resize-y bg-slate-950/40 text-base" /></label>
                  <label className="space-y-2 text-sm text-slate-300 sm:col-span-2"><span>Skills and domains *</span><Textarea value={profile.skills} onChange={(event) => setProfile({ ...profile, skills: event.target.value })} placeholder="photonics, waveguides, Zemax, laser systems, optical characterization" className="min-h-24 resize-y bg-slate-950/40 text-base" /></label>
                  <label className="space-y-2 text-sm text-slate-300"><span>Location preferences</span><Input value={profile.locations} onChange={(event) => setProfile({ ...profile, locations: event.target.value })} placeholder="United States; open to relocation" className="bg-slate-950/40" /></label>
                  <label className="space-y-2 text-sm text-slate-300"><span>Employment sponsorship</span><Select value={profile.sponsorship} onValueChange={(value) => value && setProfile({ ...profile, sponsorship: value as VisitorProfile["sponsorship"] })}><SelectTrigger className="w-full bg-slate-950/40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="needed">I need sponsorship</SelectItem><SelectItem value="not-needed">I do not need sponsorship</SelectItem><SelectItem value="unsure">I’m not sure</SelectItem></SelectContent></Select></label>
                  <label className="space-y-2 text-sm text-slate-300 sm:col-span-2"><span>Résumé highlights</span><Textarea value={profile.resumeHighlights} onChange={(event) => setProfile({ ...profile, resumeHighlights: event.target.value })} placeholder="Paste 4–8 concise accomplishments or areas of expertise, one per line." className="min-h-36 resize-y bg-slate-950/40 text-base leading-6" /></label>
                  <label className="sm:col-span-2 rounded-xl border border-dashed border-white/15 bg-slate-950/25 p-4 text-sm text-slate-300"><span className="font-medium text-white">Or load a plain-text résumé</span><span className="mt-1 block text-xs leading-5 text-slate-500">TXT or Markdown files are read in your browser. The extracted text is stored in your account when you save your profile. For PDF or Word, paste highlights above.</span><input type="file" accept=".txt,.md,text/plain,text/markdown" className="mt-3 block w-full text-xs text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-cyan-300 file:px-3 file:py-2 file:font-medium file:text-slate-950" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; const text = await file.text(); setProfile({ ...profile, resumeHighlights: text.slice(0, 12000) }); setProfileMessage("Résumé text loaded locally. Review the profile before searching."); }} /></label>
                </div>
                <div className="mt-5 flex flex-col gap-3 border-t border-white/8 pt-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-slate-500">Your profile, including résumé highlights, is saved to your account. Only target titles and skill keywords are used for job discovery.</p><Button type="button" onClick={() => void applyProfile()} disabled={!accountReady || saving || loading || !profile.targetTitles.trim() || !profile.skills.trim()} className="shrink-0 bg-primary text-primary-foreground"><Search className="size-4" /> {saving ? "Saving…" : "Save & search roles"}</Button></div>
                {profileMessage && <p className="mt-3 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.05] px-3 py-2 text-sm text-cyan-100/80">{profileMessage}</p>}
              </section>
              <div className="space-y-5">
                <section className="rounded-2xl border border-primary/18 bg-primary/[0.055] p-5"><div className="flex items-center gap-2 font-semibold text-primary"><ShieldCheck className="size-5" /> Privacy by default</div><p className="mt-3 text-sm leading-6 text-slate-300">Your saved profile and job choices belong to your account. Other visitors cannot access them. Passwords are stored as salted hashes. Keep your recovery code private; it can reset your password.</p><Button type="button" variant="ghost" onClick={() => void clearProfile()} className="mt-3 px-0 text-slate-400 hover:bg-transparent hover:text-rose-200"><X className="size-4" /> Clear my profile</Button></section>
                <section className="rounded-2xl border border-amber-300/18 bg-amber-300/[0.055] p-5"><div className="flex items-center gap-2 font-semibold text-amber-200"><ShieldCheck className="size-5" /> Sponsorship screening</div><p className="mt-3 text-sm leading-6 text-amber-50/75">SponsorScout detects employer language and supporting filing signals. It does not determine immigration eligibility; verify the specific role with the employer and qualified counsel.</p></section>
                <section className="rounded-2xl border border-white/8 bg-card/55 p-5"><p className="font-semibold text-white">Search boundaries</p><ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300"><li className="flex gap-2"><Check className="mt-1 size-4 shrink-0 text-primary" />Searches public employer career feeds</li><li className="flex gap-2"><Check className="mt-1 size-4 shrink-0 text-primary" />Separates UNKNOWN from NO sponsorship</li><li className="flex gap-2"><Check className="mt-1 size-4 shrink-0 text-primary" />Keeps application submission under your control</li><li className="flex gap-2"><X className="mt-1 size-4 shrink-0 text-rose-300" />Does not scrape or automate LinkedIn</li></ul></section>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto border-l-white/10 bg-[#091525] sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader className="border-b border-white/8 px-5 pb-5 pt-6 pr-12">
                <div className="flex items-start gap-4"><ScoreBadge score={selected.score} compact /><div className="min-w-0"><div className="flex flex-wrap gap-2"><SponsorPill status={selected.sponsorship} /><Badge className={`rounded-full ${RECOMMENDATION_META[selected.recommendation].className}`}>{RECOMMENDATION_META[selected.recommendation].label}</Badge></div><SheetTitle className="mt-3 text-xl leading-snug text-white">{selected.title}</SheetTitle><SheetDescription className="mt-1 text-slate-400">{selected.company} · {selected.location}</SheetDescription></div></div>
              </SheetHeader>
              <div className="space-y-6 px-5 py-2">
                <section><div className="flex items-center justify-between text-sm"><span className="font-medium text-white">Profile fit</span><span className="tabular-nums text-slate-400">{selected.score}/100</span></div><Progress value={selected.score} className="mt-2 bg-white/8 [&_[data-slot=progress-indicator]]:bg-primary" /><ul className="mt-4 space-y-2.5">{selected.matchReasons.map((reason) => <li key={reason} className="flex gap-2 text-sm leading-5 text-slate-300"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{reason}</li>)}</ul></section>
                <section className="rounded-xl border border-white/8 bg-slate-950/45 p-4"><p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Sponsorship signal</p><p className="mt-2 text-sm leading-6 text-slate-200">{selected.sponsorEvidence}</p><p className="mt-3 text-xs leading-5 text-slate-500">Company history is supporting evidence only. Confirm the specific requisition and candidate circumstances with the recruiter.</p></section>
                {selected.cautions.length > 0 && <section><p className="font-medium text-white">Watch-outs</p><ul className="mt-3 space-y-2">{selected.cautions.map((caution) => <li key={caution} className="flex gap-2 text-sm text-amber-100/80"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />{caution}</li>)}</ul></section>}
                <section className="rounded-xl border border-primary/15 bg-primary/[0.055] p-4"><p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">Resume strategy</p><p className="mt-1 font-semibold text-white">Use: {selected.resumeVariant}</p><ul className="mt-3 space-y-2">{selected.storyHighlights.map((story) => <li key={story} className="text-sm leading-6 text-slate-300">• {story}</li>)}</ul></section>
                {selected.description && <details className="rounded-xl border border-white/8 bg-white/[0.025] p-4"><summary className="cursor-pointer text-sm font-medium text-slate-300">Source description excerpt</summary><p className="mt-3 line-clamp-[12] text-sm leading-6 text-slate-400">{selected.description}</p></details>}
              </div>
              <SheetFooter className="sticky bottom-0 mt-auto border-t border-white/8 bg-[#091525]/95 px-5 py-4 backdrop-blur">
                <div className="grid w-full grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => setDecision(selected.id, "saved")} className="border-white/12"><Bookmark className="size-4" /> Save role</Button>
                  <Button variant="outline" asChild className="border-white/12"><a href={linkedinSearchUrl(selected)} target="_blank" rel="noreferrer"><Network className="size-4" /> Find people</a></Button>
                  {selected.applyUrl && selected.applyUrl !== "#" ? <Button asChild className="col-span-2 bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setDecision(selected.id, "applied")}><a href={selected.applyUrl} target="_blank" rel="noreferrer">Open employer application <ArrowRight className="size-4" /></a></Button> : <Button className="col-span-2" disabled>Application URL unavailable</Button>}
                </div>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
