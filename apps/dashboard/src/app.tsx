import {
  Bell,
  BriefcaseBusiness,
  Building2,
  ExternalLink,
  Filter,
  LogOut,
  Radar,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Company, Criteria, PersistedJob } from "@kestrel/core";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
import { Input, Textarea } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { cn } from "./lib/utils";

type Job = PersistedJob & { appliedAt: string | null };
type View = "companies" | "jobs" | "criteria" | "notifications";
type Notice = { kind: "status" | "alert"; message: string };

const tokenKey = "kestrel-api-token";
const views: Array<{ id: View; label: string; icon: typeof Building2 }> = [
  { id: "companies", label: "Companies", icon: Building2 },
  { id: "jobs", label: "Jobs", icon: BriefcaseBusiness },
  { id: "criteria", label: "Criteria", icon: Settings2 },
  { id: "notifications", label: "Notifications", icon: Bell },
];

function formString(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function commaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function decodeKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function useApi(token: string) {
  return useCallback(
    async <T,>(path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      if (init.body) headers.set("content-type", "application/json");
      const response = await fetch(path, { ...init, headers });
      if (response.status === 204) return undefined as T;
      const payload = (await response.json()) as T & {
        error?: string;
        retryAfterSeconds?: number;
      };
      if (!response.ok) {
        const retry = payload.retryAfterSeconds
          ? ` Try again in ${payload.retryAfterSeconds} seconds.`
          : "";
        throw new Error(`${payload.error ?? "Request failed."}${retry}`);
      }
      return payload;
    },
    [token],
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[0.7rem] font-bold uppercase tracking-[0.14em] text-station-blue">
      {children}
    </p>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col items-start justify-between gap-6 border-b border-border pb-8 sm:flex-row sm:items-end">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-2 font-display text-5xl leading-none tracking-tight sm:text-7xl">
          {title}
        </h1>
        {description ? <p className="mt-3 text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

function TokenGate({
  initialToken,
  onConnect,
  error,
}: {
  initialToken: string;
  onConnect: (token: string) => void;
  error: string;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onConnect(formString(new FormData(event.currentTarget), "token"));
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[radial-gradient(circle_at_75%_20%,#d3e6ed,transparent_35%)] p-4">
      <section
        aria-labelledby="auth-title"
        className="w-full max-w-lg rounded-xl border border-border bg-card/95 p-8 shadow-xl sm:p-12"
      >
        <div className="mb-8 grid size-11 -rotate-6 place-items-center rounded-[50%_50%_50%_0.25rem] bg-signal font-display text-xl font-bold text-foreground">
          K
        </div>
        <Eyebrow>Private field station</Eyebrow>
        <h1 id="auth-title" className="mt-2 font-display text-5xl leading-none tracking-tight">
          Connect to Kestrel
        </h1>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          Enter the dashboard API token. It stays in this browser and is sent only to this Kestrel
          Worker.
        </p>
        {error ? (
          <p
            role="alert"
            className="mt-5 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
          >
            {error}
          </p>
        ) : null}
        <form className="mt-6 grid gap-3" onSubmit={submit}>
          <Label htmlFor="api-token">API token</Label>
          <Input
            id="api-token"
            name="token"
            type="password"
            autoComplete="current-password"
            defaultValue={initialToken}
            required
          />
          <Button type="submit" className="mt-1">
            Connect
          </Button>
        </form>
      </section>
    </main>
  );
}

function AddCompanyDialog({ onSave }: { onSave: (company: Omit<Company, "id">) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const atsType = formString(data, "atsType") as Company["atsType"];
    setSaving(true);
    try {
      await onSave({
        name: formString(data, "name"),
        atsType,
        boardToken: formString(data, "boardToken") || null,
        careersUrl: formString(data, "careersUrl"),
        status: atsType === "unsupported" ? "unsupported" : "active",
        unsupportedPlatform: formString(data, "unsupportedPlatform") || null,
        notes: null,
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Building2 className="size-4" />
          Add company
        </Button>
      </DialogTrigger>
      <DialogContent>
        <div>
          <Eyebrow>New source</Eyebrow>
          <DialogTitle className="mt-1 font-display text-3xl">Add company</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            Connect an ATS board or add an unsupported company to the manual watchlist.
          </DialogDescription>
        </div>
        <form className="grid gap-4" onSubmit={submit}>
          <Field id="company-name" label="Company name">
            <Input id="company-name" name="name" required />
          </Field>
          <Field id="ats-platform" label="ATS platform">
            <select
              id="ats-platform"
              name="atsType"
              className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
              <option value="unsupported">Unsupported</option>
            </select>
          </Field>
          <Field id="board-token" label="Board token">
            <Input id="board-token" name="boardToken" />
          </Field>
          <Field id="careers-url" label="Careers URL">
            <Input id="careers-url" name="careersUrl" type="url" required />
          </Field>
          <Field id="unsupported-platform" label="Unsupported platform (if applicable)">
            <Input id="unsupported-platform" name="unsupportedPlatform" />
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save company"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CompanyCard({ company }: { company: Company }) {
  const platform =
    company.atsType === "unsupported"
      ? `Unsupported · ${company.unsupportedPlatform ?? "Unknown platform"}`
      : company.atsType;
  return (
    <li className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <span className="grid size-10 place-items-center rounded-md bg-station-sky font-display text-xl text-station-blue">
          {company.name[0]}
        </span>
        <span className="rounded-full bg-muted px-2 py-1 font-mono text-[0.65rem] uppercase text-muted-foreground">
          {company.status}
        </span>
      </div>
      <h3 className="mt-5 text-lg font-semibold">{company.name}</h3>
      <p className="mt-1 font-mono text-xs capitalize text-station-blue">{platform}</p>
      {company.notes ? (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{company.notes}</p>
      ) : null}
      <a
        href={company.careersUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-station-blue underline-offset-4 hover:underline"
      >
        Open careers page
        <ExternalLink className="size-3.5" />
      </a>
    </li>
  );
}

function CompanySection({ title, companies }: { title: string; companies: Company[] }) {
  const id = title.toLowerCase().replaceAll(" ", "-");
  return (
    <section aria-labelledby={id} className="mt-9">
      <div className="mb-4 flex items-center gap-2">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        <span className="rounded-full bg-station-sky px-2 text-xs text-muted-foreground">
          {companies.length}
        </span>
      </div>
      {companies.length ? (
        <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {companies.map((company) => (
            <CompanyCard key={company.id} company={company} />
          ))}
        </ul>
      ) : (
        <EmptyState>No companies in this group.</EmptyState>
      )}
    </section>
  );
}

function CompaniesView({
  companies,
  onSave,
}: {
  companies: Company[];
  onSave: (company: Omit<Company, "id">) => Promise<void>;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Sources"
        title="Companies"
        description="Job boards Kestrel watches on your behalf."
        action={<AddCompanyDialog onSave={onSave} />}
      />
      <CompanySection
        title="Active boards"
        companies={companies.filter((company) => company.atsType !== "unsupported")}
      />
      <CompanySection
        title="Unsupported watchlist"
        companies={companies.filter((company) => company.atsType === "unsupported")}
      />
    </>
  );
}

function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "blue" | "amber" | "red";
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-1 font-mono text-[0.65rem] uppercase",
        tone === "green" && "bg-emerald-100 text-emerald-800",
        tone === "blue" && "bg-blue-100 text-blue-800",
        tone === "amber" && "bg-amber-100 text-amber-800",
        tone === "red" && "bg-red-100 text-red-800",
        tone === "neutral" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function JobsView({
  jobs,
  companies,
  onApplied,
}: {
  jobs: Job[];
  companies: Company[];
  onApplied: (job: Job, applied: boolean) => Promise<void>;
}) {
  const [status, setStatus] = useState("all");
  const [applied, setApplied] = useState("all");
  const visible = jobs.filter(
    (job) =>
      !(status === "active" && job.removedAt) &&
      !(status === "removed" && !job.removedAt) &&
      !(applied === "true" && !job.appliedAt) &&
      !(applied === "false" && job.appliedAt),
  );
  const companyName = (id: string) =>
    companies.find((company) => company.id === id)?.name ?? "Unknown company";
  return (
    <>
      <PageHeader
        eyebrow="Opportunity radar"
        title="Jobs"
        description={`${visible.length} of ${jobs.length} roles in view.`}
      />
      <search
        aria-label="Filter jobs"
        className="my-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3"
      >
        <Filter className="size-4 text-muted-foreground" />
        <Label htmlFor="status-filter">Status</Label>
        <select
          id="status-filter"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-md border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="all">All roles</option>
          <option value="active">Active</option>
          <option value="removed">Removed</option>
        </select>
        <Label htmlFor="applied-filter">Applied</Label>
        <select
          id="applied-filter"
          value={applied}
          onChange={(event) => setApplied(event.target.value)}
          className="rounded-md border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="all">All</option>
          <option value="true">Applied</option>
          <option value="false">Not applied</option>
        </select>
      </search>
      {visible.length ? (
        <div className="relative grid gap-3 before:absolute before:bottom-4 before:left-[0.3rem] before:top-4 before:w-px before:bg-border">
          {visible.map((job) => (
            <article key={job.id} className="relative grid grid-cols-[0.7rem_1fr] gap-4">
              <span
                aria-hidden="true"
                className={cn(
                  "z-10 mt-6 size-3 rounded-full border-2 border-background bg-signal",
                  job.removedAt && "bg-slate-400",
                )}
              />
              <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-station-blue">
                  <span>{companyName(job.companyId)}</span>
                  <StatusBadge
                    tone={
                      job.remoteScope === "remote"
                        ? "green"
                        : job.remoteScope === "hybrid"
                          ? "amber"
                          : "blue"
                    }
                  >
                    {job.remoteScope}
                  </StatusBadge>
                  {job.removedAt ? <StatusBadge tone="red">removed</StatusBadge> : null}
                </div>
                <h2 className="mt-2 font-display text-2xl">
                  <a
                    href={job.absoluteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline-offset-4 hover:underline"
                  >
                    {job.title}
                  </a>
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[job.locationRaw, job.department, job.employmentType]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {job.descriptionSnippet ? (
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {job.descriptionSnippet}
                  </p>
                ) : null}
                <footer className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                  <time dateTime={job.lastSeenAt}>
                    Seen {new Date(job.lastSeenAt).toLocaleDateString()}
                  </time>
                  <Label className="flex items-center gap-2 text-foreground">
                    <Checkbox
                      checked={Boolean(job.appliedAt)}
                      onCheckedChange={(checked) => void onApplied(job, checked === true)}
                    />
                    Applied
                  </Label>
                </footer>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState>No roles match these filters.</EmptyState>
      )}
    </>
  );
}

function CriteriaView({
  criteria,
  onSave,
}: {
  criteria?: Criteria;
  onSave: (criteria: Criteria) => Promise<void>;
}) {
  if (!criteria)
    return (
      <>
        <PageHeader eyebrow="Matching logic" title="Criteria" />
        <EmptyState>No criteria set exists yet.</EmptyState>
      </>
    );
  const currentCriteria = criteria;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onSave({
      ...currentCriteria,
      name: formString(data, "name"),
      enabled: data.get("enabled") === "on",
      titleIncludes: commaList(formString(data, "titleIncludes")),
      titleExcludes: commaList(formString(data, "titleExcludes")),
      locationHardExcludes: commaList(formString(data, "locationHardExcludes")),
      regions: commaList(formString(data, "regions")),
    });
  }
  return (
    <>
      <PageHeader
        eyebrow="Matching logic"
        title="Criteria"
        description="Shape the signal. Separate terms with commas."
      />
      <form onSubmit={submit} className="mt-6 max-w-3xl">
        <fieldset className="grid gap-5 rounded-xl border border-border bg-card p-6 shadow-sm">
          <legend className="px-2 font-display text-2xl">Rule set</legend>
          <div className="grid items-end gap-4 sm:grid-cols-[1fr_auto]">
            <Field id="criteria-name" label="Name">
              <Input id="criteria-name" name="name" defaultValue={criteria.name} />
            </Field>
            <Label className="flex h-10 items-center gap-2">
              <Checkbox name="enabled" defaultChecked={criteria.enabled} />
              Enabled
            </Label>
          </div>
          <Field
            id="title-includes"
            label="Title includes"
            hint="A role must contain at least one of these terms."
          >
            <Textarea
              id="title-includes"
              name="titleIncludes"
              defaultValue={criteria.titleIncludes.join(", ")}
            />
          </Field>
          <Field
            id="title-excludes"
            label="Title excludes"
            hint="Reject titles containing any of these terms."
          >
            <Textarea
              id="title-excludes"
              name="titleExcludes"
              defaultValue={criteria.titleExcludes.join(", ")}
            />
          </Field>
          <Field
            id="location-hard-excludes"
            label="Location hard excludes"
            hint="Locations Kestrel should never match."
          >
            <Textarea
              id="location-hard-excludes"
              name="locationHardExcludes"
              defaultValue={criteria.locationHardExcludes.join(", ")}
            />
          </Field>
          <Field id="regions" label="Regions" hint="Regions to highlight in the feed.">
            <Textarea id="regions" name="regions" defaultValue={criteria.regions.join(", ")} />
          </Field>
          <Button type="submit" className="justify-self-start">
            <Save className="size-4" />
            Save criteria
          </Button>
        </fieldset>
      </form>
    </>
  );
}

function NotificationsView({ onEnable }: { onEnable: () => Promise<void> }) {
  return (
    <>
      <PageHeader
        eyebrow="Desktop signal"
        title="Notifications"
        description="Let Kestrel alert you when a strong new match lands."
      />
      <section
        aria-labelledby="push-title"
        className="mt-8 grid max-w-3xl items-center gap-8 rounded-xl border border-border bg-card p-8 shadow-sm sm:grid-cols-[9rem_1fr]"
      >
        <div
          aria-hidden="true"
          className="grid aspect-square w-28 place-items-center rounded-full border border-station-blue/30 bg-[repeating-radial-gradient(circle,transparent_0_1.25rem,#cbe0e8_1.3rem_1.36rem)]"
        >
          <Radar className="size-10 text-station-blue" />
        </div>
        <div>
          <h2 id="push-title" className="text-xl font-semibold">
            Browser notifications
          </h2>
          <p className="my-3 leading-relaxed text-muted-foreground">
            Notifications are delivered to this browser using secure web push. Your browser will ask
            for permission.
          </p>
          <Button onClick={() => void onEnable()}>
            <Bell className="size-4" />
            Enable notifications
          </Button>
        </div>
      </section>
    </>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="mt-6 rounded-lg border border-dashed border-slate-400 p-8 text-center text-muted-foreground">
      {children}
    </p>
  );
}

function AppShell({
  view,
  jobs,
  notice,
  onNavigate,
  onRefresh,
  onPurge,
  onDisconnect,
  children,
}: {
  view: View;
  jobs: Job[];
  notice: Notice | null;
  onNavigate: (view: View) => void;
  onRefresh: () => void;
  onPurge: () => void;
  onDisconnect: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <a
        href="#main-content"
        className="fixed left-2 top-2 z-[100] -translate-y-24 bg-foreground px-3 py-2 text-white focus:translate-y-0"
      >
        Skip to main content
      </a>
      <div className="min-h-dvh md:grid md:grid-cols-[16rem_minmax(0,1fr)]">
        <header className="flex flex-col bg-foreground p-4 text-white md:sticky md:top-0 md:h-dvh md:p-5">
          <a
            href="#jobs"
            onClick={() => onNavigate("jobs")}
            className="flex items-center gap-3 px-2 font-display text-xl no-underline"
          >
            <span className="grid size-10 -rotate-6 place-items-center rounded-[50%_50%_50%_0.2rem] bg-signal font-bold text-foreground">
              K
            </span>
            <span>
              Kestrel
              <small className="mt-0.5 block font-mono text-[0.55rem] uppercase tracking-[0.15em] text-slate-400">
                Field station
              </small>
            </span>
          </a>
          <nav
            aria-label="Primary"
            className="mt-6 grid grid-cols-4 gap-1 overflow-x-auto md:mt-12 md:grid-cols-1"
          >
            {views.map(({ id, label, icon: Icon }) => (
              <a
                key={id}
                href={`#${id}`}
                aria-current={view === id ? "page" : undefined}
                onClick={() => onNavigate(id)}
                className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-slate-300 no-underline hover:bg-white/10 hover:text-white aria-[current=page]:bg-white/10 aria-[current=page]:text-white"
              >
                <span className="flex items-center gap-2">
                  <Icon className="size-4" />
                  {label}
                </span>
                {id === "jobs" ? (
                  <span className="rounded-full bg-white/10 px-2 text-xs">
                    {jobs.filter((job) => !job.removedAt).length}
                  </span>
                ) : null}
              </a>
            ))}
          </nav>
          <div className="mt-5 grid grid-cols-2 gap-2 md:mt-auto md:grid-cols-1">
            <Button variant="quiet" onClick={onRefresh}>
              <RefreshCw className="size-4" />
              Refresh jobs
            </Button>
            <Button variant="danger" onClick={onPurge}>
              <Trash2 className="size-4" />
              Purge removed jobs
            </Button>
            <Button
              variant="ghost"
              onClick={onDisconnect}
              className="col-span-2 text-slate-400 hover:bg-white/10 hover:text-white md:col-span-1"
            >
              <LogOut className="size-4" />
              Disconnect
            </Button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="min-w-0 p-5 sm:p-8 lg:p-14">
          {notice ? (
            <p
              role={notice.kind}
              className={cn(
                "fixed right-4 top-4 z-50 max-w-md rounded-md border p-3 text-sm shadow-xl",
                notice.kind === "alert"
                  ? "border-red-300 bg-red-50 text-red-900"
                  : "border-emerald-300 bg-emerald-50 text-emerald-900",
              )}
            >
              {notice.message}
            </p>
          ) : null}
          {children}
        </main>
      </div>
    </>
  );
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey) ?? "");
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [authError, setAuthError] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [criteria, setCriteria] = useState<Criteria[]>([]);
  const [view, setView] = useState<View>(() => {
    const hash = location.hash.slice(1);
    return views.some(({ id }) => id === hash) ? (hash as View) : "jobs";
  });
  const [notice, setNotice] = useState<Notice | null>(null);
  const api = useApi(token);

  const load = useCallback(async () => {
    const [companyResult, jobResult, criteriaResult] = await Promise.all([
      api<{ companies: Company[] }>("/api/companies"),
      api<{ jobs: Job[] }>("/api/jobs"),
      api<{ criteria: Criteria[] }>("/api/criteria"),
    ]);
    setCompanies(companyResult.companies);
    setJobs(jobResult.jobs);
    setCriteria(criteriaResult.criteria);
    setConnected(true);
  }, [api]);

  useEffect(() => {
    if (!token) return;
    void load().catch(() => {
      setAuthError("Your saved token could not connect. Check it and try again.");
      setConnected(false);
    });
  }, [connectionAttempt, load, token]);

  const currentView = useMemo(() => {
    if (view === "companies")
      return (
        <CompaniesView
          companies={companies}
          onSave={async (company) => {
            const result = await api<{ company: Company }>("/api/companies", {
              method: "POST",
              body: JSON.stringify(company),
            });
            setCompanies((items) => [...items, result.company]);
            setNotice({ kind: "status", message: "Company saved." });
          }}
        />
      );
    if (view === "criteria")
      return (
        <CriteriaView
          criteria={criteria[0]}
          onSave={async (item) => {
            const result = await api<{ criteria: Criteria }>(
              `/api/criteria/${encodeURIComponent(item.id)}`,
              { method: "PUT", body: JSON.stringify(item) },
            );
            setCriteria([result.criteria]);
            setNotice({ kind: "status", message: "Criteria saved." });
          }}
        />
      );
    if (view === "notifications")
      return (
        <NotificationsView
          onEnable={async () => {
            try {
              if (!("Notification" in window) || !("serviceWorker" in navigator))
                throw new Error("Notifications are not supported in this browser.");
              const permission = await Notification.requestPermission();
              if (permission !== "granted")
                throw new Error("Notification permission was not granted.");
              const { publicKey } = await api<{ publicKey: string }>("/api/push/public-key");
              const registration = await navigator.serviceWorker.register("/service-worker.js");
              const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: decodeKey(publicKey),
              });
              await api("/api/push/subscriptions", {
                method: "POST",
                body: JSON.stringify(subscription.toJSON()),
              });
              setNotice({ kind: "status", message: "Notifications enabled." });
            } catch (cause) {
              setNotice({
                kind: "alert",
                message: cause instanceof Error ? cause.message : "Could not enable notifications.",
              });
            }
          }}
        />
      );
    return (
      <JobsView
        jobs={jobs}
        companies={companies}
        onApplied={async (job, applied) => {
          setJobs((items) =>
            items.map((item) =>
              item.id === job.id
                ? { ...item, appliedAt: applied ? new Date().toISOString() : null }
                : item,
            ),
          );
          try {
            const result = await api<{ appliedAt: string | null }>(
              `/api/jobs/${encodeURIComponent(job.stableKey)}/applied`,
              { method: "PATCH", body: JSON.stringify({ applied }) },
            );
            setJobs((items) =>
              items.map((item) =>
                item.id === job.id ? { ...item, appliedAt: result.appliedAt } : item,
              ),
            );
          } catch (cause) {
            setJobs((items) =>
              items.map((item) =>
                item.id === job.id ? { ...item, appliedAt: job.appliedAt } : item,
              ),
            );
            setNotice({
              kind: "alert",
              message: cause instanceof Error ? cause.message : "Could not update role.",
            });
          }
        }}
      />
    );
  }, [api, companies, criteria, jobs, view]);

  function connect(nextToken: string) {
    localStorage.setItem(tokenKey, nextToken);
    setAuthError("");
    setToken(nextToken);
    setConnectionAttempt((attempt) => attempt + 1);
  }

  async function maintenance(path: string, success: string) {
    try {
      await api(path, { method: "POST" });
      setNotice({ kind: "status", message: success });
    } catch (cause) {
      setNotice({
        kind: "alert",
        message: cause instanceof Error ? cause.message : "Action failed.",
      });
    }
  }

  if (!connected) return <TokenGate initialToken={token} onConnect={connect} error={authError} />;
  return (
    <AppShell
      view={view}
      jobs={jobs}
      notice={notice}
      onNavigate={(next) => {
        setView(next);
        setNotice(null);
      }}
      onRefresh={() => void maintenance("/api/poll", "Refresh complete.")}
      onPurge={() => void maintenance("/api/purge", "Removed jobs purged.")}
      onDisconnect={() => {
        localStorage.removeItem(tokenKey);
        setToken("");
        setConnected(false);
      }}
    >
      {currentView}
    </AppShell>
  );
}
