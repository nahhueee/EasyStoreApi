// USO ÚNICO: rehashea con bcrypt las contraseñas en texto plano existentes.
// Ejecutar una sola vez desde EasyStoreApi/:  npx ts-node src/rehash-once-plaintext-passwords.ts
// Es idempotente (si una pass ya está hasheada, $2a$/$2b$, la salta), pero BORRAR este archivo
// del repo después de correrlo: es un script de migración puntual, no parte de la app.

import db from './db';
import bcrypt from 'bcryptjs';

async function run() {
    const connection = await db.getConnection();

    try {
        const rows: any = await connection.query("SELECT id, usuario, pass FROM usuarios");
        const usuarios = rows[0];

        for (const u of usuarios) {
            if (typeof u.pass === 'string' && u.pass.startsWith('$2')) {
                console.log(`Usuario "${u.usuario}" (id ${u.id}) ya tiene hash, se omite.`);
                continue;
            }

            const hash = await bcrypt.hash(u.pass, 10);
            await connection.query("UPDATE usuarios SET pass = ? WHERE id = ?", [hash, u.id]);
            console.log(`Usuario "${u.usuario}" (id ${u.id}) rehasheado.`);
        }

        console.log('Listo.');
    } finally {
        connection.release();
        process.exit(0);
    }
}

run().catch(err => {
    console.error('Error al rehashear:', err);
    process.exit(1);
});
