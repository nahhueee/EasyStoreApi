const fs = require('fs');
const path = require('path');
const { Afip } = require('afip.ts');

const ROOT = path.resolve(__dirname, '..');
const CUIT_SUCEDE = 30714907626;

async function obtenerAfipProduccion() {
    const certFolder = path.resolve(ROOT, 'src/certs', String(CUIT_SUCEDE));
    const cert = fs.readFileSync(path.join(certFolder, 'cert'), 'utf8').trim();
    const key = fs.readFileSync(path.join(certFolder, 'key'), 'utf8').trim();
    const ticketPath = path.resolve(ROOT, 'tokens-investigacion', String(CUIT_SUCEDE));
    fs.mkdirSync(ticketPath, { recursive: true });
    return new Afip({ key, cert, cuit: CUIT_SUCEDE, production: true, ticketPath });
}

async function main() {
    const afip = await obtenerAfipProduccion();
    const info = await afip.electronicBillingService.getVoucherInfo(4, 12, 3);
    console.log(JSON.stringify(info, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
