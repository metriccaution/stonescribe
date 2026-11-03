/**
 * Removes fenced code blocks of the given languages (e.g. Obsidian ```base blocks), which are
 * vault machinery rather than prose and render as noise in summaries. Handles ``` and ~~~ fences
 * of any length; an unclosed fence runs to the end of the note, as in CommonMark.
 */
export function stripFencedBlocks(source: string, languages: string[]): string {
  const langs = new Set(languages.map((l) => l.toLowerCase()));
  const out: string[] = [];
  let fence: { marker: string; skip: boolean } | null = null;

  for (const line of source.split("\n")) {
    if (!fence) {
      const open = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
      if (open) {
        fence = { marker: open[1]!, skip: langs.has(open[2]!.toLowerCase()) };
        if (fence.skip) continue;
      }
      out.push(line);
      continue;
    }
    const close = new RegExp(`^ {0,3}${fence.marker[0]}{${fence.marker.length},}\\s*$`).test(line);
    if (!fence.skip) out.push(line);
    if (close) fence = null;
  }
  return out.join("\n");
}

/** A folder note's body as shown in a board or column summary. */
export const summaryText = (body: string) => stripFencedBlocks(body, ["base"]).trim();
