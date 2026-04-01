import { ArrowRight, Zap, Shield, Code2, Terminal, Activity, Container, Copy, Check, MessageSquare, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { CodeSnippet } from "../components/CodeSnippet";
import { BASE_URL } from "../constants";

export function Landing() {
  const [baseUrlCopied, setBaseUrlCopied] = useState(false);

  const handleCopyInstall = () => {
    navigator.clipboard.writeText("git clone https://github.com/user/whatsapp-server && cd whatsapp-server && npm install && npm run dev");
    setBaseUrlCopied(true);
    setTimeout(() => setBaseUrlCopied(false), 2000);
  };

  return (
    <div className="flex flex-col flex-1 bg-[#09090b]">

      {/* ═══════════════════════════════════════════ */}
      {/* Hero Section                                */}
      {/* ═══════════════════════════════════════════ */}
      <section className="relative px-4 pt-28 pb-16 md:pt-40 md:pb-24 overflow-hidden max-w-7xl mx-auto w-full">
        {/* Abstract Background Meshes */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px] pointer-events-none opacity-50" aria-hidden="true">
          <div className="absolute top-0 right-1/4 w-[400px] h-[400px] bg-primary-500/20 blur-[120px] rounded-full mix-blend-screen" />
          <div className="absolute bottom-0 left-1/4 w-[500px] h-[500px] bg-emerald-700/20 blur-[150px] rounded-full mix-blend-screen" />
        </div>

        <div className="relative z-10 flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
          {/* Left: Copy */}
          <div className="flex-1 flex flex-col items-center lg:items-start text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#121212] border border-white/10 text-sm font-medium mb-8 shadow-xl group">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-500"></span>
              </span>
              <span className="text-slate-300 group-hover:text-white transition-colors">v1.0 — Open Source & Self-Hosted</span>
            </div>

            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-white mb-6 leading-[1.08] max-w-2xl">
              The modern way to{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-400 via-emerald-500 to-teal-600">
                integrate WhatsApp
              </span>
            </h1>

            <p className="text-lg md:text-xl text-slate-400 max-w-xl mb-10 leading-relaxed">
              A REST API that handles QR pairing, multi-device sessions, and real-time message streaming — so you write product logic, not WebSocket plumbing.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 items-center w-full sm:w-auto">
              <Link
                to="/docs"
                className="w-full sm:w-auto px-8 py-4 bg-primary-600 hover:bg-primary-500 text-white font-medium rounded-xl transition-all shadow-[0_0_40px_rgba(16,185,129,0.2)] hover:shadow-[0_0_60px_rgba(16,185,129,0.4)] hover:-translate-y-0.5 flex items-center justify-center gap-2"
              >
                <Code2 className="w-5 h-5" />
                Read the Docs
              </Link>
              <Link
                to="/dashboard"
                className="w-full sm:w-auto px-8 py-4 bg-[#121212] hover:bg-white/5 text-slate-200 font-medium rounded-xl border border-white/10 transition-all flex items-center justify-center gap-2 hover:-translate-y-0.5 shadow-xl"
              >
                <Terminal className="w-5 h-5" />
                Open Dashboard
              </Link>
            </div>
          </div>

          {/* Right: Live Code Example */}
          <div className="flex-1 w-full max-w-xl lg:max-w-none">
            <CodeSnippet snippets={[
              {
                name: "cURL",
                language: "bash",
                code: `# 1. Register and get your API key
curl -X POST ${BASE_URL}/api/auth/register \\
  -H "Content-Type: application/json" \\
  -d '{"phoneNumber": "1234567890"}'

# 2. Send a message
curl -X POST ${BASE_URL}/api/send/text \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '{"phoneNumber": "1234567890", "message": "Hello!"}'`
              },
              {
                name: "JavaScript",
                language: "javascript",
                code: `// Register and send your first message in 4 lines
const { apiKey } = await fetch('/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phoneNumber: '1234567890' })
}).then(r => r.json());

await fetch('/api/send/text', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': apiKey
  },
  body: JSON.stringify({
    phoneNumber: '1234567890',
    message: 'Hello from the API!'
  })
});`
              },
              {
                name: "Python",
                language: "python",
                code: `import requests

# Register and get your API key
data = requests.post(
    "${BASE_URL}/api/auth/register",
    json={"phoneNumber": "1234567890"}
).json()

# Send a message
requests.post(
    "${BASE_URL}/api/send/text",
    headers={"x-api-key": data["apiKey"]},
    json={
        "phoneNumber": "1234567890",
        "message": "Hello from Python!"
    }
)`
              }
            ]} />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* Quick Install Bar                           */}
      {/* ═══════════════════════════════════════════ */}
      <section className="px-4 py-6 border-y border-white/5 bg-white/[0.01]">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-4">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest shrink-0">Quick Start</span>
          <div className="flex-1 flex items-center gap-2 bg-[#121212] border border-white/10 rounded-xl px-4 py-3 w-full sm:w-auto overflow-hidden">
            <span className="text-primary-400 font-mono text-sm shrink-0">$</span>
            <code className="text-sm font-mono text-slate-300 truncate flex-1">
              git clone &amp;&amp; cd whatsapp-server &amp;&amp; npm install &amp;&amp; npm run dev
            </code>
            <button
              onClick={handleCopyInstall}
              className="text-slate-500 hover:text-white transition-colors p-1 rounded shrink-0"
              aria-label="Copy install command"
            >
              {baseUrlCopied ? <Check className="w-4 h-4 text-primary-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* How it Works — 3-step flow                  */}
      {/* ═══════════════════════════════════════════ */}
      <section className="px-4 py-24 md:py-32 relative w-full bg-[#09090b]">
        <div className="max-w-[1200px] mx-auto">
          <div className="mb-16 md:text-center">
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-6 tracking-tight">
              Three steps to <span className="text-primary-400">your first message.</span>
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl md:mx-auto">
              From zero to sending a WhatsApp message in under 3 minutes. No third-party services, no webhook setup, no approval process.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-6 relative">
            {/* Connecting line (desktop only) */}
            <div className="hidden md:block absolute top-16 left-[calc(16.67%+24px)] right-[calc(16.67%+24px)] h-px bg-gradient-to-r from-primary-500/40 via-primary-500/20 to-primary-500/40" aria-hidden="true" />

            {/* Step 1 */}
            <div className="relative flex flex-col items-center text-center p-8 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-primary-500/20 transition-colors group">
              <div className="w-12 h-12 rounded-2xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center text-lg font-bold text-primary-400 mb-6 group-hover:bg-primary-500/20 transition-colors relative z-10">
                1
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Register</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                POST your phone number to get an API key. One endpoint, one response — you're authenticated.
              </p>
              <code className="mt-4 text-xs font-mono text-primary-400/60 bg-primary-500/5 px-3 py-1.5 rounded-lg border border-primary-500/10">
                POST /api/auth/register
              </code>
            </div>

            {/* Step 2 */}
            <div className="relative flex flex-col items-center text-center p-8 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-primary-500/20 transition-colors group">
              <div className="w-12 h-12 rounded-2xl bg-primary-500/10 border border-primary-500/20 flex items-center justify-center text-lg font-bold text-primary-400 mb-6 group-hover:bg-primary-500/20 transition-colors relative z-10">
                2
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Scan QR</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Connect your device by scanning the QR code — exactly like WhatsApp Web. No separate approval needed.
              </p>
              <code className="mt-4 text-xs font-mono text-primary-400/60 bg-primary-500/5 px-3 py-1.5 rounded-lg border border-primary-500/10">
                GET /api/auth/connect/qr
              </code>
            </div>

            {/* Step 3 */}
            <div className="relative flex flex-col items-center text-center p-8 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-emerald-500/20 transition-colors group">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-lg font-bold text-emerald-400 mb-6 group-hover:bg-emerald-500/20 transition-colors relative z-10">
                ✓
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Send & Stream</h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                Dispatch messages and subscribe to real-time events over SSE. Full duplex, zero polling.
              </p>
              <code className="mt-4 text-xs font-mono text-emerald-400/60 bg-emerald-500/5 px-3 py-1.5 rounded-lg border border-emerald-500/10">
                POST /api/send/text
              </code>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* Feature Bento Grid                          */}
      {/* ═══════════════════════════════════════════ */}
      <section className="px-4 py-24 md:py-32 relative w-full border-t border-white/5 bg-[#09090b] mesh-bg">
        <div className="max-w-[1200px] mx-auto">

          <div className="mb-16 md:text-center">
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-6 tracking-tight">Built for developers who <span className="text-primary-400">ship.</span></h2>
            <p className="text-lg text-slate-400 max-w-2xl md:mx-auto">We abstracted away the complex WebSockets and local authentication flows so you can focus strictly on your product logic.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-[280px]">

            {/* Card 1: Real-time Events (2 cols) */}
            <div className="col-span-1 md:col-span-2 row-span-1 glass-card p-8 rounded-3xl relative overflow-hidden group flex flex-col justify-end bg-gradient-to-br from-[#121212] to-[#09090b] border-white/5 hover:border-primary-500/30 transition-all duration-500">
              {/* Decorative Terminal UI */}
              <div className="absolute top-6 right-6 bottom-6 left-1/2 rounded-xl bg-[#09090b] border border-white/10 shadow-2xl p-4 overflow-hidden transform group-hover:-translate-y-1 transition-transform duration-700" aria-hidden="true">
                <div className="flex gap-1.5 mb-3">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
                </div>
                <div className="font-mono text-[10px] space-y-1.5 leading-relaxed">
                  <p className="text-slate-500">{">"} listening on /api/stream...</p>
                  <p className="text-primary-400">{">"} event: message</p>
                  <p className="text-slate-400 pl-3">{"{"}"from": "1234567890"{"}"}</p>
                  <p className="text-slate-400 pl-3">{"{"}"body": "Hey, got your API working!"{"}"}</p>
                  <p className="text-primary-400 mt-2">{">"} event: message</p>
                  <p className="text-slate-400 pl-3">{"{"}"from": "0987654321"{"}"}</p>
                  <p className="text-slate-400 pl-3">{"{"}"body": "Order #1042 confirmed ✓"{"}"}</p>
                  <p className="animate-pulse text-slate-600 mt-2">_</p>
                </div>
              </div>

              <div className="relative z-10 w-1/2 pr-8">
                <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-2xl flex items-center justify-center mb-5 shadow-inner border border-emerald-500/20">
                  <Activity className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Real-time Events</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Stream incoming messages over Server-Sent Events. No WebSocket boilerplate — just <code className="text-primary-400 text-xs font-mono">GET /api/stream</code>.
                </p>
              </div>
            </div>

            {/* Card 2: Multi-Device */}
            <div className="col-span-1 row-span-1 glass-card p-8 rounded-3xl relative overflow-hidden group flex flex-col justify-end bg-gradient-to-tr from-[#121212] to-[#09090b] border-white/5 hover:border-primary-500/30 transition-all duration-500">
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-primary-500/5 rounded-full blur-2xl group-hover:bg-primary-500/20 transition-colors duration-700" aria-hidden="true" />
              <div className="relative z-10">
                <div className="w-12 h-12 bg-blue-500/10 text-blue-400 rounded-2xl flex items-center justify-center mb-5 shadow-inner border border-blue-500/20">
                  <Shield className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Multi-Device Auth</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  QR code pairing via Linked Devices. Sessions persist server-side across restarts.
                </p>
              </div>
            </div>

            {/* Card 3: REST API */}
            <div className="col-span-1 row-span-1 glass-card p-8 rounded-3xl relative overflow-hidden group flex flex-col justify-end bg-gradient-to-bl from-[#121212] to-[#09090b] border-white/5 hover:border-primary-500/30 transition-all duration-500">
              <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.05),transparent_50%)]" aria-hidden="true" />
              <div className="relative z-10">
                <div className="w-12 h-12 bg-amber-500/10 text-amber-400 rounded-2xl flex items-center justify-center mb-5 shadow-inner border border-amber-500/20">
                  <Zap className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Simple REST</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Text, files, and typing indicators — all via standard JSON endpoints with <code className="text-primary-400 text-xs font-mono">x-api-key</code> auth.
                </p>
              </div>
            </div>

            {/* Card 4: Self-Hosted (2 cols) */}
            <div className="col-span-1 md:col-span-2 row-span-1 glass-card p-8 rounded-3xl relative overflow-hidden group flex flex-col md:flex-row items-center gap-8 bg-[#121212] border-white/5 hover:border-white/10 transition-all duration-500">
              {/* Decorative grid pattern */}
              <div className="absolute inset-0 opacity-[0.03] pointer-events-none" aria-hidden="true"
                style={{
                  backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)`,
                  backgroundSize: '24px 24px'
                }}
              />

              <div className="relative z-10 flex-1">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-12 h-12 bg-white/5 text-slate-300 rounded-2xl flex items-center justify-center shadow-inner border border-white/10">
                    <Container className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold text-white">Self-Hosted & Open Source</h3>
                </div>
                <p className="text-slate-400 text-sm leading-relaxed mb-6 max-w-lg">
                  Own your infrastructure completely. The Express backend runs on your machine or Docker cluster, bridging REST requests to the Baileys WhatsApp socket — no third-party proxies, no data leaving your network.
                </p>
                <Link to="/docs" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-400 hover:text-primary-300 transition-colors group/cta">
                  Read the documentation
                  <ArrowRight className="w-4 h-4 group-hover/cta:translate-x-0.5 transition-transform" />
                </Link>
              </div>

              {/* Architecture mini-diagram */}
              <div className="relative z-10 shrink-0 hidden md:flex flex-col gap-2 w-48" aria-hidden="true">
                <div className="flex items-center gap-2 px-3 py-2 bg-primary-500/10 border border-primary-500/20 rounded-lg text-xs font-mono text-primary-400">
                  <MessageSquare className="w-3 h-3" /> Your App
                </div>
                <div className="flex justify-center"><ChevronRight className="w-4 h-4 text-slate-600 rotate-90" /></div>
                <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-mono text-slate-400">
                  <Terminal className="w-3 h-3" /> WA API Server
                </div>
                <div className="flex justify-center"><ChevronRight className="w-4 h-4 text-slate-600 rotate-90" /></div>
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs font-mono text-emerald-400">
                  <Shield className="w-3 h-3" /> WhatsApp Web
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════ */}
      {/* CTA + Footer                                */}
      {/* ═══════════════════════════════════════════ */}
      <section className="px-4 py-24 md:py-32 relative w-full border-t border-white/5 bg-[#09090b]">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6 tracking-tight">
            Ready to integrate?
          </h2>
          <p className="text-lg text-slate-400 mb-10 max-w-xl mx-auto">
            Spin up the server, register your phone number, and send your first message — all in under 3 minutes.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
            <Link
              to="/docs#quick-start"
              className="w-full sm:w-auto px-8 py-4 bg-primary-600 hover:bg-primary-500 text-white font-medium rounded-xl transition-all shadow-[0_0_40px_rgba(16,185,129,0.2)] hover:shadow-[0_0_60px_rgba(16,185,129,0.4)] hover:-translate-y-0.5 flex items-center justify-center gap-2"
            >
              Get Started
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              to="/docs"
              className="w-full sm:w-auto px-8 py-4 bg-[#121212] hover:bg-white/5 text-slate-200 font-medium rounded-xl border border-white/10 transition-all flex items-center justify-center gap-2 hover:-translate-y-0.5"
            >
              Full API Reference
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 py-8 border-t border-white/5 bg-[#09090b]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary-500" />
            <span className="font-semibold text-slate-400">WA API</span>
            <span className="text-slate-600">· v1.0</span>
          </div>
          <div className="flex items-center gap-6">
            <Link to="/docs" className="hover:text-slate-300 transition-colors">Documentation</Link>
            <Link to="/dashboard" className="hover:text-slate-300 transition-colors">Dashboard</Link>
            <span className="text-slate-600">Built with Baileys & Express</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
