/**
 * The script editor: a plain textarea with a line-number gutter that marks
 * diagnostics and the line being played, plus jump-to-line for the
 * timeline, inspector and diagnostics list.
 */
export class Editor {
  private marks = new Map<number, "error" | "warning" | "fixed">();
  private nowLine = 0;
  private lineCount = 0;

  constructor(
    readonly source: HTMLTextAreaElement,
    private readonly gutter: HTMLPreElement,
  ) {
    source.addEventListener("input", () => this.paint());
    source.addEventListener("scroll", () => (gutter.scrollTop = source.scrollTop));
    this.paint();
  }

  get value(): string {
    return this.source.value;
  }

  set value(text: string) {
    this.source.value = text;
    this.paint();
  }

  /** Marks lines from formatted diagnostics (`L12:3 NAR301 error: …`). */
  setDiagnostics(lines: string[]): void {
    this.marks.clear();
    for (const d of lines) {
      const m = /^L(\d+):\d+ \S+ (error|warning)/.exec(d);
      if (!m) continue;
      const kind = /\[fixed:/.test(d) ? "fixed" : (m[2] as "error" | "warning");
      const line = Number(m[1]);
      if (this.marks.get(line) !== "error") this.marks.set(line, kind);
    }
    this.paint();
  }

  /** Highlights the source line of what is playing now (0 = none). */
  setNow(line: number): void {
    if (line === this.nowLine) return;
    this.nowLine = line;
    this.paint();
  }

  /** Selects a line and scrolls it into the middle of the view. */
  select(line: number): void {
    const lines = this.source.value.split("\n");
    if (line < 1 || line > lines.length) return;
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    this.source.focus({ preventScroll: true });
    this.source.setSelectionRange(start, start + lines[line - 1]!.length);
    const lh = parseFloat(getComputedStyle(this.source).lineHeight) || 20;
    this.source.scrollTop = Math.max(0, (line - 1) * lh - this.source.clientHeight / 2);
    this.gutter.scrollTop = this.source.scrollTop;
  }

  private paint(): void {
    const n = this.source.value.split("\n").length;
    this.lineCount = n;
    let html = "";
    for (let i = 1; i <= n; i++) {
      const cls = [this.marks.get(i), i === this.nowLine ? "now" : ""].filter(Boolean).join(" ");
      html += cls ? `<span class="${cls}">${i}</span>\n` : `${i}\n`;
    }
    this.gutter.innerHTML = html;
    this.gutter.scrollTop = this.source.scrollTop;
  }

  get lines(): number {
    return this.lineCount;
  }
}
