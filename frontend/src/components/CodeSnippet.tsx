import { useState, useEffect, useMemo } from "react";
import { Check, Copy } from "lucide-react";
import * as Tabs from "@radix-ui/react-tabs";
import { createHighlighter, type Highlighter } from "shiki";
import { cn } from "../lib/utils";

let highlighterPromise: Promise<Highlighter> | null = null;
const THEME = "vitesse-dark";

export interface Snippet {
  name: string;
  language: string;
  code: string;
}

interface CodeSnippetProps {
  snippets: Snippet[];
  className?: string;
}

export function CodeSnippet({ snippets, className }: CodeSnippetProps) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState(snippets[0]?.name);
  const [htmlContent, setHtmlContent] = useState<Record<string, string>>({});

  useEffect(() => {
    async function highlightCode() {
      if (!highlighterPromise) {
        highlighterPromise = createHighlighter({
          themes: [THEME],
          langs: ["bash", "javascript", "python", "json", "typescript"],
        });
      }
      
      const highlighter = await highlighterPromise;
      const newHtml: Record<string, string> = {};
      
      snippets.forEach((snippet) => {
        newHtml[snippet.name] = highlighter.codeToHtml(snippet.code, {
          lang: snippet.language,
          theme: THEME,
        });
      });
      
      setHtmlContent(newHtml);
    }
    
    highlightCode();
  }, [snippets]);

  const activeCode = useMemo(() => {
    return snippets.find((s) => s.name === activeTab)?.code || "";
  }, [activeTab, snippets]);

  const handleCopy = () => {
    navigator.clipboard.writeText(activeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn("relative group rounded-xl overflow-hidden border border-white/10 bg-[#121212] shadow-2xl", className)}
      role="region"
      aria-label="Code example"
    >
      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between px-4 bg-[#09090b]/80 backdrop-blur-md border-b border-white/5">
          {/* Traffic Lights */}
          <div className="flex items-center gap-1.5 mr-4 opacity-50" aria-hidden="true">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          </div>

          <Tabs.List className="flex flex-1 overflow-x-auto scrollbar-hide" aria-label="Code language tabs">
            {snippets.map((snippet) => (
              <Tabs.Trigger
                key={snippet.name}
                value={snippet.name}
                className={cn(
                  "px-3 py-2.5 text-xs font-mono font-medium border-b-2 transition-all outline-none",
                  activeTab === snippet.name 
                    ? "border-primary-500 text-primary-400 bg-white/5" 
                    : "border-transparent text-slate-500 hover:text-slate-300 hover:bg-white/[0.02]"
                )}
              >
                {snippet.name}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <button
            onClick={handleCopy}
            className="text-slate-500 hover:text-white transition-colors ml-4 p-1 rounded-md hover:bg-white/10"
            aria-label={copied ? "Code copied to clipboard" : "Copy code to clipboard"}
          >
            {copied ? <Check className="w-4 h-4 text-primary-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        {snippets.map((snippet) => (
          <Tabs.Content key={snippet.name} value={snippet.name}>
            <div className="p-4 overflow-x-auto text-sm font-mono leading-relaxed bg-[#121212]">
              {htmlContent[snippet.name] ? (
                <div dangerouslySetInnerHTML={{ __html: htmlContent[snippet.name] }} />
              ) : (
                <pre className="text-slate-500"><code>{snippet.code}</code></pre>
              )}
            </div>
          </Tabs.Content>
        ))}
      </Tabs.Root>
      
      {/* CSS to override Shiki's default background so it blends natively */}
      <style>{`
        .shiki { background-color: transparent !important; padding: 0 !important; margin: 0 !important; }
        .shiki code { display: block; min-width: max-content; }
      `}</style>
    </div>
  );
}
