import "./style.css";

type Company = {
  id: string;
  name: string;
  atsType: string;
  boardToken: string | null;
  careersUrl: string;
  status: string;
  unsupportedPlatform?: string | null;
  notes?: string | null;
};

type Job = {
  id: string;
  companyId: string;
  stableKey: string;
  title: string;
  locationRaw: string;
  remoteScope: string;
  regions: string[];
  department: string | null;
  employmentType: string | null;
  absoluteUrl: string;
  descriptionSnippet: string | null;
  lastSeenAt: string;
  removedAt: string | null;
  appliedAt: string | null;
};

type Criteria = {
  id: string;
  name: string;
  enabled: boolean;
  titleIncludes: string[];
  titleExcludes: string[];
  locationHardExcludes: string[];
  regions: string[];
};

type View = "companies" | "jobs" | "criteria" | "notifications";

const app = document.querySelector<HTMLDivElement>("#app")!;
const tokenKey = "kestrel-api-token";
let token = localStorage.getItem(tokenKey) ?? "";
let companies: Company[] = [];
let jobs: Job[] = [];
let criteria: Criteria[] = [];
let view: View = "jobs";
let jobStatus = "all";
let appliedFilter = "all";
let notice: { kind: "status" | "alert"; message: string } | null = null;

const textValue = (value: unknown) => (typeof value === "string" ? value : "");
const formValue = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

const escapeHtml = (value: unknown) =>
  textValue(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
  });
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
}

function feedback(kind: "status" | "alert", message: string) {
  notice = { kind, message };
  render();
}

async function loadData() {
  const [companyResult, jobResult, criteriaResult] = await Promise.all([
    api<{ companies: Company[] }>("/api/companies"),
    api<{ jobs: Job[] }>("/api/jobs"),
    api<{ criteria: Criteria[] }>("/api/criteria"),
  ]);
  companies = companyResult.companies;
  jobs = jobResult.jobs;
  criteria = criteriaResult.criteria;
}

function authScreen(error = "") {
  app.innerHTML = `
    <main class="auth-shell" id="main-content">
      <section class="auth-card" aria-labelledby="auth-title">
        <div class="mark" aria-hidden="true">K</div>
        <p class="eyebrow">Private field station</p>
        <h1 id="auth-title">Connect to Kestrel</h1>
        <p class="lede">Enter the dashboard API token. It stays in this browser and is sent only to this Kestrel Worker.</p>
        ${error ? `<p class="message message--error" role="alert">${escapeHtml(error)}</p>` : ""}
        <form id="token-form" class="stack">
          <label for="api-token">API token</label>
          <input id="api-token" name="token" type="password" autocomplete="current-password" required value="${escapeHtml(token)}">
          <button class="button button--primary" type="submit">Connect</button>
        </form>
      </section>
    </main>`;
  document
    .querySelector<HTMLFormElement>("#token-form")!
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      token = formValue(new FormData(event.currentTarget as HTMLFormElement).get("token")).trim();
      localStorage.setItem(tokenKey, token);
      try {
        await loadData();
        render();
      } catch (cause) {
        authScreen(cause instanceof Error ? cause.message : "Could not connect.");
      }
    });
}

const companyName = (id: string) =>
  companies.find((company) => company.id === id)?.name ?? "Unknown company";
