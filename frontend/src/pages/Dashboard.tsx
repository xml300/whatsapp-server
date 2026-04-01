import { useState, useEffect, useRef } from "react";
import { Copy, Check, QrCode, Smartphone, RefreshCw, AlertCircle, Activity, Globe, TerminalSquare, Loader2, ArrowRight, BookOpen } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Link } from "react-router-dom";
import { cn } from "../lib/utils";

interface LogMessage {
  id: string;
  time: string;
  type: "info" | "event" | "error";
  message: string;
  data?: unknown;
}

export function Dashboard() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState("");
  
  const [qrCode, setQrCode] = useState("");
  const [status, setStatus] = useState("disconnected");
  const [connectionReady, setConnectionReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  const pollIntervalRef = useRef<number | null>(null);
  const streamReaderRef = useRef<ReadableStreamDefaultReader | null>(null);

  const addLog = (type: "info" | "event" | "error", message: string, data?: unknown) => {
    setLogs(prev => [...prev.slice(-99), {
      id: Math.random().toString(36).substring(7),
      time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' }),
      type,
      message,
      data
    }]);
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber) {
      setError("Please enter a phone number.");
      return;
    }
    setError("");
    setIsRegistering(true);
    addLog("info", `POST /api/auth/register — registering phone number...`);
    
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      });
      const data = await res.json();
      if (data.status === "success" && data.apiKey) {
        setApiKey(data.apiKey);
        addLog("info", "✓ Registration successful. API key generated.");
      } else {
        setError(data.message || "Registration failed.");
        addLog("error", "Registration failed", data);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to contact backend.";
      setError(message);
      addLog("error", "Network error during registration", message);
    } finally {
      setIsRegistering(false);
    }
  };

  const initConnection = async () => {
    if (!apiKey) return;
    setIsInitializing(true);
    addLog("info", "POST /api/auth/connect — connecting to WhatsApp...");
    try {
      await fetch("/api/auth/connect", {
        method: "POST",
        headers: { "x-api-key": apiKey },
      });
      pollStatus();
      startStream();
    } catch (err) {
      addLog("error", "Failed to initialize connection", err);
    } finally {
      setTimeout(() => setIsInitializing(false), 800);
    }
  };

  const startStream = async () => {
    if (!apiKey || streamReaderRef.current) return;
    addLog("info", "GET /api/stream — opening SSE connection...");
    
    try {
      const response = await fetch("/api/stream", { headers: { "x-api-key": apiKey }});
      if (!response.body) return;
      
      const reader = response.body.getReader();
      streamReaderRef.current = reader;
      const decoder = new TextDecoder();
      
      addLog("info", "✓ SSE stream connected. Listening for messages...");
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\\n');
        
        let currentEvent = "";
        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.replace('event:', '').trim();
          } else if (line.startsWith('data:')) {
            try {
              const parsed = JSON.parse(line.replace('data:', '').trim());
              addLog("event", currentEvent || "message", parsed);
            } catch {
              addLog("event", currentEvent || "data", line.replace('data:', '').trim());
            }
          }
        }
      }
    } catch (err) {
      addLog("error", "SSE stream disconnected", err);
      streamReaderRef.current = null;
    }
  };
  
  const pollStatus = async () => {
    if (!apiKey) return;
    try {
      const statusRes = await fetch("/api/status", { headers: { "x-api-key": apiKey } });
      const statusData = await statusRes.json();
      
      if (status !== statusData.status) {
         setStatus(statusData.status);
         addLog("info", `Status: ${statusData.status.toUpperCase()}`);
      }
      
      setConnectionReady(statusData.connectionReady);
      
      if (!statusData.connectionReady) {
        const qrRes = await fetch("/api/auth/connect/qr", { headers: { "x-api-key": apiKey } });
        const qrData = await qrRes.json();
        if (qrData.qr && qrData.qr !== qrCode) {
          setQrCode(qrData.qr);
          addLog("info", "New QR code available — scan with WhatsApp.");
        } else if (!qrData.qr) {
          setQrCode("");
        }
      } else {
        setQrCode(""); 
      }
    } catch { /* polling — silent retry */ }
  };

  useEffect(() => {
    if (apiKey) pollIntervalRef.current = window.setInterval(pollStatus, 3000) as unknown as number;
    return () => {
      if (pollIntervalRef.current) window.clearInterval(pollIntervalRef.current);
      if (streamReaderRef.current) streamReaderRef.current.cancel();
    };
  }, [apiKey, status, qrCode]);
  
  const handleCopy = () => {
    navigator.clipboard.writeText(apiKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  // Derive real metrics from actual session data
  const logCount = logs.length;
  const eventCount = logs.filter(l => l.type === "event").length;
  const errorCount = logs.filter(l => l.type === "error").length;

  return (
    <div className="flex-1 w-full relative bg-[#09090b]">
      <div className="max-w-[1400px] w-full mx-auto px-4 md:px-8 py-8 lg:py-16">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-10">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 tracking-tight">Dashboard</h1>
            <p className="text-base text-slate-400">
              Register your device, connect via QR, and monitor incoming events in real time.
            </p>
          </div>
          
          {/* Connection Status Pill */}
          <div className="flex items-center gap-3">
            <div className={cn(
               "flex items-center gap-2.5 px-4 py-2 rounded-xl border transition-colors duration-500",
               connectionReady ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
               : status === 'connecting' ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
               : "bg-white/5 border-white/10 text-slate-400"
            )}>
               <div className="relative flex h-2 w-2">
                 {(connectionReady || status === 'connecting') && (
                   <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", connectionReady ? "bg-emerald-400" : "bg-amber-400")}></span>
                 )}
                 <span className={cn("relative inline-flex rounded-full h-2 w-2", connectionReady ? "bg-emerald-500" : status === 'connecting' ? "bg-amber-500" : "bg-slate-500")}></span>
               </div>
               <span className="text-sm font-semibold tracking-wide">
                 {connectionReady ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Disconnected'}
               </span>
            </div>
            <Link 
              to="/docs" 
              className="p-2 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:border-white/20 transition-colors"
              title="View API Documentation"
            >
              <BookOpen className="w-4 h-4" />
            </Link>
          </div>
        </div>

        {/* Real Session Metrics */}
        <div className="grid grid-cols-3 gap-3 md:gap-5 mb-10">
           {[
             { label: "Log Entries", value: logCount.toLocaleString(), color: "text-primary-400" },
             { label: "Events Received", value: eventCount.toLocaleString(), color: "text-blue-400" },
             { label: "Errors", value: errorCount.toLocaleString(), color: errorCount > 0 ? "text-red-400" : "text-slate-500" },
           ].map((metric, i) => (
             <div key={i} className="px-4 py-4 md:px-6 md:py-5 rounded-xl bg-white/[0.02] border border-white/[0.06] flex flex-col gap-1">
               <span className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">{metric.label}</span>
               <span className={cn("text-2xl md:text-3xl font-bold tracking-tight", metric.color)}>{metric.value}</span>
             </div>
           ))}
        </div>

        <div className="grid lg:grid-cols-12 gap-6 lg:gap-8 min-h-[600px]">
          
          {/* Left Column (Setup Pipeline) */}
          <div className="lg:col-span-5 flex flex-col gap-6">
             
            {/* Step 1: Registration */}
            <div className="p-6 md:p-8 rounded-2xl bg-white/[0.02] border border-white/[0.06] relative overflow-hidden">
              {/* Progress indicator */}
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-primary-500/30 to-transparent" />
              
              <div className="flex items-center gap-3 mb-6">
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold border shrink-0",
                  apiKey
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    : "bg-primary-500/10 border-primary-500/20 text-primary-400"
                )}>
                  {apiKey ? <Check className="w-4 h-4" /> : "1"}
                </div>
                <div>
                  <h2 className="text-base font-bold text-white tracking-tight">Register Phone Number</h2>
                  <p className="text-xs text-slate-500">Get your API key to authenticate requests</p>
                </div>
              </div>
              
              <form onSubmit={handleRegister} className="flex flex-col gap-4">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-500">
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    placeholder="15551234567"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                    disabled={apiKey.length > 0}
                    className="w-full bg-[#09090b] border border-white/10 rounded-xl pl-10 pr-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/50 transition-all font-mono text-sm disabled:opacity-50"
                    aria-label="Phone number"
                  />
                </div>
                
                {error && (
                  <div className="flex items-center gap-2 text-red-400 bg-red-400/10 border border-red-400/20 px-3 py-2.5 rounded-lg text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                
                <button
                  type="submit"
                  disabled={isRegistering || apiKey.length > 0 || phoneNumber.length < 5}
                  className={cn(
                     "w-full flex items-center justify-center gap-2 font-medium rounded-xl px-4 py-3 transition-all text-sm",
                     apiKey 
                       ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 cursor-default" 
                       : "bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-40 disabled:bg-white/5 disabled:text-slate-500"
                  )}
                >
                  {isRegistering ? <><Loader2 className="w-4 h-4 animate-spin" /> Registering...</> 
                   : apiKey ? <><Check className="w-4 h-4" /> Registered</> 
                   : "Register & Get API Key"}
                </button>
              </form>

              {/* API Key Display */}
              <div className={cn("overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]", apiKey ? "max-h-40 opacity-100 mt-5 pt-5 border-t border-white/5" : "max-h-0 opacity-0")}>
                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Your API Key</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-black/50 px-3 py-2.5 rounded-lg text-primary-400 font-mono text-xs border border-primary-500/20 truncate">
                    {apiKey || "•".repeat(30)}
                  </code>
                  <button
                    onClick={handleCopy}
                    className="p-2.5 bg-[#09090b] border border-white/10 rounded-lg text-slate-400 hover:text-white hover:border-primary-500/30 transition-colors shrink-0"
                    aria-label={copiedKey ? "API key copied" : "Copy API key"}
                  >
                    {copiedKey ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Step 2: Connect Device */}
            <div className={cn("p-6 md:p-8 rounded-2xl bg-white/[0.02] border border-white/[0.06] relative overflow-hidden transition-all duration-500", !apiKey ? "opacity-40 pointer-events-none" : "opacity-100")}>
              {/* Progress indicator */}
              <div className={cn("absolute top-0 left-0 w-full h-0.5 transition-opacity duration-700", 
                connectionReady ? "bg-emerald-500/50 opacity-100" : "bg-gradient-to-r from-transparent via-primary-500/30 to-transparent opacity-0")} />
              
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold border shrink-0",
                    connectionReady 
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      : "bg-primary-500/10 border-primary-500/20 text-primary-400"
                  )}>
                    {connectionReady ? <Check className="w-4 h-4" /> : "2"}
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white tracking-tight">Connect Device</h2>
                    <p className="text-xs text-slate-500">Scan the QR code with WhatsApp</p>
                  </div>
                </div>
              </div>

              {/* QR / Status / Empty State */}
              <div className="border border-white/5 rounded-xl flex flex-col items-center justify-center bg-black/30 overflow-hidden min-h-[250px]">
                 
                {connectionReady ? (
                   <div className="flex flex-col items-center text-center p-8">
                      <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(16,185,129,0.15)]">
                         <Check className="w-7 h-7 text-emerald-400" />
                      </div>
                      <h3 className="text-lg font-bold text-white mb-1">Connected</h3>
                      <p className="text-slate-400 text-sm max-w-[220px]">Messages will appear in the event log.</p>
                   </div>
                ) : qrCode ? (
                  <div className="flex flex-col items-center p-6">
                    <div className="bg-white p-3 rounded-xl mb-4 shadow-2xl ring-4 ring-primary-500/10 relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-1 bg-primary-500 shadow-[0_0_15px_#10b981] opacity-70 animate-scanline" />
                      <QRCodeSVG value={qrCode} size={160} />
                    </div>
                    <p className="text-xs font-mono text-slate-400 flex items-center gap-2 bg-[#09090b]/80 px-3 py-2 rounded-full border border-white/10 uppercase tracking-widest">
                      <QrCode className="w-3.5 h-3.5" />
                      Scan with WhatsApp
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center p-8">
                     <Globe className="w-8 h-8 stroke-[1.5] text-slate-600 mb-3" />
                     <p className="text-xs text-slate-500 mb-4">No active connection</p>
                     <button
                       onClick={initConnection}
                       disabled={isInitializing}
                       className="bg-primary-600 hover:bg-primary-500 text-white text-sm font-medium rounded-xl px-5 py-2.5 transition-all flex items-center gap-2 disabled:opacity-50"
                     >
                       <RefreshCw className={cn("w-4 h-4", isInitializing && "animate-spin")} />
                       {isInitializing ? "Connecting..." : "Connect Device"}
                     </button>
                  </div>
                )}
              </div>
              
              {/* Show reconnect when QR is active but not connected yet */}
              {qrCode && !connectionReady && (
                <p className="text-xs text-slate-500 mt-3 text-center">
                  Open WhatsApp → Settings → <span className="text-slate-400">Linked Devices</span> → Scan this code
                </p>
              )}
            </div>

            {/* Help callout */}
            <Link 
              to="/docs#quick-start" 
              className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-primary-500/20 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <BookOpen className="w-4 h-4 text-slate-500 group-hover:text-primary-400 transition-colors" />
                <span className="text-sm text-slate-400 group-hover:text-slate-300 transition-colors">Need help? Read the Quick Start guide</span>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-primary-400 group-hover:translate-x-0.5 transition-all" />
            </Link>
          </div>

          {/* Right Column (Event Log Terminal) */}
          <div className="lg:col-span-7 flex flex-col rounded-xl border border-white/10 overflow-hidden shadow-2xl bg-[#09090b] relative min-h-[500px] lg:min-h-0">
            
            {/* Terminal Header */}
            <div className="h-10 bg-white/[0.03] border-b border-white/10 flex items-center justify-between shrink-0 px-4 select-none">
               <div className="flex items-center gap-1.5" aria-hidden="true">
                 <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
                 <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
                 <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
               </div>
               
               <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#121212] border border-white/5">
                  <TerminalSquare className="w-3 h-3 text-slate-500" />
                  <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Event Log</span>
               </div>

               <div className="flex items-center gap-1">
                 {logCount > 0 && (
                   <span className="text-[10px] font-mono text-slate-500">{logCount} entries</span>
                 )}
               </div>
            </div>
            
            {/* Console Area */}
            <div className="flex-1 bg-[#09090b] p-4 font-mono text-xs overflow-y-auto whitespace-pre-wrap leading-relaxed scrollbar-hide" role="log" aria-label="Event log" aria-live="polite">
               {logs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-600">
                     <Activity className="w-6 h-6 mb-3 stroke-1" />
                     <p className="text-xs tracking-wider text-center">
                       {apiKey 
                         ? "Waiting for events... Connect your device to start receiving messages." 
                         : "Register your phone number to get started."}
                     </p>
                  </div>
               ) : (
                  <div className="flex flex-col pb-4">
                    {logs.map((log) => (
                      <div key={log.id} className="flex flex-col py-1 hover:bg-white/[0.02] -mx-4 px-4 transition-colors">
                         <div className="flex items-baseline gap-2 mb-0.5">
                            <span className="text-slate-600 shrink-0 select-none text-[10px]">{log.time}</span>
                            <span className={cn("font-bold uppercase tracking-widest text-[10px] shrink-0", 
                              log.type === 'error' ? 'text-red-400' 
                              : log.type === 'event' ? 'text-blue-400' 
                              : 'text-primary-400'
                            )}>
                               {log.type}
                            </span>
                            <span className={cn("text-slate-300 break-words", 
                              log.type === 'error' && "text-red-300",
                              log.type === 'event' && "text-white"
                            )}>
                               {log.message}
                            </span>
                         </div>
                         
                         {log.data != null ? (
                           <div className="pl-16 mt-0.5">
                              <pre className="text-slate-500 text-[10px] overflow-x-auto scrollbar-hide p-2 bg-[#121212] rounded border border-white/5 inline-block min-w-[200px] max-w-full">
                                 {String(JSON.stringify(log.data, null, 2))}
                              </pre>
                           </div>
                         ) : null}
                      </div>
                    ))}
                    
                    {/* Blinking Cursor */}
                    <div className="flex gap-1.5 mt-3 items-center">
                      <span className="text-primary-500 font-bold text-[10px]">$</span>
                      <div className="w-1.5 h-3 bg-slate-400 animate-pulse" />
                    </div>
                    
                    <div ref={logsEndRef} />
                  </div>
               )}
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}
