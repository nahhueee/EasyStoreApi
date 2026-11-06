import db from '../db';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { ResultSetHeader } from 'mysql2';
import { ChequePropioDTO } from '../models/ChequePropio';
const moment = require('moment');

// Cheque propio y endoso de cheques de terceros en Compras (ver HANDOFF-cheque-propio-y-endoso.md).
//
// Dos circuitos, dos métodos de pago distintos:
//  - CHEQUE_PROPIO: cheque de chequera propia / eCheq. Emitirlo egresa del fondo puente "Cheques emitidos a
//    debitar" (el egreso lo hace el loop de piernas existente, porque metodo.idFondo = puente). Recién al
//    apretar Debitar sale del banco.
//  - CHEQUE: endoso de un cheque recibido de un cliente, PENDIENTE en Valores a Acreditar. El egreso de
//    Valores a Acreditar también lo hace el loop existente; acá solo se marca el valor como ENDOSADO.
//
// Los helpers exportados reciben la `connection` del llamador (comprasRepository / comprasCuentasRepository)
// para correr dentro de SU transacción. Debitar y ObtenerCheques abren la suya.


// Pierna de pago tal como llega del front (Compra.pagos[] / PagarProveedorDTO.metodos[]).
export interface PiernaPago {
    idMetodo: number;
    monto: number;
    cheque?: ChequePropioDTO;
    idValorAcreditar?: number;
}

export interface ContextoCheque {
    idEmpresa: number;
    idProveedor: number;
    usuario: string;
}

const MODULO = 'ChequesRepo';
const TOLERANCIA = 0.01;

//#region VALIDACIÓN (previa a la transacción)
// Corre ANTES del beginTransaction. Devuelve el mensaje de error, o null si está todo bien (mismo patrón
// que las validaciones previas de ComprasRepo.Agregar). No bloquea filas: la verificación definitiva del
// cheque de terceros es EndosarValor, con FOR UPDATE.
export async function ValidarPiernasCheque(connection, piernas: PiernaPago[], idEmpresa: number): Promise<string | null> {
    const ids = [...new Set(piernas.map(p => Number(p.idMetodo)).filter(Boolean))];
    if (!ids.length) return null;

    const [metodos]: any = await connection.query(
        'SELECT id, tipo, idEmpresa FROM metodos_pago WHERE id IN (?)',
        [ids]
    );
    const metodoPorId = new Map<number, { tipo: string; idEmpresa: number }>();
    for (const m of metodos) metodoPorId.set(m.id, m);

    const valoresVistos = new Set<number>();
    const chequesVistos = new Set<string>();

    for (const pierna of piernas) {
        const metodo = metodoPorId.get(Number(pierna.idMetodo));
        if (!metodo) continue; // un método inexistente ya lo rechaza GetMetodoPago en el llamador

        // Datos de cheque en un método que no es de cheque: el front no los manda, así que es un body
        // armado a mano. No se ignoran en silencio.
        if (metodo.tipo !== 'CHEQUE_PROPIO' && pierna.cheque) {
            return 'Solo el método "Cheque propio" admite datos de cheque emitido.';
        }
        if (metodo.tipo !== 'CHEQUE' && pierna.idValorAcreditar) {
            return 'Solo el método "Cheque" admite endosar un cheque de terceros.';
        }

        if (metodo.tipo === 'CHEQUE_PROPIO') {
            if (Number(metodo.idEmpresa) !== Number(idEmpresa)) return 'El método "Cheque propio" no corresponde a la empresa.';
            const error = await ValidarChequePropio(connection, pierna, idEmpresa, chequesVistos);
            if (error) return error;
        }

        if (metodo.tipo === 'CHEQUE') {
            if (Number(metodo.idEmpresa) !== Number(idEmpresa)) return 'El método "Cheque" no corresponde a la empresa.';
            const idValor = Number(pierna.idValorAcreditar);
            if (!idValor) return 'Elegí el cheque a endosar.';
            if (valoresVistos.has(idValor)) return `El cheque #${idValor} está repetido en el pago.`;
            valoresVistos.add(idValor);
        }
    }
    return null;
}

