import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="border-t border-border py-8">
      <div className="container flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
        <span>© 2026 Full‑Stack Polymath — Built for the Seedstr Blind Hackathon</span>
        <nav className="flex gap-6">
          <a href="#agents" className="hover:text-primary transition-colors">Agents</a>
          <a href="#how-it-works" className="hover:text-primary transition-colors">How it works</a>
          <Link to="/dashboard" className="hover:text-primary transition-colors">Dashboard</Link>
        </nav>
      </div>
    </footer>
  );
};

export { Footer };
