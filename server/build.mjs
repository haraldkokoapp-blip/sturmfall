// Kopiert die Spieldateien nach dist/. Nur dieser Ordner wird bei Cloudflare als Webseite hochgeladen.
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';

const FILES = ['index.html', 'assets/models/soldier.glb', 'assets/models/hazmat.glb', 'assets/models/enemy.glb'];
rmSync('dist', { recursive: true, force: true });
for (const f of FILES) {
  mkdirSync('dist/' + f.split('/').slice(0, -1).join('/'), { recursive: true });
  copyFileSync(f, 'dist/' + f);
}
console.log('dist/ fertig: ' + FILES.join(', '));