async function ValidarChequePropio(connection, pierna: PiernaPago, idEmpresa: number, chequesVistos: Set<string>): Promise<string | null> {
    const c = pierna.cheque;
    if (!c) return 'Completá los datos del cheque propio.';
    if (!Number(pierna.monto) || Number(pierna.monto) <= 0) return 'El importe del cheque propio debe ser mayor a cero.';
    if (!Number(c.idFondoBanco)) return 'Elegí la cuenta de la que se libra el cheque.';
    if (c.tipo !== 'FISICO' && c.tipo !== 'ECHEQ') return 'Indicá si el cheque es físico o eCheq.';

    const numero = String(c.numero ?? '').trim();
    if (!numero) return 'Ingresá el número de cheque.';
    if (numero.length > 30) return 'El número de cheque no puede superar los 30 caracteres.';

    // ISO_8601 estricto: acepta 'YYYY-MM-DD' y también el ISO completo que serializa un Date de JS.
    const emision = moment(c.fechaEmision, moment.ISO_8601, true);
    const pago = moment(c.fechaPago, moment.ISO_8601, true);
    if (!emision.isValid()) return 'La fecha de emisión del cheque no es válida.';
    if (!pago.isValid()) return 'La fecha de pago del cheque no es válida.';
    if (pago.isBefore(emision, 'day')) return 'La fecha de pago no puede ser anterior a la de emisión.';

    // La cuenta tiene que ser un banco con el que la empresa opera: el fondo de uno de sus métodos
    // TRANSFERENCIA (decisión 3-nov-2026: así el combo y la validación salen de la misma fuente).
    const [bancos]: any = await connection.query(
        `SELECT f.id
         FROM metodos_pago mp
         INNER JOIN fondos f ON f.id = mp.idFondo
         WHERE mp.idEmpresa = ? AND mp.tipo = 'TRANSFERENCIA' AND f.tipo = 'BANCARIO' AND f.activo = 1 AND f.id = ?
         LIMIT 1`,
        [idEmpresa, c.idFondoBanco]
    );
    if (!bancos.length) return 'La cuenta elegida no corresponde a un banco de la empresa.';

    const clave = `${c.idFondoBanco}|${numero}`;
    if (chequesVistos.has(clave)) return `El cheque ${numero} está repetido en el pago.`;
    chequesVistos.add(clave);

    // Duplicado contra la base (solo cheques vigentes: un ANULADO libera el número). El UNIQUE sobre
    // numeroVigente es el respaldo ante una carrera entre dos usuarios.
    const [dup]: any = await connection.query(
        `SELECT id FROM cheques_emitidos WHERE idFondoBanco = ? AND numero = ? AND estado <> 'ANULADO' LIMIT 1`,
        [c.idFondoBanco, numero]
    );
    if (dup.length) return `Ya existe un cheque vigente con el número ${numero} en esa cuenta.`;

    return null;
}
//#endregion

