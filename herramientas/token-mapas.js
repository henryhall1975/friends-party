/* Genera el token de Apple Maps (MapKit JS) que usa el sitio.
   Uso:  node herramientas/token-mapas.js <ruta al AuthKey_XXXX.p8> <origen> [días]
   El token solo sirve en el origen indicado (p. ej. https://henryhall1975.github.io) y caduca: hay que generarlo de nuevo antes de esa fecha
   y pegarlo en MAPKIT_TOKEN de index.html. La llave .p8 nunca se sube al repositorio. */
var fs = require('fs'), crypto = require('crypto'), path = require('path');
var keyPath = process.argv[2], origin = process.argv[3], days = +(process.argv[4] || 365);
if (!keyPath || !origin) { console.error('Faltan datos: ruta de la llave y origen'); process.exit(1); }
var kid = (path.basename(keyPath).match(/AuthKey_([A-Z0-9]+)\.p8/) || [])[1];
if (!kid) { console.error('El archivo debe llamarse AuthKey_<KeyID>.p8'); process.exit(1); }
var TEAM = 'P4242HMZ49';
var b64 = function(o){ return Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url'); };
var now = Math.floor(Date.now() / 1000), exp = now + days * 86400;
var data = b64({alg: 'ES256', kid: kid, typ: 'JWT'}) + '.' + b64({iss: TEAM, iat: now, exp: exp, origin: origin});
var sig = crypto.sign('sha256', Buffer.from(data), {key: fs.readFileSync(keyPath), dsaEncoding: 'ieee-p1363'}).toString('base64url');
console.error('Caduca: ' + new Date(exp * 1000).toISOString().slice(0, 10));
console.log(data + '.' + sig);
