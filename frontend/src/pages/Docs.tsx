import { useState, useEffect, useRef, useCallback } from "react";
import { Menu, X, Key, MessageSquare, AlertTriangle, Server, Zap, Copy, Check } from "lucide-react";
import { EndpointCard } from "../components/EndpointCard";
import { CodeSnippet } from "../components/CodeSnippet";

export function Docs() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("quick-start");
  const [baseUrlCopied, setBaseUrlCopied] = useState(false);

  // Close mobile menu on route hash change
  useEffect(() => {
    const handleHashChange = () => setIsMobileMenuOpen(false);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // ─── Intersection Observer for Active Sidebar ───
  const observerRef = useRef<IntersectionObserver | null>(null);

  const setupObserver = useCallback(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveSection(visible[0].target.id);
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0.1 }
    );

    document.querySelectorAll("[data-section]").forEach((el) => {
      observerRef.current?.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, []);

  useEffect(() => {
    // Delay to give DOM time to mount
    const timer = setTimeout(setupObserver, 200);
    return () => clearTimeout(timer);
  }, [setupObserver]);

  const handleCopyBaseUrl = () => {
    navigator.clipboard.writeText("http://localhost:3000");
    setBaseUrlCopied(true);
    setTimeout(() => setBaseUrlCopied(false), 2000);
  };

  // ─── Full Endpoint Definitions ───
  const endpoints = [
    {
      category: "Authentication",
      method: "POST" as const,
      path: "/api/auth/register",
      title: "Register User",
      description: "Register a new user to obtain an API Key for subsequent requests. The generated API key is securely hashed on the backend. This is the only endpoint that does not require authentication.",
      parameters: [
        { name: "phoneNumber", type: "string", required: true, description: "The user's phone number exactly as formatted on WhatsApp (e.g., 15550000000). Do not include the + symbol." }
      ],
      snippets: [
        {
          name: "cURL",
          language: "bash",
          code: `curl -X POST http://localhost:3000/api/auth/register \\
  -H "Content-Type: application/json" \\
  -d '{"phoneNumber": "1234567890"}'`
        },
        {
          name: "JavaScript",
          language: "javascript",
          code: `const response = await fetch('http://localhost:3000/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phoneNumber: "1234567890" })
});

const data = await response.json();
console.log(data.apiKey);`
        },
        {
          name: "Python",
          language: "python",
          code: `import requests

response = requests.post(
    "http://localhost:3000/api/auth/register",
    json={"phoneNumber": "1234567890"}
)

data = response.json()
print(data["apiKey"])`
        }
      ],
      responses: [
        {
          name: "200 OK",
          language: "json",
          code: `{
  "status": "success",
  "apiKey": "550e8400-e29b-41d4-a716-446655440000"
}`
        },
        {
          name: "Error",
          language: "json",
          code: `{
  "status": "error",
  "message": "Phone number is required"
}`
        }
      ]
    },
    {
      category: "Authentication",
      method: "POST" as const,
      path: "/api/auth/connect",
      title: "Connect Device",
      description: "Initialize the connection process for a device using your API Key. This triggers the WhatsApp background service to prepare a session and begin generating QR codes.",
      parameters: [],
      snippets: [
        {
          name: "cURL",
          language: "bash",
          code: `curl -X POST http://localhost:3000/api/auth/connect \\
  -H "x-api-key: YOUR_API_KEY"`
        },
        {
          name: "JavaScript",
          language: "javascript",
          code: `const response = await fetch('http://localhost:3000/api/auth/connect', {
  method: 'POST',
  headers: { 'x-api-key': 'YOUR_API_KEY' }
});

const data = await response.json();
console.log(data.serviceStatus);`
        },
        {
          name: "Python",
          language: "python",
          code: `import requests

response = requests.post(
    "http://localhost:3000/api/auth/connect",
    headers={"x-api-key": "YOUR_API_KEY"}
)

print(response.json())`
        }
      ],
      responses: [
        {
          name: "200 OK",
          language: "json",
          code: `{
  "status": "success",
  "serviceStatus": "connecting"
}`
        },
        {
          name: "Error",
          language: "json",
          code: `{
  "status": "error",
  "message": "Invalid API Key"
}`
        }
      ]
    },
    {
      category: "Authentication",
      method: "GET" as const,
      path: "/api/auth/connect/qr",
      title: "Get QR Code",
      description: "Retrieve the QR code base64 string. Display it so the user can scan it via 'Linked Devices' in their WhatsApp app. Call this after /api/auth/connect.",
      parameters: [],
      snippets: [
        {
          name: "cURL",
          language: "bash",
          code: `curl http://localhost:3000/api/auth/connect/qr \\
  -H "x-api-key: YOUR_API_KEY"`
        },
        {
          name: "JavaScript",
          language: "javascript",
          code: `const response = await fetch('http://localhost:3000/api/auth/connect/qr', {
  headers: { 'x-api-key': 'YOUR_API_KEY' }
});

const { qr } = await response.json();
// Render QR code using qrcode library or <img> tag`
        },
        {
          name: "Python",
          language: "python",
          code: `import requests

response = requests.get(
    "http://localhost:3000/api/auth/connect/qr",
    headers={"x-api-key": "YOUR_API_KEY"}
)

qr_string = response.json()["qr"]
# Use qrcode library to render`
        }
      ],
      responses: [
        {
          name: "200 OK",
          language: "json",
          code: `{
  "status": "success",
  "qr": "1@string_payload..."
}`
        }
      ]
    },
    {
      category: "Authentication",
      method: "GET" as const,
      path: "/api/status",
      title: "Connection Status",
      description: "Check if the WhatsApp connection is ready. Poll this endpoint during the QR scanning phase to detect when the user has successfully authenticated.",
      parameters: [],
      snippets: [
        {
          name: "cURL",
          language: "bash",
          code: `curl http://localhost:3000/api/status \\
  -H "x-api-key: YOUR_API_KEY"`
        },
        {
          name: "JavaScript",
          language: "javascript",
          code: `const response = await fetch('http://localhost:3000/api/status', {
  headers: { 'x-api-key': 'YOUR_API_KEY' }
});

const { connected, connectionReady } = await response.json();
console.log('Ready:', connectionReady);`
        },
        {
          name: "Python",
          language: "python",
          code: `import requests

response = requests.get(
    "http://localhost:3000/api/status",
    headers={"x-api-key": "YOUR_API_KEY"}
)

data = response.json()
print("Ready:", data["connectionReady"])`
        }
      ],
      responses: [
        {
          name: "200 OK",
          language: "json",
          code: `{
  "status": "connected",
  "connected": true,
  "connectionReady": true
}`
        }
      ]
    },
    {
      category: "Messaging",
      method: "POST" as const,
      path: "/api/send/text",
      title: "Send Text Message",
      description: "Dispatch a plain text message to a recipient. Requires an active, authenticated connection. Call /api/status to verify readiness before sending.",
      parameters: [
        { name: "phoneNumber", type: "string", required: true, description: "Recipient's phone number without the + symbol (e.g., 1234567890)." },
        { name: "message", type: "string", required: true, description: "The text content of the message to send." }
      ],
      snippets: [
        {
          name: "cURL",
          language: "bash",
          code: `curl -X POST http://localhost:3000/api/send/text \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -d '{"phoneNumber": "1234567890", "message": "Hello World!"}'`
        },
        {
          name: "JavaScript",
          language: "javascript",
          code: `const response = await fetch('http://localhost:3000/api/send/text', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': 'YOUR_API_KEY'
  },
  body: JSON.stringify({
    phoneNumber: "1234567890",
    message: "Hello World!"
  })
});

const data = await response.json();
console.log(data.status);`
        },
        {
          name: "Python",
          language: "python",
          code: `import requests

response = requests.post(
    "http://localhost:3000/api/send/text",
    headers={
        "Content-Type": "application/json",
        "x-api-key": "YOUR_API_KEY"
    },
    json={
        "phoneNumber": "1234567890",
        "message": "Hello World!"
    }
)

print(response.json())`
        }
      ],
      responses: [
        {
          name: "200 OK",
          language: "json",
          code: `{
  "status": "success",
  "message": "Message sent successfully"
}`
        },
        {
          name: "400 Error",
          language: "json",
          code: `{
  "status": "error",
  "message": "Phone number and message are required"
}`
        },
        {
          name: "401 Error",
          language: "json",
          code: `{
  "status": "error",
  "message": "Unauthorized"
}`
        }
      ]
    },
    {
      category: "Messaging",
      method: "GET" as const,
      path: "/api/stream",
      title: "Stream Events (SSE)",
      description: "Open a persistent Server-Sent Events connection to receive real-time WhatsApp messages. The stream emits a 'connected' event on open, then 'message' events as they arrive.",
      parameters: [],
      snippets: [
        {
          name: "cURL",
          language: "bash",
          code: `# Use -N to disable buffering for streaming
curl -N http://localhost:3000/api/stream \\
  -H "x-api-key: YOUR_API_KEY"`
        },
        {
          name: "JavaScript",
          language: "javascript",
          code: `const response = await fetch('http://localhost:3000/api/stream', {
  headers: { 'x-api-key': 'YOUR_API_KEY' }
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}`
        },
        {
          name: "Python",
          language: "python",
          code: `import requests

response = requests.get(
    "http://localhost:3000/api/stream",
    headers={"x-api-key": "YOUR_API_KEY"},
    stream=True  # Required for SSE
)

for line in response.iter_lines():
    if line:
        print(line.decode("utf-8"))`
        }
      ],
      responses: [
        {
          name: "Event Stream",
          language: "json",
          code: `data: {"status": "connected"}

event: message
data: {
  "key": { ... },
  "message": { "conversation": "Hello!" },
  "messageTimestamp": 1690000000
}`
        }
      ]
    }
  ];

  // Group endpoints by category
  const categorizedEndpoints = endpoints.reduce((acc, ep) => {
    if (!acc[ep.category]) acc[ep.category] = [];
    acc[ep.category].push(ep);
    return acc;
  }, {} as Record<string, typeof endpoints>);

  // ─── Sidebar Configuration ───
  const sidebarSections = [
    { id: "quick-start", label: "Quick Start", icon: <Zap className="w-4 h-4 text-primary-500" /> },
    { id: "api-overview", label: "API Overview", icon: <Server className="w-4 h-4 text-primary-500" /> },
  ];

  const sidebarLinkClass = (id: string) =>
    `text-sm font-medium transition-colors flex items-center gap-2 group/link py-1 ${
      activeSection === id ? "text-white" : "text-slate-400 hover:text-white"
    }`;

  const sidebarDotClass = (id: string) =>
    `w-1.5 h-1.5 rounded-full transition-colors ${
      activeSection === id ? "bg-primary-500" : "bg-white/10 group-hover/link:bg-primary-500/50"
    }`;

  return (
    <div className="flex w-full min-h-screen relative bg-[#09090b]">

      {/* Mobile Navigation Toggle */}
      <div className="lg:hidden fixed bottom-6 left-6 z-50">
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="w-14 h-14 rounded-full bg-primary-600 text-white flex items-center justify-center shadow-2xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-[#09090b]"
          aria-label={isMobileMenuOpen ? "Close documentation menu" : "Open documentation menu"}
        >
          {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      <div className="flex-1 flex max-w-[1440px] w-full mx-auto relative px-4 md:px-8">

        {/* Left Column (Sticky Sidebar Navigation) */}
        <aside className={`
          fixed inset-0 z-40 bg-[#09090b]/95 backdrop-blur-xl lg:bg-transparent lg:backdrop-blur-none
          lg:static lg:w-64 lg:shrink-0 pt-24 lg:pt-12 pr-12 border-r border-white/5 
          transition-transform duration-300 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          <div className="sticky top-24 px-8 lg:px-0 h-[calc(100vh-6rem)] overflow-y-auto scrollbar-hide">

            {/* Primary Nav Links */}
            <div className="mb-8">
              {sidebarSections.map((section) => (
                <a key={section.id} href={`#${section.id}`} className={`${sidebarLinkClass(section.id)} mb-2`}>
                  {section.icon}
                  {section.label}
                </a>
              ))}
            </div>

            {/* Endpoint Categories */}
            {Object.entries(categorizedEndpoints).map(([category, eps]) => (
              <div key={category} className="mb-8">
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                  {category === "Authentication" ? <Key className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
                  {category}
                </h4>
                <nav className="flex flex-col gap-2.5">
                  {eps.map((ep) => {
                    const anchorId = ep.path.replace(/[/:]/g, '-').replace(/^-+/, '');
                    return (
                      <a
                        key={ep.path}
                        href={`#${anchorId}`}
                        className={sidebarLinkClass(anchorId)}
                      >
                        <span className={sidebarDotClass(anchorId)} />
                        {ep.title}
                      </a>
                    );
                  })}
                </nav>
              </div>
            ))}

            {/* Errors Section Link */}
            <div className="mb-8">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                <AlertTriangle className="w-3 h-3" />
                Reference
              </h4>
              <nav className="flex flex-col gap-2.5">
                <a href="#errors" className={sidebarLinkClass("errors")}>
                  <span className={sidebarDotClass("errors")} />
                  Error Codes
                </a>
              </nav>
            </div>
          </div>
        </aside>

        {/* Center & Right Columns (Content Wrapper) */}
        <div className="flex-1 py-12 lg:pl-16 min-w-0 pb-32">

          {/* Page Header */}
          <div className="max-w-[800px] xl:max-w-none mb-16">
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">API Documentation</h1>
            <p className="text-xl text-slate-300 max-w-3xl">
              Integrate WhatsApp messaging into your app. Our REST API uses <code className="text-primary-400 bg-primary-500/10 px-2 py-1 rounded font-mono text-base">x-api-key</code> header authentication for multi-tenant sandboxing.
            </p>
          </div>

          {/* ═══════════════════════════════════════════════════════ */}
          {/* SECTION: API Overview (N3, A2 fix)                     */}
          {/* ═══════════════════════════════════════════════════════ */}
          <div id="api-overview" data-section className="scroll-mt-24 mb-16 pt-8 border-t border-white/5">
            <h2 className="text-2xl font-bold text-white mb-8 tracking-tight">API Overview</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Base URL */}
              <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <h5 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Base URL</h5>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono text-primary-400 bg-primary-500/10 px-3 py-2 rounded-lg border border-primary-500/20 truncate">
                    http://localhost:3000
                  </code>
                  <button
                    onClick={handleCopyBaseUrl}
                    className="p-2 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors shrink-0"
                    aria-label="Copy base URL"
                  >
                    {baseUrlCopied ? <Check className="w-4 h-4 text-primary-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-2">Replace with your deployed server address in production.</p>
              </div>

              {/* Authentication */}
              <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <h5 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Authentication</h5>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Include <code className="font-mono text-primary-400 bg-primary-500/10 px-1.5 py-0.5 rounded text-xs">x-api-key: YOUR_KEY</code> in request headers. Obtain your key via <code className="font-mono text-slate-400 text-xs">POST /api/auth/register</code>.
                </p>
              </div>

              {/* Content Type */}
              <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <h5 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Content Type</h5>
                <p className="text-sm text-slate-300 leading-relaxed">
                  All JSON endpoints accept and return <code className="font-mono text-slate-400 text-xs bg-white/5 px-1.5 py-0.5 rounded">application/json</code>. File uploads use <code className="font-mono text-slate-400 text-xs bg-white/5 px-1.5 py-0.5 rounded">multipart/form-data</code>.
                </p>
              </div>

              {/* Rate Limits */}
              <div className="p-5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <h5 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Rate Limits</h5>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Self-hosted — no server-side rate limits imposed. WhatsApp applies its own limits on message frequency. See <a href="https://developers.facebook.com/docs/whatsapp/overview" target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:underline">WhatsApp docs</a> for details.
                </p>
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════ */}
          {/* SECTION: Quick Start Guide (N1, A1, V3 fix)           */}
          {/* ═══════════════════════════════════════════════════════ */}
          <div id="quick-start" data-section className="scroll-mt-24 mb-16 pt-8 border-t border-white/5">
            <div className="flex flex-col xl:flex-row gap-12">
              {/* Left: Step-by-step guide */}
              <div className="flex-1 xl:max-w-[50%]">
                <h2 className="text-3xl font-bold text-white mb-3 tracking-tight">Quick Start</h2>
                <p className="text-slate-300 text-lg mb-8 leading-relaxed max-w-prose">
                  Go from zero to sending your first message in 4 steps.
                </p>

                <div className="flex flex-col gap-6">
                  {/* Step 1 */}
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-lg bg-primary-500/10 border border-primary-500/20 flex items-center justify-center text-sm font-bold text-primary-400 shrink-0 mt-0.5">1</div>
                    <div>
                      <h4 className="text-white font-semibold mb-1">Register your phone number</h4>
                      <p className="text-sm text-slate-400 leading-relaxed">POST to <code className="font-mono text-primary-400 text-xs">/api/auth/register</code> with your phone number. Save the returned <code className="font-mono text-primary-400 text-xs">apiKey</code> — you'll use it for every subsequent request.</p>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-lg bg-primary-500/10 border border-primary-500/20 flex items-center justify-center text-sm font-bold text-primary-400 shrink-0 mt-0.5">2</div>
                    <div>
                      <h4 className="text-white font-semibold mb-1">Initialize the connection</h4>
                      <p className="text-sm text-slate-400 leading-relaxed">POST to <code className="font-mono text-primary-400 text-xs">/api/auth/connect</code> with your API key. This starts the WhatsApp session and begins QR code generation.</p>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-lg bg-primary-500/10 border border-primary-500/20 flex items-center justify-center text-sm font-bold text-primary-400 shrink-0 mt-0.5">3</div>
                    <div>
                      <h4 className="text-white font-semibold mb-1">Scan the QR code</h4>
                      <p className="text-sm text-slate-400 leading-relaxed">GET <code className="font-mono text-primary-400 text-xs">/api/auth/connect/qr</code> to retrieve the QR string. Render it and scan with WhatsApp → Linked Devices. Poll <code className="font-mono text-primary-400 text-xs">/api/status</code> until <code className="font-mono text-slate-400 text-xs">connectionReady: true</code>.</p>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-sm font-bold text-emerald-400 shrink-0 mt-0.5">✓</div>
                    <div>
                      <h4 className="text-white font-semibold mb-1">Send your first message</h4>
                      <p className="text-sm text-slate-400 leading-relaxed">POST to <code className="font-mono text-primary-400 text-xs">/api/send/text</code> with a phone number and message. You're live!</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Full integration example */}
              <div className="flex-1 xl:max-w-[45%] xl:sticky xl:top-24 h-fit">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 pl-1">Complete Integration</h4>
                <CodeSnippet snippets={[
                  {
                    name: "cURL",
                    language: "bash",
                    code: `# Step 1: Register
API_KEY=$(curl -s -X POST http://localhost:3000/api/auth/register \\
  -H "Content-Type: application/json" \\
  -d '{"phoneNumber": "1234567890"}' | jq -r '.apiKey')

echo "Your API key: $API_KEY"

# Step 2: Connect
curl -X POST http://localhost:3000/api/auth/connect \\
  -H "x-api-key: $API_KEY"

# Step 3: Get QR Code (scan with WhatsApp)
curl http://localhost:3000/api/auth/connect/qr \\
  -H "x-api-key: $API_KEY"

# Step 4: Send a message (after QR scan)
curl -X POST http://localhost:3000/api/send/text \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $API_KEY" \\
  -d '{"phoneNumber": "1234567890", "message": "Hello!"}'`
                  },
                  {
                    name: "JavaScript",
                    language: "javascript",
                    code: `const BASE = 'http://localhost:3000';

// Step 1: Register
const { apiKey } = await fetch(\`\${BASE}/api/auth/register\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phoneNumber: '1234567890' })
}).then(r => r.json());

// Step 2: Connect
await fetch(\`\${BASE}/api/auth/connect\`, {
  method: 'POST',
  headers: { 'x-api-key': apiKey }
});

// Step 3: Poll until connected
const poll = async () => {
  const { connectionReady } = await fetch(
    \`\${BASE}/api/status\`,
    { headers: { 'x-api-key': apiKey } }
  ).then(r => r.json());
  if (!connectionReady) {
    await new Promise(r => setTimeout(r, 3000));
    return poll();
  }
};
await poll();

// Step 4: Send message
await fetch(\`\${BASE}/api/send/text\`, {
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
                    code: `import requests, time

BASE = "http://localhost:3000"

# Step 1: Register
data = requests.post(f"{BASE}/api/auth/register",
    json={"phoneNumber": "1234567890"}).json()
api_key = data["apiKey"]
headers = {"x-api-key": api_key}

# Step 2: Connect
requests.post(f"{BASE}/api/auth/connect", headers=headers)

# Step 3: Poll until connected
while True:
    status = requests.get(
        f"{BASE}/api/status", headers=headers
    ).json()
    if status["connectionReady"]:
        break
    time.sleep(3)

# Step 4: Send message
requests.post(f"{BASE}/api/send/text",
    headers={**headers, "Content-Type": "application/json"},
    json={
        "phoneNumber": "1234567890",
        "message": "Hello from Python!"
    }
)`
                  }
                ]} />
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════ */}
          {/* SECTION: Endpoint Reference                            */}
          {/* ═══════════════════════════════════════════════════════ */}
          <div className="w-full">
            {endpoints.map((ep) => {
              const anchorId = ep.path.replace(/[/:]/g, '-').replace(/^-+/, '');
              return (
                <div key={ep.path} data-section id={anchorId} className="scroll-mt-24">
                  <EndpointCard {...ep} />
                </div>
              );
            })}
          </div>

          {/* ═══════════════════════════════════════════════════════ */}
          {/* SECTION: Error Codes Reference (N4 fix)               */}
          {/* ═══════════════════════════════════════════════════════ */}
          <div id="errors" data-section className="scroll-mt-24 pt-16 border-t border-white/5">
            <h2 className="text-3xl font-bold text-white mb-3 tracking-tight">Error Reference</h2>
            <p className="text-slate-300 text-lg mb-10 max-w-prose leading-relaxed">
              All errors follow a consistent JSON shape. Use the <code className="text-primary-400 bg-primary-500/10 px-1.5 py-0.5 rounded font-mono text-sm">status</code> field to distinguish success from failure.
            </p>

            {/* Error Shape */}
            <div className="flex flex-col xl:flex-row gap-10 mb-12">
              <div className="flex-1 xl:max-w-[50%]">
                <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-4 pb-2 border-b border-white/10">Error Schema</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left text-xs text-slate-500 uppercase tracking-widest font-bold py-3 pr-6">Field</th>
                        <th className="text-left text-xs text-slate-500 uppercase tracking-widest font-bold py-3 pr-6">Type</th>
                        <th className="text-left text-xs text-slate-500 uppercase tracking-widest font-bold py-3">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-white/5">
                        <td className="py-3 pr-6"><code className="font-mono text-primary-400 text-xs bg-primary-500/10 px-1.5 py-0.5 rounded">status</code></td>
                        <td className="py-3 pr-6 text-slate-400">string</td>
                        <td className="py-3 text-slate-300">Always <code className="text-red-400 text-xs font-mono">"error"</code> for failed requests</td>
                      </tr>
                      <tr>
                        <td className="py-3 pr-6"><code className="font-mono text-primary-400 text-xs bg-primary-500/10 px-1.5 py-0.5 rounded">message</code></td>
                        <td className="py-3 pr-6 text-slate-400">string</td>
                        <td className="py-3 text-slate-300">Human-readable error description</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex-1 xl:max-w-[45%]">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3 pl-1">Example Error Response</h4>
                <CodeSnippet snippets={[{
                  name: "JSON",
                  language: "json",
                  code: `{
  "status": "error",
  "message": "Phone number and message are required"
}`
                }]} />
              </div>
            </div>

            {/* Common Errors Table */}
            <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-4 pb-2 border-b border-white/10">Common Errors</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left text-xs text-slate-500 uppercase tracking-widest font-bold py-3 pr-6">Endpoint</th>
                    <th className="text-left text-xs text-slate-500 uppercase tracking-widest font-bold py-3 pr-6">Cause</th>
                    <th className="text-left text-xs text-slate-500 uppercase tracking-widest font-bold py-3">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { endpoint: "All protected routes", cause: "Missing x-api-key header", message: "API Key is required" },
                    { endpoint: "All protected routes", cause: "Invalid or expired API key", message: "Invalid API Key" },
                    { endpoint: "POST /api/auth/register", cause: "Missing phoneNumber in body", message: "Phone number is required" },
                    { endpoint: "POST /api/send/text", cause: "Missing phoneNumber or message", message: "Phone number and message are required" },
                    { endpoint: "POST /api/send/text", cause: "Connection not established", message: "Failed to send message" },
                    { endpoint: "POST /api/send/file", cause: "Missing phoneNumber or file", message: "Phone number and file are required" },
                  ].map((err, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 pr-6">
                        <code className="font-mono text-xs text-slate-400 bg-white/5 px-1.5 py-0.5 rounded">{err.endpoint}</code>
                      </td>
                      <td className="py-3 pr-6 text-slate-300">{err.cause}</td>
                      <td className="py-3">
                        <code className="font-mono text-xs text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded">{err.message}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
