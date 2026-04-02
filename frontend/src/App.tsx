import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { Landing } from "./pages/Landing";
import { Dashboard } from "./pages/Dashboard";
import { Docs } from "./pages/Docs";

import { Logs } from "./pages/Logs";

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-dark-900 flex flex-col font-sans selection:bg-primary-500/30">
        <Navbar />
        <main className="flex-1 flex flex-col">
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/logs" element={<Logs />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
