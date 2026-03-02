const Header = () => {
  return (
    <header className="fixed top-0 w-full bg-background/90 backdrop-blur-md border-b border-border z-50">
      <div className="container flex justify-between items-center h-[70px]">
        <span className="text-2xl font-extrabold tracking-tight">
          <span className="gradient-text">Polymath</span>
        </span>
        <nav className="hidden md:flex gap-8">
          {["Agents", "How it works", "Why win"].map((label) => (
            <a
              key={label}
              href={`#${label.toLowerCase().replace(/\s+/g, "-")}`}
              className="text-muted-foreground font-medium hover:text-primary transition-colors"
            >
              {label}
            </a>
          ))}
          <a
            href="#cta"
            className="text-primary font-medium hover:text-primary/80 transition-colors"
          >
            Join waitlist
          </a>
        </nav>
      </div>
    </header>
  );
};

export { Header };
