import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe Markdown renderer for CMS content: headings, paragraphs, bullet and numbered lists, tables,
 * **bold**, *italic*, `code` and [links](/path). Output is React elements — no raw HTML is injected.
 */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("`")) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("**")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("*")) out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    else {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      const safe = /^(\/|https:\/\/|mailto:)/.test(href) ? href : "#";
      out.push(<a key={k++} href={safe} rel={safe.startsWith("http") ? "noopener noreferrer" : undefined}>{label}</a>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="prose-xc">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (b.startsWith("### ")) return <h3 key={i}>{inline(b.slice(4))}</h3>;
        if (b.startsWith("## ")) return <h2 key={i}>{inline(b.slice(3))}</h2>;
        const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (lines.length >= 2 && lines.every((l) => l.trim().startsWith("|")) && /^\|?\s*:?-{3,}/.test(lines[1].trim())) {
          return (
            <div key={i} className="overflow-x-auto">
              <table><thead><tr>{cells(lines[0]).map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
                <tbody>{lines.slice(2).map((l, r) => <tr key={r}>{cells(l).map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table>
            </div>
          );
        }
        if (lines.every((l) => /^\d+\. /.test(l))) return <ol key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\d+\. /, ""))}</li>)}</ol>;
        if (lines.every((l) => /^[-*] /.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}</ul>;
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>;
      })}
    </div>
  );
}
