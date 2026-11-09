# Skywatch ADS-B logo pack

Mark: a control tower sending/receiving radio. Fonts are converted to outlines in every SVG (Inter Bold/SemiBold, SIL OFL), so nothing depends on installed fonts.

## Files
svg/   sources (use these when you can)
png/   exports
favicon.ico            16/32/48

| Use | File |
|---|---|
| Browser tab (modern) | svg/skywatch-favicon.svg |
| Browser tab (legacy) | favicon.ico |
| iOS home screen | png/skywatch-apple-touch-icon-180.png (square, iOS rounds it) |
| PWA manifest "any" | png/skywatch-app-icon-192.png, -512.png |
| PWA manifest "maskable" | png/skywatch-maskable-icon-192.png, -512.png |
| README header (dark theme) | svg/skywatch-lockup-dark.svg |
| README header (light theme) | svg/skywatch-lockup-light.svg |
| GitHub social preview (Settings > Social preview) | png/skywatch-social-banner.png (1280x640) |
| Transparent mark, dark backgrounds | svg/skywatch-mark-white.svg |
| Transparent mark, light backgrounds | svg/skywatch-mark-black.svg |
| Light app icon | svg/skywatch-app-icon-light.svg |

## HTML head
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/img/skywatch-favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/img/skywatch-apple-touch-icon-180.png">
<meta name="theme-color" content="#000000">

## manifest icons
{"src":"img/skywatch-app-icon-192.png","sizes":"192x192","type":"image/png","purpose":"any"},
{"src":"img/skywatch-app-icon-512.png","sizes":"512x512","type":"image/png","purpose":"any"},
{"src":"img/skywatch-maskable-icon-192.png","sizes":"192x192","type":"image/png","purpose":"maskable"},
{"src":"img/skywatch-maskable-icon-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}

## README header (switches with the viewer's GitHub theme)
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo/skywatch-lockup-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/logo/skywatch-lockup-light.svg">
  <img alt="Skywatch ADS-B" src="docs/logo/skywatch-lockup-dark.svg" height="96">
</picture>

## Notes
- The favicon is a simplified, chunkier tower (no radio arcs, no window slits) so it stays readable at 16 px.
- Keep clear space around the lockup of at least the width of the tower base. Do not recolour; white on black or black on white only.
- The logo is original artwork for this project. Licence it the same as the repo, or reserve it; your call.
