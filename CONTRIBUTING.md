# Contributing

Issues and pull requests are welcome.

- Keep changes small and focused; explain what you saw and how you checked it.
- Work in `html/` (no build step). New or changed JS/CSS files that are cache-busted must be listed in `cachebust.list`.
- Build HTML from aircraft or network data with `escHtml()` / `safeUrl()` or DOM nodes, never raw string concatenation.
- Never commit receiver positions, hostnames, keys or screenshots showing a home location.
- Keep the upstream licence headers. Contributions are accepted under GPL v2 or later.
- Notes on how the UI is organised are in `docs/DEVELOPMENT.md` and `design/`.
