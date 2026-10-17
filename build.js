// Builds dist/full-count.html: one offline file with the data, the engine and the UI inlined.
// node build.js
const fs = require('fs');
const path = require('path');

const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
// A literal "</script" inside a script block would end it early.
const safe = s => s.replace(/<\/script/gi, '<\\/script');

const head = src('head.html');
const blocks = ['data.js', 'engine.js', 'ui.js']
  .map(f => `<script>\n${safe(src(f))}\n</script>`)
  .join('\n');
if (!head.includes('<!--SCRIPTS-->')) throw new Error('head.html is missing the <!--SCRIPTS--> placeholder');
const html = head.replace('<!--SCRIPTS-->', () => blocks);

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
const out = path.join(__dirname, 'dist', 'full-count.html');
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${(html.length / 1024).toFixed(0)} KB)`);
