// Catálogos administrables (ABM en Administración > Catálogos). Ver HANDOFF-abm-catalogos-y-motivos.md.
//
// Un solo repositorio para todos: cada catálogo se registra en CATALOGOS. El nombre de la tabla SALE DE ESTE
// MAPA, nunca del request (el :cat de la URL solo es la clave del mapa), así no hay inyección SQL.
// Reglas comunes: nunca DELETE físico (baja lógica con fechaBaja + usuarioBaja, reactivable), descripción única
// sin distinguir mayúsculas y sin espacios al borde.
import db from '../db';
import { PoolConnection } from 'mysql2/promise';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';

interface CatalogoConfig {
    tabla: string;
    // Campos editables además de id / fechaBaja / usuarioBaja. Cada campo nuevo necesita su validación en Normalizar.
    campos: ('descripcion' | 'orden')[];
    ordenarPor: string;
    maxDescripcion: number;
    // Subconsulta que cuenta cuántas veces se usa el registro `t` (alimenta la columna "En uso" y las reglas de edición).
    sqlUso: string;
    // Si es true, la descripción de un registro en uso no se puede cambiar: el cruce con los comprobantes es por TEXTO.
    descripcionBloqueadaSiEnUso: boolean;
    mensajeRenombreBloqueado: (enUso: number) => string;
}

const CATALOGOS: Record<string, CatalogoConfig> = {
    'motivos-sin-productos': {
        tabla: 'motivos_sin_productos',
        campos: ['descripcion', 'orden'],
        ordenarPor: 't.orden, t.descripcion',
        maxDescripcion: 100,
        sqlUso: `SELECT COUNT(*) FROM ventas v WHERE v.observacion = t.descripcion AND v.fechaBaja IS NULL`,
        descripcionBloqueadaSiEnUso: true,
        mensajeRenombreBloqueado: (enUso) =>
            `Este motivo ya se usó en ${enUso} comprobante${enUso === 1 ? '' : 's'}; no se puede renombrar. Dalo de baja y creá uno nuevo.`,
    },
};

function Validacion(mensaje: string, cat?: string): AppError {
    return new AppError(CodigoError.VALIDACION, mensaje, 400, { modulo: 'CatalogosRepository', cat });
}

function NoEncontrado(mensaje: string, cat?: string): AppError {
    return new AppError(CodigoError.NOT_FOUND, mensaje, 404, { modulo: 'CatalogosRepository', cat });
}

function ConfigDe(cat: string): CatalogoConfig {
    if (!Object.prototype.hasOwnProperty.call(CATALOGOS, cat)) throw NoEncontrado('Catálogo inexistente.', cat);
    return CATALOGOS[cat];
}

function IdValido(id: any): number {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw Validacion('Id inválido.');
    return n;
}

// Solo devuelve los campos de cfg.campos: es lo único que llega a los INSERT/UPDATE.
function Normalizar(cfg: CatalogoConfig, body: any): Record<string, any> {
    const datos: Record<string, any> = {};

    for (const campo of cfg.campos) {
        if (campo === 'descripcion') {
            const descripcion = String(body?.descripcion ?? '').trim();
            if (!descripcion) throw Validacion('La descripción es obligatoria.');
            if (descripcion.length > cfg.maxDescripcion)
                throw Validacion(`La descripción no puede superar los ${cfg.maxDescripcion} caracteres.`);
            datos.descripcion = descripcion;
        } else if (campo === 'orden') {
            const crudo = body?.orden;
            if (crudo === undefined || crudo === null || crudo === '') continue; // alta: se asigna el siguiente; modificación: no se toca
            const orden = Number(crudo);
            if (!Number.isInteger(orden) || orden < 0) throw Validacion('El orden tiene que ser un número entero mayor o igual a 0.');
            datos.orden = orden;
        }
    }

    return datos;
}

function Mapear(cfg: CatalogoConfig, fila: any): any {
    const enUso = Number(fila.enUso);
    return { ...fila, enUso, descripcionBloqueada: cfg.descripcionBloqueadaSiEnUso && enUso > 0 };
}

async function ObtenerRegistro(connection: PoolConnection, cfg: CatalogoConfig, id: number): Promise<any | undefined> {
    const [filas]: any = await connection.query(
        `SELECT t.*, (${cfg.sqlUso}) AS enUso FROM ${cfg.tabla} t WHERE t.id = ?`,
        [id]
    );
    return filas.length > 0 ? Mapear(cfg, filas[0]) : undefined;
}

// La comparación usa la collation de la columna: no distingue mayúsculas, acentos ni espacios al borde.
async function ValidarDuplicado(connection: PoolConnection, cfg: CatalogoConfig, descripcion: string, idExcluido?: number): Promise<void> {
    const [filas]: any = await connection.query(
        `SELECT descripcion, fechaBaja FROM ${cfg.tabla} WHERE descripcion = ?${idExcluido ? ' AND id <> ?' : ''} LIMIT 1`,
        idExcluido ? [descripcion, idExcluido] : [descripcion]
    );
    if (filas.length === 0) return;

    const baja = filas[0].fechaBaja ? ' Está dado de baja: reactivalo desde la grilla.' : '';
    throw Validacion(`Ya existe "${filas[0].descripcion}" en este catálogo.${baja}`);
}

