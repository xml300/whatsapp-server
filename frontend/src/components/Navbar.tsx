import { useState } from "react";
import { NavLink } from "react-router-dom";
import { MessageCircle, Terminal, Menu, X, Activity, Home, LayoutDashboard } from "lucide-react";
import { cn } from "../lib/utils";

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 text-sm font-medium px-3 py-2 rounded-xl transition-all duration-200 group ${
      isActive 
        ? 'text-primary-400 bg-primary-500/10' 
        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
    }`;

  const navLinks = [
    { to: "/", label: "Overview", icon: Home },
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/docs", label: "Documentation", icon: Terminal },
    { to: "/logs", label: "Logs", icon: Activity },
  ];

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-white/5 bg-[#09090b]/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 justify-between items-center">
          <NavLink to="/" className="flex items-center gap-2.5 focus-ring rounded-lg p-1">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary-500/20 text-primary-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
              <MessageCircle className="w-6 h-6" />
            </div>
            <span className="font-bold text-xl tracking-tight text-white">
              WA <span className="text-primary-500">API</span>
            </span>
          </NavLink>
          
          {/* Desktop Nav */}
          <div className="hidden md:flex items-center space-x-2">
            {navLinks.map((link) => (
              <NavLink key={link.to} to={link.to} className={linkClass}>
                <link.icon className="w-4 h-4 opacity-70 group-hover:opacity-100 transition-opacity" />
                {link.label}
              </NavLink>
            ))}
          </div>

          {/* Mobile Toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all focus:outline-none focus:ring-2 focus:ring-primary-500/50 active:scale-95"
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
          >
            <div className="relative w-6 h-6 flex items-center justify-center">
              <div className={cn("absolute transition-all duration-300", mobileOpen ? "opacity-0 scale-50 rotate-90" : "opacity-100 scale-100 rotate-0")}>
                <Menu className="w-6 h-6" />
              </div>
              <div className={cn("absolute transition-all duration-300", mobileOpen ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 -rotate-90")}>
                <X className="w-6 h-6 text-primary-400" />
              </div>
            </div>
          </button>
        </div>

        {/* Mobile Dropdown */}
        <div
          className={cn(
            "md:hidden overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]",
            mobileOpen ? 'max-h-[350px] opacity-100 pb-6' : 'max-h-0 opacity-0'
          )}
        >
          <div className="flex flex-col gap-2 pt-4 border-t border-white/5 bg-gradient-to-b from-transparent to-white/[0.01]">
            {navLinks.map((link, i) => (
              <NavLink 
                key={link.to} 
                to={link.to} 
                className={linkClass} 
                onClick={() => setMobileOpen(false)}
                style={{ 
                  transitionDelay: `${mobileOpen ? i * 75 : 0}ms`,
                  transform: mobileOpen ? 'translateX(0)' : 'translateX(-20px)',
                  opacity: mobileOpen ? 1 : 0
                }}
              >
                <link.icon className="w-4 h-4" />
                {link.label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
