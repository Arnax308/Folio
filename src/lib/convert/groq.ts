/** Groq's OpenAI-compatible chat API, used to read scanned pages. The key stays on this device. */

export const GROQ_DEFAULT_MODEL = 'qwen/qwen3.8-27b';
const URL = 'https://api.groq.com/openai/v1/chat/completions';
const KEY = 'folio.groq';

export interface GroqConfig {
  key: string;
  model: string;
}

export function getGroqConfig(): GroqConfig {
  let saved: Partial<GroqConfig> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    /* ignore */
  }
  // development only: lets the key come from a git-ignored .env.local instead of the settings field
  const devKey = import.meta.env.DEV ? (import.meta.env.VITE_GROQ_KEY as string | undefined) : undefined;
  return { key: saved.key || devKey || '', model: saved.model || GROQ_DEFAULT_MODEL };
}

export function setGroqConfig(c: Partial<GroqConfig>) {
  const next = { ...getGroqConfig(), ...c };
  try {
    localStorage.setItem(KEY, JSON.stringify({ key: next.key, model: next.model === GROQ_DEFAULT_MODEL ? undefined : next.model }));
  } catch {
    /* ignore */
  }
}

const COMMON = `Rules:
- Copy the text exactly as printed. Do not summarise, correct, translate or add anything.
- Join the lines of each paragraph into one line and separate paragraphs with a blank line. Undo hyphenation at line ends. If the very last word of the page is split by a hyphen, keep the hyphen.
- Leave out the running header at the top of the page and the page number.
- Write a superscript note number as [^N] exactly where it appears, e.g. "the individual.[^26]". Only printed superscript numbers count: ignore handwriting, pen marks and underlining.
- Use *italics* and **bold** where the page does.
- Part titles: "# Title". Chapter titles: "## Title" (put a chapter number like "ONE" or "Chapter 3" in the same heading: "## 1. Title"). Headings inside a chapter: "### Title".
- Block quotations as "> ". Lists and tables as Markdown.
- Text inside a figure, chart or box: transcribe it as a blockquote. A figure caption: its own paragraph in *italics*. Ignore pictures that have no text.
- If the page is blank or has no text, output nothing.
Output only the Markdown, with no comments.`;

const BODY_PROMPT = `Transcribe this scanned book page into Markdown.\n${COMMON}`;
const NOTES_PROMPT = `Transcribe this scanned page of a book's endnotes into Markdown.\n${COMMON}
- Each note is its own paragraph that starts with its number and a full stop: "12. Text of the note."
- Section titles in the notes (one per chapter) as "## Title".
- If the page begins in the middle of a note, start with that text as a paragraph without a number.`;

export class RateLimited extends Error {
  constructor(
    public waitMs: number,
    public daily: boolean,
    message: string,
  ) {
    super(message);
  }
}
export class GroqError extends Error {
  constructor(
    message: string,
    public fatal: boolean,
  ) {
    super(message);
  }
}

