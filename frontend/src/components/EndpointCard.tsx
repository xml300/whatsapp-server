import { cn } from "../lib/utils";
import { CodeSnippet, type Snippet } from "./CodeSnippet";
import { Link2 } from "lucide-react";
import { useState } from "react";

interface EndpointCardProps {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  title: string;
  description: string;
  parameters?: Array<{ name: string; type: string; required: boolean; description: string }>;
  snippets: Snippet[];
  responses?: Snippet[];
}

const methodColors = {
  GET: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  POST: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  PUT: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  DELETE: "bg-red-500/10 text-red-400 border-red-500/20",
};

export function EndpointCard({ method, path, title, description, parameters, snippets, responses }: EndpointCardProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const anchorId = path.replace(/[/:]/g, '-').replace(/^-+/, '');

  const handleCopyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}#${anchorId}`;
    navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  return (
    <div id={anchorId} className="scroll-mt-24 pt-12 pb-16 border-t border-white/5 first:border-t-0 flex flex-col xl:flex-row gap-10 group">
      
      {/* Center Column (Explanations & Params) */}
      <div className="flex-1 xl:max-w-[50%]">
        {/* Method + Path — TOP of card (Stripe convention) */}
        <div className="flex items-center gap-3 mb-5">
          <span className={cn("px-3 py-1 rounded-md text-xs font-bold border tracking-wider font-mono", methodColors[method])}>
            {method}
          </span>
          <code className="text-slate-300 font-mono text-sm bg-white/5 border border-white/10 px-3 py-1 rounded-md">
            {path}
          </code>
          <button
            onClick={handleCopyLink}
            className="ml-auto text-slate-600 hover:text-primary-400 transition-colors p-1 rounded-md hover:bg-white/5 opacity-0 group-hover:opacity-100"
            aria-label="Copy link to this endpoint"
            title="Copy link"
          >
            {linkCopied ? (
              <span className="text-xs text-primary-400 font-medium">Copied!</span>
            ) : (
              <Link2 className="w-4 h-4" />
            )}
          </button>
        </div>

        <h3 className="text-2xl font-bold text-white mb-3 tracking-tight">{title}</h3>
        <p className="text-slate-300 text-base mb-8 leading-relaxed max-w-prose">{description}</p>

        <div className="mt-6">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-5 pb-2 border-b border-white/10">Parameters</h4>
          {parameters && parameters.length > 0 ? (
            <ul className="space-y-5">
              {parameters.map((p) => (
                <li key={p.name} className="flex flex-col gap-1.5">
                  <div className="flex justify-between items-baseline border-b border-white/5 pb-2 border-dashed">
                    <div className="flex items-center gap-3">
                      <code className="font-mono text-primary-400 text-sm bg-primary-500/10 px-1.5 py-0.5 rounded">{p.name}</code>
                      <span className="text-xs font-medium text-slate-400 uppercase tracking-widest">{p.type}</span>
                    </div>
                    {p.required ? (
                      <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider border border-red-400/20 bg-red-400/10 px-2 py-0.5 rounded-full">Required</span>
                    ) : (
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider">Optional</span>
                    )}
                  </div>
                  <span className="text-sm text-slate-400 leading-relaxed pl-1 max-w-prose">{p.description}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500 italic">No body parameters required. Authentication via header only.</p>
          )}
        </div>
      </div>

      {/* Right Column (Code Snippets via shiki) */}
      <div className="flex-1 xl:max-w-[45%] xl:sticky xl:top-24 h-fit flex flex-col gap-5">
        <div>
           <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 pl-1">Example Request</h4>
           <CodeSnippet snippets={snippets} />
        </div>
        
        {responses && responses.length > 0 && (
           <div>
             <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 pl-1">Example Response</h4>
             <CodeSnippet snippets={responses} />
           </div>
        )}
      </div>

    </div>
  );
}