//#region EMITIR / ENDOSAR (dentro de la transacción del llamador)
// Inserta el cheque propio EMITIDO y devuelve su id. El EGRESO del fondo puente NO se hace acá: lo hace el
// loop de piernas del llamador (metodo.idFondo = puente). No duplicarlo.
export async function EmitirChequePropio(connection, pierna: PiernaPago, ctx: ContextoCheque): Promise<number> {
    const c = pierna.cheque!;
    try {
        const [res] = await connection.query(
            `INSERT INTO cheques_emitidos
                (idEmpresa, idFondoBanco, idProveedor, tipo, numero, importe, fechaEmision, fechaPago, usuarioAlta, observaciones)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                ctx.idEmpresa, c.idFondoBanco, ctx.idProveedor, c.tipo, String(c.numero).trim(), Number(pierna.monto),
                moment(c.fechaEmision).format('YYYY-MM-DD'), moment(c.fechaPago).format('YYYY-MM-DD'),
                ctx.usuario, c.observaciones ? String(c.observaciones).slice(0, 255) : null
            ]
        ) as [ResultSetHeader, any];
        return res.insertId;
    } catch (error: any) {
        if (error?.code === 'ER_DUP_ENTRY') {
            throw new AppError(CodigoError.VALIDACION, `Ya existe un cheque vigente con el número ${String(c.numero).trim()} en esa cuenta.`, 400, { modulo: MODULO, metodo: 'EmitirChequePropio' });
        }
        throw error;
    }
}

// Marca un valor PENDIENTE como ENDOSADO. SELECT ... FOR UPDATE: evita que dos pagos simultáneos endosen el
// mismo cheque, o que se acredite/rechace mientras se endosa. El EGRESO de Valores a Acreditar lo hace el
// loop de piernas del llamador (metodo.idFondo = fondo 10).
export async function EndosarValor(connection, idValor: number, monto: number, ctx: ContextoCheque): Promise<void> {
    const contexto = { modulo: MODULO, metodo: 'EndosarValor', idValor };

    const [rows]: any = await connection.query(
        `SELECT va.id, va.estado, va.tipo, va.idEmpresa, va.monto, ch.numero AS chequeNumero
         FROM valores_acreditar va
         LEFT JOIN cheques ch ON ch.idValor = va.id
         WHERE va.id = ? FOR UPDATE`,
        [idValor]
    );
    if (!rows.length) throw new AppError(CodigoError.NOT_FOUND, 'El cheque a endosar no existe.', 404, contexto);
    const valor = rows[0];
    const nombre = valor.chequeNumero ? `#${valor.chequeNumero}` : `(valor ${valor.id})`;

    if (valor.tipo !== 'CHEQUE') throw new AppError(CodigoError.VALIDACION, `El valor ${nombre} no es un cheque.`, 400, contexto);
    if (valor.estado !== 'PENDIENTE') throw new AppError(CodigoError.VALIDACION, `El cheque ${nombre} no está pendiente (estado: ${valor.estado}).`, 400, contexto);
    if (Number(valor.idEmpresa) !== Number(ctx.idEmpresa)) throw new AppError(CodigoError.VALIDACION, `El cheque ${nombre} pertenece a otra empresa.`, 400, contexto);
    if (Math.abs(Number(valor.monto) - Number(monto)) > TOLERANCIA) throw new AppError(CodigoError.VALIDACION, `El monto del pago no coincide con el importe del cheque ${nombre}.`, 400, contexto);

    const [res] = await connection.query(
        `UPDATE valores_acreditar
         SET estado = 'ENDOSADO', fechaEndoso = NOW(), usuarioEndoso = ?, idProveedorEndoso = ?
         WHERE id = ? AND estado = 'PENDIENTE'`,
        [ctx.usuario, ctx.idProveedor, idValor]
    ) as [ResultSetHeader, any];
    if (res.affectedRows !== 1) throw new AppError(CodigoError.VALIDACION, `El cheque ${nombre} ya no está pendiente.`, 400, contexto);
}
//#endregion

//#region REVERSO (dentro de la transacción del llamador)
// Deshace el instrumento de UNA pierna. El contra-asiento de fondos lo sigue haciendo el loop de reverso
// del llamador. Los throws de acá tienen que correr antes de cualquier escritura del reverso.
export async function RevertirPiernaCheque(
    connection,
    pierna: { tipoMetodo: string; idChequeEmitido?: number | null; idValorAcreditar?: number | null }
): Promise<void> {
    const contexto = { modulo: MODULO, metodo: 'RevertirPiernaCheque', pierna };

    if (pierna.tipoMetodo === 'CHEQUE_PROPIO') {
        if (!pierna.idChequeEmitido) {
            throw new AppError(CodigoError.VALIDACION, 'El pago con cheque propio no tiene cheque asociado. Requiere corrección manual.', 400, contexto);
        }
        const [rows]: any = await connection.query(
            'SELECT id, numero, estado FROM cheques_emitidos WHERE id = ? FOR UPDATE',
            [pierna.idChequeEmitido]
        );
        if (!rows.length) throw new AppError(CodigoError.NOT_FOUND, 'El cheque emitido no existe.', 404, contexto);
        const cheque = rows[0];

        if (cheque.estado === 'DEBITADO') {
            throw new AppError(CodigoError.VALIDACION, `El cheque #${cheque.numero} ya fue debitado del banco, no se puede anular.`, 400, contexto);
        }
        if (cheque.estado !== 'EMITIDO') {
            throw new AppError(CodigoError.VALIDACION, `El cheque #${cheque.numero} ya está anulado.`, 400, contexto);
        }
        await connection.query(
            `UPDATE cheques_emitidos SET estado = 'ANULADO', fechaAnulacion = NOW() WHERE id = ?`,
            [cheque.id]
        );
        return;
    }

    if (pierna.tipoMetodo === 'CHEQUE') {
        // Pago anterior al circuito nuevo (incluye los 14 con el método 82 para cheques propios). Sin este
        // bloqueo, revertirlo reingresaría a Valores a Acreditar plata que la corrección histórica ya corrigió.
        if (!pierna.idValorAcreditar) {
            throw new AppError(CodigoError.VALIDACION, 'Pago con cheque anterior al circuito nuevo, requiere corrección manual.', 400, contexto);
        }
        const [rows]: any = await connection.query(
            'SELECT id, estado FROM valores_acreditar WHERE id = ? FOR UPDATE',
            [pierna.idValorAcreditar]
        );
        if (!rows.length) throw new AppError(CodigoError.NOT_FOUND, 'El cheque endosado no existe.', 404, contexto);
        if (rows[0].estado !== 'ENDOSADO') {
            throw new AppError(CodigoError.VALIDACION, `El cheque endosado (valor ${rows[0].id}) no está en estado Endosado (estado: ${rows[0].estado}).`, 400, contexto);
        }
        await connection.query(
            `UPDATE valores_acreditar
             SET estado = 'PENDIENTE', fechaEndoso = NULL, usuarioEndoso = NULL, idProveedorEndoso = NULL
             WHERE id = ?`,
            [rows[0].id]
        );
    }
}
//#endregion

// LIMIT opcional para la pantalla informativa de Cheques (Administración). Se interpola, así que se fuerza a entero
// acotado; sin límite (Fondos) no agrega nada.
function LimiteFilas(limite: any): string {
    const n = Math.floor(Number(limite));
    return Number.isFinite(n) && n > 0 ? ` LIMIT ${Math.min(n, 2000)}` : '';
}

class ChequesRepository {

    //#region OBTENER
    async ObtenerCheques(filtros: any) {
        const connection = await db.getConnection();

        try {
            const condiciones: string[] = [];
            const params: any[] = [];

            if (filtros?.estado) { condiciones.push('ce.estado = ?'); params.push(filtros.estado); }
            if (filtros?.idEmpresa) { condiciones.push('ce.idEmpresa = ?'); params.push(filtros.idEmpresa); }
            if (filtros?.idFondoBanco) { condiciones.push('ce.idFondoBanco = ?'); params.push(filtros.idFondoBanco); }
            if (filtros?.fechaPagoDesde) { condiciones.push('ce.fechaPago >= ?'); params.push(moment(filtros.fechaPagoDesde).format('YYYY-MM-DD')); }
            if (filtros?.fechaPagoHasta) { condiciones.push('ce.fechaPago <= ?'); params.push(moment(filtros.fechaPagoHasta).format('YYYY-MM-DD')); }

            const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

            const [rows]: any = await connection.query(
                `SELECT ce.id, ce.idEmpresa, ce.idFondoBanco, ce.idProveedor, ce.tipo, ce.numero, ce.importe,
                        ce.fechaEmision, ce.fechaPago, ce.estado, ce.fechaAlta, ce.usuarioAlta,
                        ce.fechaDebito, ce.usuarioDebito, ce.fechaAnulacion, ce.observaciones,
                        p.razonSocial AS proveedor, f.nombre AS banco,
                        DATEDIFF(ce.fechaPago, CURDATE()) AS diasParaPago
                 FROM cheques_emitidos ce
                 LEFT JOIN proveedores p ON p.id = ce.idProveedor
                 LEFT JOIN fondos f ON f.id = ce.idFondoBanco
                 ${where}
                 ORDER BY ce.fechaPago ASC, ce.id ASC${LimiteFilas(filtros?.limite)}`,
                params
            );

            for (const row of rows) {
                row.importe = parseFloat(row.importe);
                row.diasParaPago = Number(row.diasParaPago);
            }
            return rows;

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }
    //#endregion

    //#region ABM
    // El banco recién se mueve acá: emitir el cheque solo comprometió plata en el fondo puente.
    async Debitar(idCheque: any, idCaja: any, usuario: string): Promise<string> {
        const connection = await db.getConnection();
        const contexto = { modulo: MODULO, metodo: 'Debitar', idCheque, idCaja };

        try {
            if (!Number(idCheque)) throw new AppError(CodigoError.VALIDACION, 'Indicá el cheque a debitar.', 400, contexto);
            if (!Number(idCaja)) throw new AppError(CodigoError.VALIDACION, 'Indicá la caja desde la que se debita.', 400, contexto);

            await connection.beginTransaction();

            const [rows]: any = await connection.query(
                'SELECT id, idEmpresa, idFondoBanco, numero, importe, estado FROM cheques_emitidos WHERE id = ? FOR UPDATE',
                [idCheque]
            );
            if (!rows.length) throw new AppError(CodigoError.NOT_FOUND, 'El cheque no existe.', 404, contexto);
            const cheque = rows[0];

            if (cheque.estado === 'DEBITADO') throw new AppError(CodigoError.VALIDACION, `El cheque #${cheque.numero} ya fue debitado.`, 400, contexto);
            if (cheque.estado === 'ANULADO') throw new AppError(CodigoError.VALIDACION, `El cheque #${cheque.numero} está anulado.`, 400, contexto);

            const [puente]: any = await connection.query("SELECT id FROM fondos WHERE tipo = 'CHEQUE_EMITIDO' AND activo = 1");
            if (!puente.length) throw new Error("Fondo puente de tipo 'CHEQUE_EMITIDO' no encontrado.");

            // Egreso del banco + ingreso del puente (lo que compromete el puente al emitir se libera al debitar).
            // Se insertan acá, en esta transacción: FondosRepo.CrearTransferencia abre su propia conexión.
            const base = {
                idCaja: Number(idCaja), idEmpresa: cheque.idEmpresa, origen: 'DEBITO_CHEQUE_PROPIO',
                idReferencia: cheque.id, tipoReferencia: 'CHEQUE_EMITIDO', monto: Number(cheque.importe), usuario
            };
            await InsertMovimientoFondo(connection, {
                ...base, idFondo: cheque.idFondoBanco, tipo: 'EGRESO',
                descripcion: `Débito de cheque propio #${cheque.numero}`
            });
            await InsertMovimientoFondo(connection, {
                ...base, idFondo: puente[0].id, tipo: 'INGRESO',
                descripcion: `Débito de cheque propio #${cheque.numero}`
            });

            await connection.query(
                `UPDATE cheques_emitidos SET estado = 'DEBITADO', fechaDebito = NOW(), usuarioDebito = ? WHERE id = ?`,
                [usuario, cheque.id]
            );

            await connection.commit();
            return "OK";

        } catch (error: any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
    //#endregion
}

// Copia local, mismo SQL que comprasRepository/comprasCuentasRepository. No se importa de ahí para no crear
// una dependencia circular (ellos importan este archivo). Deuda: extraer las tres copias a un util compartido.
async function InsertMovimientoFondo(connection, movimiento): Promise<void> {
    await connection.query(
        `INSERT INTO movimientos_fondos
            (idCaja, idFondo, tipo, origen, idEmpresa, idReferencia, tipoReferencia, monto, descripcion, usuario)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            movimiento.idCaja, movimiento.idFondo, movimiento.tipo, movimiento.origen,
            movimiento.idEmpresa ?? null, movimiento.idReferencia ?? null, movimiento.tipoReferencia ?? null,
            movimiento.monto, movimiento.descripcion ?? null, movimiento.usuario ?? null
        ]
    );
}

export const ChequesRepo = new ChequesRepository();
