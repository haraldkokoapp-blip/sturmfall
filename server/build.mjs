// Kopiert die Spieldateien nach dist/. Nur dieser Ordner wird bei Cloudflare als Webseite hochgeladen.
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';

const FILES = ['index.html'];
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
for (const f of FILES) copyFileSync(f, 'dist/' + f);
console.log('dist/ fertig: ' + FILES.join(', '));
