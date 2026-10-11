/**
 * Client-side helpers for the internal admin surface (PRE-129/130).
 *
 * The admin pages are plain Astro + a `<script>` island (matching
 * dashboard.astro) talking to the type-safe oRPC client. The real gate is
 * server-side (adminMiddleware / ADMIN_EMAILS); `ensureAdmin` is the UX layer:
 * it redirects anonymous users to /login and shows a "not authorized" panel
 * when `admin.me` throws FORBIDDEN, otherwise reveals the page content.
 *
 * Rendering is done with the `h()` hyperscript below (createElement + text
 * nodes) rather than innerHTML, so user-controlled strings (emails, names,
 * answer JSON) can never inject markup.
 */
import { authClient } from "./auth-client";
import { orpc } from "./orpc";

export interface AdminIdentity {
  userId: string;
  email: string;
  name: string;
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/**
 * Runs the gate against the standard AdminLayout DOM (#admin-loading /
 * #admin-denied / #admin-content). Resolves to the admin identity on success,
 * or null when the caller is not staff (content stays hidden). Page scripts
 * should only load data when this resolves non-null.
 */
export async function ensureAdmin(): Promise<AdminIdentity | null> {
  const loading = byId("admin-loading");
  const denied = byId("admin-denied");
  const content = byId("admin-content");

  try {
    const { data: session } = await authClient.getSession();
    if (!session?.user) {
      window.location.href = "/login";
      return null;
    }
    const me = await orpc.admin.me();
    loading?.classList.add("hidden");
    content?.classList.remove("hidden");
    const whoami = byId("admin-whoami");
    if (whoami) whoami.textContent = me.email;
    return me;
  } catch {
    loading?.classList.add("hidden");
    denied?.classList.remove("hidden");
    return null;
  }
}

// ── safe DOM construction ────────────────────────────────────────────────────

type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | number | null | undefined | false;

/** Hyperscript: createElement with attrs + children. Strings become text nodes
 * (auto-escaped), so no untrusted value can inject HTML. */
export function h(tag: string, attrs?: Attrs | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = String(v);
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Replace all children of `el` with `nodes`. */
export function mount(el: HTMLElement, ...nodes: Child[]): void {
  el.replaceChildren(
    ...(nodes.flat().filter((n): n is Node | string => n != null && n !== false) as (
      | Node
      | string
    )[]),
  );
}

export function link(href: string, text: string): HTMLElement {
  return h("a", { href, class: "text-sky-400 hover:underline" }, text);
}

export function badge(
  text: string,
  tone: "green" | "amber" | "red" | "sky" | "neutral",
): HTMLElement {
  const tones: Record<string, string> = {
    green: "bg-green-900/40 text-green-300",
    amber: "bg-amber-900/40 text-amber-300",
    red: "bg-red-900/40 text-red-300",
    sky: "bg-sky-900/40 text-sky-300",
    neutral: "bg-neutral-800 text-neutral-400",
  };
  return h("span", { class: `inline-block rounded px-1.5 py-0.5 text-xs ${tones[tone]}` }, text);
}

/** A bordered table from a header row + body rows (cells are text or nodes). */
export function table(headers: string[], rows: Child[][]): HTMLElement {
  const thead = h(
    "thead",
    { class: "bg-neutral-900/60 text-xs uppercase tracking-wide text-neutral-500" },
    h(
      "tr",
      null,
      ...headers.map((label) => h("th", { class: "px-3 py-2 text-left font-medium" }, label)),
    ),
  );
  const body =
    rows.length === 0
      ? h(
          "tbody",
          null,
          h(
            "tr",
            null,
            h(
              "td",
              { colspan: String(headers.length), class: "px-3 py-6 text-center text-neutral-500" },
              "Nothing here.",
            ),
          ),
        )
      : h(
          "tbody",
          { class: "divide-y divide-neutral-800/70" },
          ...rows.map((r) =>
            h(
              "tr",
              { class: "hover:bg-neutral-900/50 align-top" },
              ...r.map((cell) => h("td", { class: "px-3 py-2 text-neutral-300" }, cell)),
            ),
          ),
        );
  return h(
    "div",
    { class: "overflow-x-auto rounded-lg border border-neutral-800" },
    h("table", { class: "w-full text-left text-sm" }, thead, body),
  );
}

/** A titled card section wrapping arbitrary content. */
export function section(title: string, ...content: Child[]): HTMLElement {
  return h(
    "section",
    { class: "mb-6" },
    h(
      "h2",
      { class: "mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400" },
      title,
    ),
    h("div", { class: "rounded-lg border border-neutral-800 bg-neutral-900 p-4" }, ...content),
  );
}

/** A label/value pair for the inspection cards. */
export function kv(label: string, value: Child): HTMLElement {
  return h(
    "div",
    { class: "flex gap-2 py-0.5 text-sm" },
    h("span", { class: "w-44 shrink-0 text-neutral-500" }, label),
    h("span", { class: "text-neutral-200" }, value ?? "—"),
  );
}

/** Monospace preformatted block — for opaque JSON. textContent only. */
export function pre(text: string): HTMLElement {
  return h(
    "pre",
    {
      class:
        "max-h-80 overflow-auto rounded bg-neutral-950 p-3 font-mono text-xs text-neutral-300 whitespace-pre-wrap break-words",
    },
    text,
  );
}

// ── formatting ───────────────────────────────────────────────────────────────

/** ISO timestamp → "2026-05-29 14:03" (local), or "—" for null. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A dollar amount with enough precision for tiny per-call costs. */
export function fmtCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(2)}`;
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

/** Pretty-print opaque JSON (answer values, intake summaries, …). */
export function fmtJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
