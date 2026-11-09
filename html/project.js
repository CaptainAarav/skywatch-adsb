// The one place the project name lives. Everything user-visible reads these (wordmark, <title>, About, PWA name).
"use strict";
const PROJECT_NAME = "Skywatch ADS-B";
const PROJECT_SHORT = "Skywatch";
const PROJECT_CREDIT = "Created by Aarav Sahni · Based on tar1090 by wiedehopf";
const PROJECT_ABOUT = "Skywatch ADS-B is a fork of tar1090 by wiedehopf.";
const PROJECT_UPSTREAM = "https://github.com/wiedehopf/tar1090";

(function () {
    document.title = PROJECT_NAME;
    const set = (sel, fn) => { document.querySelectorAll(sel).forEach(fn); };
    document.addEventListener('DOMContentLoaded', () => {
        set('[data-project="name"]', e => { e.textContent = PROJECT_NAME; });
        set('[data-project="short"]', e => { e.textContent = PROJECT_SHORT; });
        set('[data-project="credit"]', e => { e.textContent = PROJECT_CREDIT; });
        set('[data-project="about"]', e => { e.textContent = PROJECT_ABOUT; });
        set('[data-project="upstream"]', e => { e.href = PROJECT_UPSTREAM; });
        const meta = (n, c) => { const m = document.createElement('meta'); m.name = n; m.content = c; document.head.appendChild(m); };
        meta('application-name', PROJECT_NAME);
        meta('apple-mobile-web-app-title', PROJECT_SHORT);
        meta('mobile-web-app-capable', 'yes');
        // the web app manifest is the static manifest.json (linked in index.html); keep its name fields in step with the constants above
    });
})();
