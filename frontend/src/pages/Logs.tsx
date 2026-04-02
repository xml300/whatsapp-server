import { useState, useEffect, useCallback } from "react";
import { 
  Terminal, 
  RefreshCw, 
  Search, 
  Filter, 
  ChevronRight, 
  AlertCircle, 
  Info, 
  AlertTriangle, 
  Clock,
  Database
} from "lucide-react";
import { cn } from "../lib/utils";

interface LogEntry {
  id: string;
  source: string;
  message: string;
  level: string;
  timestamp: string;
}

export function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);

  const fetchLogs = useCallback(async (page: number = 1) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/logs?page=${page}&limit=20`);
      if (!response.ok) throw new Error("Failed to fetch logs");
      const data = await response.json();
      setLogs(data.logs || []);
      setTotalPages(data.totalPages || 1);
      setCurrentPage(data.currentPage || 1);
      setTotalLogs(data.totalLogs || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs(1);
  }, [fetchLogs]);

  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    fetchLogs(page);
  };

  const filteredLogs = logs.filter((log) => {
    const matchesSearch = log.message.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          log.source?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesLevel = levelFilter === "all" || log.level?.toLowerCase() === levelFilter.toLowerCase();
    return matchesSearch && matchesLevel;
  });

  const getLevelIcon = (level: string) => {
    switch (level?.toLowerCase()) {
      case "error": return <AlertCircle className="w-4 h-4 text-red-500" />;
      case "warn": return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case "info": return <Info className="w-4 h-4 text-blue-500" />;
      default: return <ChevronRight className="w-4 h-4 text-slate-500" />;
    }
  };

  const getLevelColor = (level: string) => {
    switch (level?.toLowerCase()) {
      case "error": return "text-red-400";
      case "warn": return "text-amber-400";
      case "info": return "text-blue-400";
      default: return "text-slate-400";
    }
  };

  return (
    <div className="flex-1 w-full bg-[#09090b] selection:bg-primary-500/30">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-8 lg:py-16">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-primary-500/10 border border-primary-500/20 text-primary-400">
                <Database className="w-5 h-5" />
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight">System Logs</h1>
            </div>
            <p className="text-base text-slate-400">
              Audit trails and historical execution logs from the backend database.
            </p>
          </div>

          <div className="flex items-center gap-3">
             <button
              onClick={() => fetchLogs(currentPage)}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-all font-medium disabled:opacity-50"
            >
              <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>

        {/* Filters & Search */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-6">
          <div className="md:col-span-8 relative">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              placeholder="Search logs by message or source..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/[0.02] border border-white/10 rounded-xl pl-10 pr-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/50 transition-all text-sm"
            />
          </div>
          <div className="md:col-span-4 relative">
             <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500">
              <Filter className="w-4 h-4" />
            </div>
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="w-full bg-white/[0.02] border border-white/10 rounded-xl pl-10 pr-4 py-3 text-slate-200 focus:outline-none focus:border-primary-500/50 transition-all text-sm appearance-none cursor-pointer"
            >
              <option value="all">All Levels</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
            </select>
          </div>
        </div>

        {/* Logs Terminal */}
        <div className="rounded-2xl border border-white/10 bg-[#0c0c0e] overflow-hidden shadow-2xl flex flex-col min-h-[600px]">
          
          {/* Terminal Header */}
          <div className="h-12 bg-white/[0.03] border-b border-white/10 flex items-center justify-between px-6 shrink-0">
             <div className="flex items-center gap-1.5">
               <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
               <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
               <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
             </div>
             
             <div className="flex items-center gap-3">
               <Terminal className="w-4 h-4 text-slate-500" />
               <span className="text-xs font-mono text-slate-400 uppercase tracking-widest font-bold">mongodb_logs_v1</span>
             </div>

             <div className="text-[10px] font-mono text-slate-500">
               {filteredLogs.length} results
             </div>
          </div>

          <div className="flex-1 overflow-auto p-0 scrollbar-hide">
            {isLoading ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-500 py-20">
                <RefreshCw className="w-8 h-8 animate-spin opacity-20" />
                <p className="text-sm animate-pulse">Fetching records from database...</p>
              </div>
            ) : error ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-red-400 py-20">
                <AlertCircle className="w-10 h-10 opacity-50" />
                <div className="text-center">
                  <p className="font-bold">Failed to load logs</p>
                  <p className="text-xs opacity-70 mt-1">{error}</p>
                </div>
                <button 
                   onClick={() => fetchLogs(currentPage)}
                  className="mt-4 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors text-xs font-bold uppercase tracking-wider"
                >
                  Try Again
                </button>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-600 py-20">
                <Search className="w-10 h-10 opacity-30" />
                <p className="text-sm">No matching log entries found.</p>
              </div>
            ) : (
              <table className="w-full border-collapse font-mono text-[12px] leading-tight">
                <thead className="sticky top-0 bg-white/[0.03] backdrop-blur-md border-b border-white/5 z-10">
                  <tr>
                    <th className="text-left py-3 px-4 text-slate-500 font-bold uppercase tracking-wider w-40">Timestamp</th>
                    <th className="text-left py-3 px-4 text-slate-500 font-bold uppercase tracking-wider w-24">Level</th>
                    <th className="text-left py-3 px-4 text-slate-500 font-bold uppercase tracking-wider">Message</th>
                    <th className="text-left py-3 px-4 text-slate-500 font-bold uppercase tracking-wider w-32">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-white/[0.02] group transition-colors">
                      <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3 h-3 opacity-30" />
                          {new Date(log.timestamp).toLocaleString('en-US', { 
                            month: 'short', 
                            day: '2-digit', 
                            hour: '2-digit', 
                            minute: '2-digit', 
                            second: '2-digit',
                            hour12: false 
                          })}
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          {getLevelIcon(log.level)}
                          <span className={cn("font-bold uppercase tracking-widest text-[10px]", getLevelColor(log.level))}>
                            {log.level}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-slate-200 transition-colors group-hover:text-white">
                        {log.message}
                      </td>
                      <td className="py-2.5 px-4">
                         <span className="px-2 py-0.5 rounded bg-white/5 border border-white/5 text-slate-500 text-[10px]">
                            {log.source || 'system'}
                         </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer Info & Pagination */}
          <div className="h-12 bg-white/[0.01] border-t border-white/5 flex items-center px-4 shrink-0 justify-between">
             <div className="hidden sm:flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/50" />
                  DATABASE CONNECTED
                </div>
                <div className="text-[10px] text-slate-600">
                  {totalLogs.toLocaleString()} TOTAL LOGS
                </div>
             </div>

             <div className="flex items-center gap-4 mx-auto sm:mx-0">
                <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest font-bold">
                  Page {currentPage} of {totalPages}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={isLoading || currentPage === 1}
                    className="px-3 py-1 rounded bg-white/5 border border-white/10 text-[10px] font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed uppercase tracking-wider"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={isLoading || currentPage === totalPages}
                    className="px-3 py-1 rounded bg-white/5 border border-white/10 text-[10px] font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed uppercase tracking-wider"
                  >
                    Next
                  </button>
                </div>
             </div>
          </div>

        </div>

      </div>
      
      <style>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