// El UNIQUE de la base cubre la carrera entre dos altas simultáneas.
function TraducirDuplicado(error: any, descripcion: string): any {
    return error?.code === 'ER_DUP_ENTRY' ? Validacion(`Ya existe "${descripcion}" en este catálogo.`) : error;
}

class CatalogosRepository {

    async Listar(cat: string, soloActivos: boolean): Promise<any[]> {
        const cfg = ConfigDe(cat);
        const connection = await db.getConnection();

        try {
            const [filas]: any = await connection.query(
                `SELECT t.*, (${cfg.sqlUso}) AS enUso FROM ${cfg.tabla} t` +
                `${soloActivos ? ' WHERE t.fechaBaja IS NULL' : ''} ORDER BY ${cfg.ordenarPor}`
            );
            return (filas as any[]).map(fila => Mapear(cfg, fila));
        } finally {
            connection.release();
        }
    }

    async Agregar(cat: string, body: any): Promise<{ id: number }> {
        const cfg = ConfigDe(cat);
        const datos = Normalizar(cfg, body);
        const connection = await db.getConnection();

        try {
            await ValidarDuplicado(connection, cfg, datos.descripcion);

            if (cfg.campos.includes('orden') && datos.orden === undefined) {
                const [filas]: any = await connection.query(`SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente FROM ${cfg.tabla}`);
                datos.orden = Number(filas[0].siguiente);
            }

            const columnas = Object.keys(datos);
            const [resultado]: any = await connection.query(
                `INSERT INTO ${cfg.tabla} (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`,
                columnas.map(c => datos[c])
            );
            return { id: resultado.insertId };
        } catch (error: any) {
            throw TraducirDuplicado(error, datos.descripcion);
        } finally {
            connection.release();
        }
    }

    async Modificar(cat: string, id: any, body: any): Promise<{ id: number }> {
        const cfg = ConfigDe(cat);
        const idRegistro = IdValido(id);
        const datos = Normalizar(cfg, body);
        const connection = await db.getConnection();

        try {
            const actual = await ObtenerRegistro(connection, cfg, idRegistro);
            if (!actual) throw NoEncontrado('El registro no existe.', cat);

            if (cfg.descripcionBloqueadaSiEnUso && datos.descripcion !== actual.descripcion && actual.enUso > 0)
                throw Validacion(cfg.mensajeRenombreBloqueado(actual.enUso), cat);

            await ValidarDuplicado(connection, cfg, datos.descripcion, idRegistro);

            const columnas = Object.keys(datos);
            await connection.query(
                `UPDATE ${cfg.tabla} SET ${columnas.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
                [...columnas.map(c => datos[c]), idRegistro]
            );
            return { id: idRegistro };
        } catch (error: any) {
            throw TraducirDuplicado(error, datos.descripcion);
        } finally {
            connection.release();
        }
    }

    // Baja lógica: el registro deja de ofrecerse para cargas nuevas pero sigue existiendo (los comprobantes
    // históricos lo siguen identificando). Nunca DELETE físico.
    async DarBaja(cat: string, id: any, usuario: string): Promise<{ id: number }> {
        const cfg = ConfigDe(cat);
        const idRegistro = IdValido(id);
        const connection = await db.getConnection();

        try {
            const actual = await ObtenerRegistro(connection, cfg, idRegistro);
            if (!actual) throw NoEncontrado('El registro no existe.', cat);
            if (actual.fechaBaja) throw Validacion('Ya está dado de baja.', cat);

            await connection.query(
                `UPDATE ${cfg.tabla} SET fechaBaja = NOW(), usuarioBaja = ? WHERE id = ? AND fechaBaja IS NULL`,
                [usuario, idRegistro]
            );
            return { id: idRegistro };
        } finally {
            connection.release();
        }
    }

    async Reactivar(cat: string, id: any): Promise<{ id: number }> {
        const cfg = ConfigDe(cat);
        const idRegistro = IdValido(id);
        const connection = await db.getConnection();

        try {
            const actual = await ObtenerRegistro(connection, cfg, idRegistro);
            if (!actual) throw NoEncontrado('El registro no existe.', cat);
            if (!actual.fechaBaja) throw Validacion('No está dado de baja.', cat);

            await connection.query(
                `UPDATE ${cfg.tabla} SET fechaBaja = NULL, usuarioBaja = NULL WHERE id = ? AND fechaBaja IS NOT NULL`,
                [idRegistro]
            );
            return { id: idRegistro };
        } finally {
            connection.release();
        }
    }
}

export const CatalogosRepo = new CatalogosRepository();
