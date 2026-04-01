import { useState } from "react";
import { NavLink } from "react-router-dom";
import { MessageCircle, Terminal, Cpu, Menu, X } from "lucide-react";

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary-400 ${isActive ? 'text-primary-400' : 'text-slate-300'}`;

  return (
    <nav className="sticky top-0 z-50 w-full glass">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary-500/20 text-primary-400">
              <MessageCircle className="w-6 h-6" />
            </div>
            <span className="font-bold text-xl tracking-tight text-slate-100">
              WA API
            </span>
          </div>
          
          {/* Desktop Nav */}
          <div className="hidden md:flex items-center space-x-8">
            <NavLink to="/" className={linkClass}>
              Overview
            </NavLink>
            <NavLink to="/dashboard" className={linkClass}>
              <Cpu className="w-4 h-4" />
              Dashboard
            </NavLink>
            <NavLink to="/docs" className={linkClass}>
              <Terminal className="w-4 h-4" />
              Documentation
            </NavLink>
          </div>

          {/* Mobile Toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500/50"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile Dropdown */}
        <div
          className={`md:hidden overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${
            mobileOpen ? 'max-h-48 opacity-100 pb-4' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="flex flex-col gap-1 pt-2 border-t border-white/5">
            <NavLink to="/" className={linkClass} onClick={() => setMobileOpen(false)}>
              Overview
            </NavLink>
            <NavLink to="/dashboard" className={linkClass} onClick={() => setMobileOpen(false)}>
              <Cpu className="w-4 h-4" />
              Dashboard
            </NavLink>
            <NavLink to="/docs" className={linkClass} onClick={() => setMobileOpen(false)}>
              <Terminal className="w-4 h-4" />
              Documentation
            </NavLink>
          </div>
        </div>
      </div>
    </nav>
  );
}
