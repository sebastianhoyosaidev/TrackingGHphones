// Respaldo de la base de datos.
//
// Copia backend/repairshop.db a un archivo con fecha y hora en
// backend/backups/ usando VACUUM INTO (copia limpia y consistente, segura
// incluso con el servidor corriendo y la base en modo WAL).
//
// Uso:  cd backend && npm run backup
// La carpeta backend/backups/ está ignorada por git.

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, 'repairshop.db');
const backupsDir = path.join(__dirname, 'backups');

if (!fs.existsSync(dbPath)) {
  console.error(`No existe la base de datos: ${dbPath}`);
  console.error('Arranca el servidor una vez (node server.js) para crearla.');
  process.exit(1);
}
fs.mkdirSync(backupsDir, { recursive: true });

const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
  `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const dest = path.join(backupsDir, `repairshop-${stamp}.db`);

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
} finally {
  db.close();
}
console.log(`Respaldo creado: ${dest}`);
