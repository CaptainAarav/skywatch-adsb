// Deny-list: retired UI class / file / function names must not reappear. One implementation of each UI element.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..', 'html');
const RETIRED = ['ibT6', 'ibPhoneInst', 'ibRow2', 'sheetHandle', 'mlPill', 'updatePills', 'apX', 'setClose', 'gClose', 'popoverClose',
  'tar-ap-pin', 'airportFlagExpr', 'sw-label-pill', 'palEmpty', 'search_warning',
  // phase 38: the phone map buttons and the desktop control stack are one component; one chip; one view-mode switch
  'pcBtn', 'pcCol', 'pcLeft', 'pcCycle', 'pcCycleLabel', 'pcMenu', 'pcMenuItem', 'pcCompass', 'pcInfo', 'phoneCtl', 'phoneView', 'phoneInfo', 'dimSwitch',
  'phone_list_button', 'initPhoneLayout', 'apChip', 'apPill', 'apCat', 'palChip', 'ap-dot'];
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const s = fs.statSync(p);
  if (s.isDirectory()) { if (!/^(libs|airport-db|db|flags|images|geojson)/.test(f)) walk(p); } else if (/\.(js|css|html)$/.test(f) && !/min\.|\.min/.test(f) && !/(^|\/)libs\//.test(p)) files.push(p); } })(root);
let bad = 0;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const n of RETIRED) if (new RegExp('(^|[^A-Za-z0-9_-])' + n + '([^A-Za-z0-9_-]|$)').test(s)) { console.error('retired name ' + n + ' in ' + path.relative(root, f)); bad++; }
}
// one data-component set: each component id appears once in index.html
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const c of ['altitude', 'speed', 'direction']) {
  const n = (html.match(new RegExp('data-component="' + c + '"', 'g')) || []).length;
  if (n !== 1) { console.error('data-component=' + c + ' appears ' + n + ' times'); bad++; }
}
// one control stack with the same element ids on every device
if ((html.match(/id="controlStack"/g) || []).length !== 1) { console.error('#controlStack must appear exactly once'); bad++; }
for (const id of ['north_up', 'H', 'follow_button', 'layers_button', 'view_cycle', 'viewMenu', 'view2d', 'view3d', 'viewGlobe', 'RP', 'attr_button']) {
  const m = html.match(new RegExp('id="' + id + '"', 'g')) || [];
  if (m.length !== 1) { console.error('id ' + id + ' appears ' + m.length + ' times'); bad++; }
  const stack = html.slice(html.indexOf('id="controlStack"'), html.indexOf('id="toolbar"'));
  if (stack.indexOf('id="' + id + '"') < 0) { console.error('id ' + id + ' is not inside #controlStack'); bad++; }
}
for (const f of ['ui/maplibre-pills.js']) if (fs.existsSync(path.join(root, f))) { console.error('retired file ' + f); bad++; }
if (bad) process.exit(1);
console.log('one-component-set: ok (' + files.length + ' files scanned)');
