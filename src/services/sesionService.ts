const fs = require('fs');
const path = require('path');
// Ruta del archivo de sesión
const sessionFile = path.join(__dirname, '../', 'session.json');

class SesionService{

    GuardarSesion(id, usuario, nombre, cargo) {
        const sesion = {
            id,
            usuario,
            nombre,
            cargo,
            fecha: new Date().toISOString() 
        };

        fs.writeFileSync(sessionFile, JSON.stringify(sesion, null, 2), 'utf8');
    }

    LeerSesion() {
        if (fs.existsSync(sessionFile)) {
            const data = fs.readFileSync(sessionFile, 'utf8');
            return JSON.parse(data);
        } else {
            return null;
        }
    }
}
export const SesionServ = new SesionService();