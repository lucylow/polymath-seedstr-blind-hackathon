import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "Agents", href: "#agents" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Why win", href: "#why-win" },
];

const Header = () => {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed top-0 w-full bg-background/90 backdrop-blur-md border-b border-border z-50">
      <div className="container flex justify-between items-center h-[70px]">
        <Link to="/" className="text-2xl font-extrabold tracking-tight">
          <span className="gradient-text">Polymath</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="text-muted-foreground font-medium hover:text-primary transition-colors"
            >
              {item.label}
            </a>
          ))}
          <Button variant="hero" size="sm" asChild>
            <Link to="/dashboard">Try Dashboard</Link>
          </Button>
        </nav>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-2 text-foreground"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile nav */}
      {open && (
        <nav className="md:hidden border-t border-border bg-background/95 backdrop-blur-md">
          <div className="container flex flex-col gap-4 py-6">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="text-foreground font-medium hover:text-primary transition-colors"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ))}
            <Button variant="hero" size="sm" asChild>
              <Link to="/dashboard" onClick={() => setOpen(false)}>
                Try Dashboard
              </Link>
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
};

export { Header };