/** "Please try again in 1m3.5s" → ms */
function parseWait(msg: string): number | null {
  const m = /try again in\s+(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:([\d.]+)ms)?/i.exec(msg);
  if (!m || !m[0].match(/\d/)) return null;
  return ((Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 60 + Number(m[3] || 0)) * 1000 + Number(m[4] || 0);
}

/**
 * Keeps requests under Groq's per-minute limits, so we wait politely instead of being turned away.
 * There are separate budgets for all tokens (TPM) and for input tokens (ITPM); each is learned from
 * Groq's own "Limit N" messages and remembered for next time.
 */
const LIMITS_KEY = 'folio.groq.limits';
type Use = { t: number; total: number; input: number };
export class Pacer {
  private log: Use[] = [];
  private limits: { tpm: number; itpm: number } = { tpm: 8000, itpm: Infinity };
  /**
   * What the next request will be charged up front. Groq checks "used in the last minute + its own
   * estimate for this request" against the limit, and the estimate runs above what a page really uses.
   */
  private per = { total: 2800, input: 2400 };
  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(LIMITS_KEY) || '{}');
      if (saved.tpm > 0) this.limits.tpm = saved.tpm;
      if (saved.itpm > 0) this.limits.itpm = saved.itpm;
      if (saved.perTotal > 0) this.per.total = saved.perTotal;
      if (saved.perInput > 0) this.per.input = saved.perInput;
    } catch {
      /* ignore */
    }
  }
  /** what a request actually used */
  note(total: number, input: number) {
    this.log.push({ t: Date.now(), total, input });
  }
  learn(msg: string) {
    const day = /\(TPD\): Limit (\d+)/i.exec(msg);
    if (day) {
      try {
        const saved = JSON.parse(localStorage.getItem(LIMITS_KEY) || '{}');
        localStorage.setItem(LIMITS_KEY, JSON.stringify({ ...saved, tpd: Number(day[1]) }));
      } catch {
        /* ignore */
      }
      return;
    }
    const m = /\((I?TPM)\): Limit (\d+)/i.exec(msg);
    if (!m) return;
    const input = m[1].toUpperCase() === 'ITPM';
    if (input) this.limits.itpm = Number(m[2]);
    else this.limits.tpm = Number(m[2]);
    const req = /Requested (\d+)/i.exec(msg);
    if (req) this.per[input ? 'input' : 'total'] = Math.max(this.per[input ? 'input' : 'total'], Number(req[1]));
    try {
      localStorage.setItem(
        LIMITS_KEY,
        JSON.stringify({
          ...JSON.parse(localStorage.getItem(LIMITS_KEY) || '{}'),
          tpm: this.limits.tpm,
          itpm: Number.isFinite(this.limits.itpm) ? this.limits.itpm : undefined,
          perTotal: this.per.total,
          perInput: this.per.input,
        }),
      );
    } catch {
      /* ignore */
    }
  }
  /** ms to wait before the next request fits in every per-minute budget */
  delay() {
    const now = Date.now();
    this.log = this.log.filter((e) => now - e.t < 60_000);
    const waitFor = (key: 'total' | 'input', limit: number) => {
      let used = this.log.reduce((s, e) => s + e[key], 0);
      if (used + this.per[key] <= limit) return 0;
      for (const e of this.log) {
        used -= e[key];
        if (used + this.per[key] <= limit) return e.t + 60_000 - now + 300;
      }
      return 60_000;
    };
    return Math.max(waitFor('total', this.limits.tpm), waitFor('input', this.limits.itpm));
  }
}

/** Roughly how many pages Groq's free plan reads a day (its daily token budget, about 2,500 a page). */
export function groqPagesPerDay() {
  let tpd = 200_000;
  try {
    tpd = JSON.parse(localStorage.getItem(LIMITS_KEY) || '{}').tpd || tpd;
  } catch {
    /* ignore */
  }
  return Math.max(1, Math.round(tpd / 2500));
}

export async function transcribePage(cfg: GroqConfig, jpegDataUrl: string, kind: 'body' | 'notes', signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(URL, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        max_completion_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: kind === 'notes' ? NOTES_PROMPT : BODY_PROMPT },
              { type: 'image_url', image_url: { url: jpegDataUrl } },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new RateLimited(15_000, false, 'No connection to Groq — retrying');
  }
  const text = await res.text();
  let body: { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number; prompt_tokens?: number }; error?: { message?: string } } = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  const msg = body.error?.message ?? text.slice(0, 300);
  if (res.status === 429) {
    const daily = /per day/i.test(msg);
    throw new RateLimited(parseWait(msg) ?? (daily ? 30 * 60_000 : 20_000), daily, msg);
  }
  if (res.status === 401) throw new GroqError('Groq didn’t accept the API key.', true);
  if (res.status === 404 || /model.*(not found|does not exist|decommissioned)/i.test(msg)) throw new GroqError(`Groq doesn’t have the model “${cfg.model}”.`, true);
  if (res.status >= 500) throw new RateLimited(20_000, false, 'Groq is busy — retrying');
  if (!res.ok) throw new GroqError(msg || `Groq answered ${res.status}`, res.status === 400 || res.status === 403);
  return { md: body.choices?.[0]?.message?.content ?? '', tokens: body.usage?.total_tokens ?? 2400, input: body.usage?.prompt_tokens ?? 1900 };
}

/** Checks the key without spending much: lists the models. */
export async function checkGroqKey(key: string): Promise<string[]> {
  const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) throw new GroqError('Groq didn’t accept this key.', true);
  if (!res.ok) throw new GroqError(`Groq answered ${res.status}`, false);
  const d = (await res.json()) as { data?: { id: string }[] };
  return (d.data ?? []).map((m) => m.id);
}