const splitList = (value: FormDataEntryValue | null) =>
  formValue(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function companyView() {
  const supported = companies.filter((company) => company.atsType !== "unsupported");
  const unsupported = companies.filter((company) => company.atsType === "unsupported");
  const cards = (items: Company[]) =>
    items.length
      ? `<ul class="company-grid">${items
          .map(
            (company) => `<li class="company-card">
              <div class="company-card__top"><span class="company-initial">${escapeHtml(company.name[0])}</span><span class="badge">${escapeHtml(company.status)}</span></div>
              <h3>${escapeHtml(company.name)}</h3>
              <p class="company-platform">${company.atsType === "unsupported" ? `Unsupported · ${escapeHtml(company.unsupportedPlatform ?? "Unknown platform")}` : escapeHtml(company.atsType)}</p>
              ${company.notes ? `<p class="muted">${escapeHtml(company.notes)}</p>` : ""}
              <a href="${escapeHtml(company.careersUrl)}" target="_blank" rel="noreferrer">Open careers page <span aria-hidden="true">↗</span></a>
            </li>`,
          )
          .join("")}</ul>`
      : `<p class="empty">No companies in this group.</p>`;
  return `<header class="view-heading"><div><p class="eyebrow">Sources</p><h1>Companies</h1><p>Job boards Kestrel watches on your behalf.</p></div><button class="button button--primary" id="add-company">Add company</button></header>
    <section aria-labelledby="supported-heading"><div class="section-heading"><h2 id="supported-heading">Active boards</h2><span>${supported.length}</span></div>${cards(supported)}</section>
    <section aria-labelledby="unsupported-heading"><div class="section-heading"><h2 id="unsupported-heading">Unsupported watchlist</h2><span>${unsupported.length}</span></div>${cards(unsupported)}</section>
    <dialog id="company-dialog"><form method="dialog" id="company-form" class="dialog-form"><header><div><p class="eyebrow">New source</p><h2>Add company</h2></div><button class="icon-button" value="cancel" aria-label="Close dialog">×</button></header>
      <label for="company-name">Company name</label><input id="company-name" name="name" required>
      <label for="ats-platform">ATS platform</label><select id="ats-platform" name="atsType"><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="ashby">Ashby</option><option value="unsupported">Unsupported</option></select>
      <label for="board-token">Board token</label><input id="board-token" name="boardToken">
      <label for="careers-url">Careers URL</label><input id="careers-url" name="careersUrl" type="url" required>
      <label for="unsupported-platform">Unsupported platform (if applicable)</label><input id="unsupported-platform" name="unsupportedPlatform">
      <div class="dialog-actions"><button class="button" value="cancel">Cancel</button><button class="button button--primary" type="submit" value="default">Save company</button></div>
    </form></dialog>`;
}

function jobsView() {
  const visible = jobs.filter((job) => {
    if (jobStatus === "active" && job.removedAt) return false;
    if (jobStatus === "removed" && !job.removedAt) return false;
    if (appliedFilter === "true" && !job.appliedAt) return false;
    if (appliedFilter === "false" && job.appliedAt) return false;
    return true;
  });
  return `<header class="view-heading"><div><p class="eyebrow">Opportunity radar</p><h1>Jobs</h1><p>${visible.length} of ${jobs.length} roles in view.</p></div></header>
    <search class="filter-bar" aria-label="Filter jobs"><label for="status-filter">Status</label><select id="status-filter"><option value="all">All roles</option><option value="active">Active</option><option value="removed">Removed</option></select><label for="applied-filter">Applied</label><select id="applied-filter"><option value="all">All</option><option value="true">Applied</option><option value="false">Not applied</option></select></search>
    ${visible.length ? `<div class="job-list">${visible.map((job) => `<article class="job-card ${job.removedAt ? "job-card--removed" : ""}"><div class="job-card__signal" aria-hidden="true"></div><div class="job-card__body"><div class="job-card__meta"><span>${escapeHtml(companyName(job.companyId))}</span><span class="badge badge--${escapeHtml(job.remoteScope)}">${escapeHtml(job.remoteScope)}</span>${job.removedAt ? `<span class="badge badge--removed">removed</span>` : ""}</div><h2><a href="${escapeHtml(job.absoluteUrl)}" target="_blank" rel="noreferrer">${escapeHtml(job.title)}</a></h2><p class="job-facts">${escapeHtml(job.locationRaw)}${job.department ? ` · ${escapeHtml(job.department)}` : ""}${job.employmentType ? ` · ${escapeHtml(job.employmentType)}` : ""}</p>${job.descriptionSnippet ? `<p class="muted">${escapeHtml(job.descriptionSnippet)}</p>` : ""}<footer><time datetime="${escapeHtml(job.lastSeenAt)}">Seen ${new Date(job.lastSeenAt).toLocaleDateString()}</time><label class="check"><input type="checkbox" data-applied="${escapeHtml(job.stableKey)}" ${job.appliedAt ? "checked" : ""}> Applied</label></footer></div></article>`).join("")}</div>` : `<p class="empty">No roles match these filters.</p>`}`;
}

function criteriaView() {
  const item = criteria[0];
  if (!item)
    return `<header class="view-heading"><div><p class="eyebrow">Matching logic</p><h1>Criteria</h1></div></header><p class="empty">No criteria set exists yet.</p>`;
  const field = (id: string, label: string, values: string[], hint: string) =>
    `<div class="field"><label for="${id}">${label}</label><p id="${id}-hint">${hint}</p><textarea id="${id}" name="${id}" aria-describedby="${id}-hint">${escapeHtml(values.join(", "))}</textarea></div>`;
  return `<header class="view-heading"><div><p class="eyebrow">Matching logic</p><h1>Criteria</h1><p>Shape the signal. Separate terms with commas.</p></div></header><form id="criteria-form" class="criteria-form"><fieldset><legend>Rule set</legend><div class="field-row"><div class="field"><label for="criteria-name">Name</label><input id="criteria-name" name="name" value="${escapeHtml(item.name)}"></div><label class="check check--large"><input name="enabled" type="checkbox" ${item.enabled ? "checked" : ""}> Enabled</label></div>${field("titleIncludes", "Title includes", item.titleIncludes, "A role must contain at least one of these terms.")}${field("titleExcludes", "Title excludes", item.titleExcludes, "Reject titles containing any of these terms.")}${field("locationHardExcludes", "Location hard excludes", item.locationHardExcludes, "Locations Kestrel should never match.")}${field("regions", "Regions", item.regions, "Regions to highlight in the feed.")}<button class="button button--primary" type="submit">Save criteria</button></fieldset></form>`;
}

function notificationsView() {
  return `<header class="view-heading"><div><p class="eyebrow">Desktop signal</p><h1>Notifications</h1><p>Let Kestrel alert you when a strong new match lands.</p></div></header><section class="notification-card" aria-labelledby="push-title"><div class="radar" aria-hidden="true"><span></span></div><div><h2 id="push-title">Browser notifications</h2><p>Notifications are delivered to this browser using secure web push. Your browser will ask for permission.</p><button class="button button--primary" id="enable-notifications">Enable notifications</button></div></section>`;
}

function shell() {
  const content =
    view === "companies"
      ? companyView()
      : view === "jobs"
        ? jobsView()
        : view === "criteria"
          ? criteriaView()
          : notificationsView();
  app.innerHTML = `<a class="skip-link" href="#main-content">Skip to main content</a><div class="app-shell"><header class="sidebar"><a class="brand" href="#jobs"><span class="mark" aria-hidden="true">K</span><span>Kestrel<small>Field station</small></span></a><nav aria-label="Primary"><a href="#companies" ${view === "companies" ? 'aria-current="page"' : ""}>Companies</a><a href="#jobs" ${view === "jobs" ? 'aria-current="page"' : ""}>Jobs <span>${jobs.filter((job) => !job.removedAt).length}</span></a><a href="#criteria" ${view === "criteria" ? 'aria-current="page"' : ""}>Criteria</a><a href="#notifications" ${view === "notifications" ? 'aria-current="page"' : ""}>Notifications</a></nav><div class="sidebar-actions"><button class="button button--quiet" id="refresh-jobs">Refresh jobs</button><button class="button button--danger" id="purge-jobs">Purge removed jobs</button><button class="text-button" id="disconnect">Disconnect</button></div></header><main id="main-content" tabindex="-1">${notice ? `<p class="message ${notice.kind === "alert" ? "message--error" : ""}" role="${notice.kind}">${escapeHtml(notice.message)}</p>` : ""}${content}</main></div>`;
  bindShell();
}

function bindShell() {
  document.querySelector("#disconnect")?.addEventListener("click", () => {
    localStorage.removeItem(tokenKey);
    token = "";
    authScreen();
  });
  document
    .querySelector("#refresh-jobs")
    ?.addEventListener("click", () => maintenance("/api/poll", "Refresh complete."));
  document
    .querySelector("#purge-jobs")
    ?.addEventListener("click", () => maintenance("/api/purge", "Removed jobs purged."));
  const status = document.querySelector<HTMLSelectElement>("#status-filter");
  if (status) {
    status.value = jobStatus;
    status.addEventListener("change", () => {
      jobStatus = status.value;
      render();
    });
  }
  const applied = document.querySelector<HTMLSelectElement>("#applied-filter");
  if (applied) {
    applied.value = appliedFilter;
    applied.addEventListener("change", () => {
      appliedFilter = applied.value;
      render();
    });
  }
  document.querySelectorAll<HTMLInputElement>("[data-applied]").forEach((input) =>
    input.addEventListener("change", async () => {
      const key = input.dataset.applied!;
      try {
        const result = await api<{ appliedAt: string | null }>(
          `/api/jobs/${encodeURIComponent(key)}/applied`,
          { method: "PATCH", body: JSON.stringify({ applied: input.checked }) },
        );
        const job = jobs.find((item) => item.stableKey === key);
        if (job) job.appliedAt = result.appliedAt;
      } catch (cause) {
        input.checked = !input.checked;
        feedback("alert", cause instanceof Error ? cause.message : "Could not update role.");
      }
    }),
  );
  const dialog = document.querySelector<HTMLDialogElement>("#company-dialog");
  document.querySelector("#add-company")?.addEventListener("click", () => dialog?.showModal());
  document
    .querySelector<HTMLFormElement>("#company-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget as HTMLFormElement);
      const atsType = formValue(data.get("atsType"));
      try {
        const result = await api<{ company: Company }>("/api/companies", {
          method: "POST",
          body: JSON.stringify({
            name: formValue(data.get("name")),
            atsType,
            boardToken: formValue(data.get("boardToken")) || null,
            careersUrl: formValue(data.get("careersUrl")),
            status: atsType === "unsupported" ? "unsupported" : "active",
            unsupportedPlatform: formValue(data.get("unsupportedPlatform")) || null,
            notes: null,
          }),
        });
        companies.push(result.company);
        dialog?.close();
        feedback("status", "Company saved.");
      } catch (cause) {
        feedback("alert", cause instanceof Error ? cause.message : "Could not save company.");
      }
    });
  document
    .querySelector<HTMLFormElement>("#criteria-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget as HTMLFormElement);
      const current = criteria[0]!;
      const updated: Criteria = {
        ...current,
        name: formValue(data.get("name")),
        enabled: data.get("enabled") === "on",
        titleIncludes: splitList(data.get("titleIncludes")),
        titleExcludes: splitList(data.get("titleExcludes")),
        locationHardExcludes: splitList(data.get("locationHardExcludes")),
        regions: splitList(data.get("regions")),
      };
      try {
        const result = await api<{ criteria: Criteria }>(
          `/api/criteria/${encodeURIComponent(current.id)}`,
          { method: "PUT", body: JSON.stringify(updated) },
        );
        criteria[0] = result.criteria;
        feedback("status", "Criteria saved.");
      } catch (cause) {
        feedback("alert", cause instanceof Error ? cause.message : "Could not save criteria.");
      }
    });
  document.querySelector("#enable-notifications")?.addEventListener("click", enableNotifications);
}

async function maintenance(path: string, success: string) {
  try {
    await api(path, { method: "POST" });
    feedback("status", success);
  } catch (cause) {
    feedback("alert", cause instanceof Error ? cause.message : "Action failed.");
  }
}

function decodeKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function enableNotifications() {
  try {
    if (!("Notification" in window) || !("serviceWorker" in navigator))
      throw new Error("Notifications are not supported in this browser.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Notification permission was not granted.");
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
    feedback("status", "Notifications enabled.");
  } catch (cause) {
    feedback("alert", cause instanceof Error ? cause.message : "Could not enable notifications.");
  }
}

function render() {
  shell();
}

window.addEventListener("hashchange", () => {
  const next = location.hash.slice(1);
  if (["companies", "jobs", "criteria", "notifications"].includes(next)) view = next as View;
  notice = null;
  render();
});

if (!token) authScreen();
else
  loadData()
    .then(render)
    .catch(() => authScreen("Your saved token could not connect. Check it and try again."));
