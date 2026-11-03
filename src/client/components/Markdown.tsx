import { createContext, useContext } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { NoteRef } from "../../shared/types";

interface WikiLinks {
  /** Resolves a link target by note name, case-insensitively. */
  resolve: (name: string) => NoteRef | undefined;
  openCard: (ref: NoteRef) => void;
}

export const WikiLinkContext = createContext<WikiLinks>({ resolve: () => undefined, openCard: () => {} });

const SCHEME = "wikilink:";

/**
 * Renders note bodies. [[Wikilinks]] (and ![[embeds]]) are resolved against the vault: links to
 * cards open them in the app; links to other notes show where the note lives; anything else is
 * marked as unresolved.
 */
export function Markdown({ source }: { source: string }) {
  const links = useContext(WikiLinkContext);
  const withLinks = source.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
    const label = (alias ?? target).replace(/[[\]]/g, "");
    return `[${label}](<${SCHEME}${encodeURIComponent(target)}>)`;
  });

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith(SCHEME) ? url : defaultUrlTransform(url))}
        components={{
          a({ href, children }) {
            if (!href?.startsWith(SCHEME)) {
              return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
            }
            // "Folder/Note#Heading" → "Note"
            const target = decodeURIComponent(href.slice(SCHEME.length)).split(/[#^]/)[0]!;
            const ref = links.resolve(target.split("/").pop()!);
            if (ref?.card) {
              return (
                <button className="wikilink" onClick={() => links.openCard(ref)} title={ref.path}>
                  {children}
                </button>
              );
            }
            return (
              <span className={`wikilink ${ref ? "note" : "missing"}`} title={ref ? ref.path : `No note named "${target}"`}>
                {children}
              </span>
            );
          },
        }}
      >
        {withLinks}
      </ReactMarkdown>
    </div>
  );
}
