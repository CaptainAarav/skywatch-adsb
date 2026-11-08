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
        // web app manifest generated from the constants (install / "add to home screen" name)
        try {
            const mf = {name: PROJECT_NAME, short_name: PROJECT_SHORT, start_url: location.href.split('#')[0], display: 'standalone',
                background_color: '#000000', theme_color: '#000000',
                icons: [{src: new URL('images/tar1090-favicon.png', location.href).href, type: 'image/png'}]};
            const l = document.createElement('link');
            l.rel = 'manifest';
            l.href = URL.createObjectURL(new Blob([JSON.stringify(mf)], {type: 'application/manifest+json'}));
            document.head.appendChild(l);
        } catch (e) {}
    });
})();
