// Adelantos de producción vinculados a una Nota de Empaque (oct-2026, fase F2).
// Ver migración 20261030120000_add_ventas_adelantos. Acá viven el criterio único de "qué es una
// factura de adelanto", la consulta de adelantos disponibles y el guardado transaccional del
// vínculo (corre dentro de la misma transacción que el Agregar/Modificar de la NE).
import { PoolConnection } from 'mysql2/promise';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { IdProceso, MOTIVOS_SIN_PRODUCTOS, TipoItemVenta } from '../models/ventaEstados';
import { AdelantoVenta, Venta } from '../models/Venta';

// NC fiscales A/B/C (ver TipoComprobante en ObjFacturar.ts). Una NC interna (X) no anula la factura.
const COMPROBANTES_NC_FISCAL = [3, 8, 13];

// Cota superior solo de sanidad (ver GuardarAdelantosNE): el saldo EXACTO depende de la base del
// total de la NE (neto o con IVA según lista/comprobante) y lo valida la facturación por saldo (F3).
const COTA_SANIDAD_TOTAL_NE = 1.21;

// Criterio ÚNICO de "factura de adelanto" (alias `v` = ventas): Factura fiscal ya emitida, con
// UNA sola línea no catalogada y sin servicios (así la deja el check "Sin productos o servicios"
// de addmod-ventas), con uno de los motivos fijos, sin baja y sin NC fiscal asociada.
// Los `?` son los motivos: pasar [...MOTIVOS_SIN_PRODUCTOS] al final de los parámetros de su posición.
const SQL_ES_ADELANTO = `
    v.idProceso = ${IdProceso.FACTURA}
    AND v.fechaBaja IS NULL
    AND v.observacion IN (${MOTIVOS_SIN_PRODUCTOS.map(() => '?').join(', ')})
    AND EXISTS (SELECT 1 FROM ventas_factura vf0 WHERE vf0.idVenta = v.id)
    AND (SELECT COUNT(*) FROM ventas_productos vp WHERE vp.idVenta = v.id) = 1
    AND (SELECT COUNT(*) FROM ventas_productos vp WHERE vp.idVenta = v.id AND vp.tipoItem = '${TipoItemVenta.PRESUPUESTO}') = 1
    AND NOT EXISTS (SELECT 1 FROM ventas_servicios vs WHERE vs.idVenta = v.id)
    AND NOT EXISTS (
        SELECT 1 FROM ventas nc
        WHERE nc.idProceso = ${IdProceso.NOTA_CREDITO}
          AND nc.nroRelacionado = v.nroProceso
          AND nc.tipoRelacionado = (SELECT pv.descripcion FROM procesos_venta pv WHERE pv.id = v.idProceso)
          AND nc.idTComprobante IN (${COMPROBANTES_NC_FISCAL.join(', ')})
    )`;

function mapear(row: any): AdelantoVenta {
    const a = new AdelantoVenta();
    a.idFactura = row['idFactura'];
    a.nroProceso = row['nroProceso'];
    a.fecha = row['fecha'] ?? undefined;
    a.motivo = row['motivo'] ?? undefined;
    a.total = parseFloat(row['total']);
    a.neto = parseFloat(row['neto']);
    a.iva = parseFloat(row['iva']);
    a.idEmpresa = row['idEmpresa'] ?? undefined;
    a.empresa = row['empresa'] ?? undefined;
    a.tipoFactura = row['tipoFactura'] ?? undefined;
    a.ptoVenta = row['ptoVenta'] ?? undefined;
    a.ticket = row['ticket'] ?? undefined;
    return a;
}

// Adelantos que se pueden vincular a una NE del cliente: los todavía libres y, si se está
// editando una NE (idNE), también los ya vinculados a ella (para poder mostrarlos tildados).
export async function AdelantosDisponibles(connection: PoolConnection, idCliente: number, idNE?: number): Promise<AdelantoVenta[]> {
    const [rows]: any = await connection.query(
        `SELECT v.id AS idFactura, v.nroProceso, v.fecha, v.total, v.observacion AS motivo, v.idEmpresa,
                e.razonSocial AS empresa, vf.tipoFactura, vf.ptoVenta, vf.ticket, vf.neto, vf.iva
         FROM ventas v
         INNER JOIN ventas_factura vf ON vf.idVenta = v.id
         LEFT JOIN empresas e ON e.id = v.idEmpresa
         LEFT JOIN ventas_adelantos a ON a.idFactura = v.id
         WHERE v.idCliente = ?
           AND (a.idNE IS NULL OR a.idNE = ?)
           AND ${SQL_ES_ADELANTO}
         ORDER BY v.fecha DESC, v.id DESC`,
        [idCliente, idNE ?? 0, ...MOTIVOS_SIN_PRODUCTOS]
    );
    return (rows as any[]).map(mapear);
}

// Adelantos ya vinculados a una NE, con el snapshot guardado al vincular.
export async function AdelantosDeNE(connection: PoolConnection, idNE: number): Promise<AdelantoVenta[]> {
    const [rows]: any = await connection.query(
        `SELECT a.idFactura, v.nroProceso, v.fecha, a.total, v.observacion AS motivo, v.idEmpresa,
                e.razonSocial AS empresa, vf.tipoFactura, vf.ptoVenta, vf.ticket, a.neto, a.iva
         FROM ventas_adelantos a
         INNER JOIN ventas v ON v.id = a.idFactura
         LEFT JOIN ventas_factura vf ON vf.idVenta = v.id
         LEFT JOIN empresas e ON e.id = v.idEmpresa
         WHERE a.idNE = ?
         ORDER BY a.id`,
        [idNE]
    );
    return (rows as any[]).map(mapear);
}

// Adelantos de la NE a la que se relaciona una Factura (por nro de proceso de la NE). Los usa la
// Factura final para mostrar "Adelanto s/ Fact. ..." en el resumen del comprobante.
export async function AdelantosDeNEPorNro(connection: PoolConnection, nroNE: number): Promise<AdelantoVenta[]> {
    const [notas]: any = await connection.query(
        `SELECT id FROM ventas WHERE idProceso = ${IdProceso.NOTA_EMPAQUE} AND nroProceso = ? AND fechaBaja IS NULL ORDER BY id DESC LIMIT 1`,
        [nroNE]
    );
    if (!Array.isArray(notas) || notas.length === 0) return [];
    return AdelantosDeNE(connection, notas[0].id);
}

// Una NC (fiscal o X) sobre una factura de adelanto vinculada a una NE se bloquea: el adelanto
// está aplicado a esa NE y anularlo dejaría la NE y la factura final inconsistentes. Para
// anularlo hay que desvincularlo antes de la NE (solo posible mientras la NE no está facturada).
export async function ValidarNotaCreditoSobreAdelanto(connection: PoolConnection, venta: Venta): Promise<string | null> {
    if (venta.idProceso !== IdProceso.NOTA_CREDITO || !venta.nroRelacionado) return null;
    const [rows]: any = await connection.query(
        `SELECT ne.nroProceso AS nroNE
         FROM ventas v
         INNER JOIN ventas_adelantos a ON a.idFactura = v.id
         INNER JOIN ventas ne ON ne.id = a.idNE
         WHERE v.idProceso = ${IdProceso.FACTURA}
           AND v.nroProceso = ?
           AND (SELECT pv.descripcion FROM procesos_venta pv WHERE pv.id = v.idProceso) = ?
         LIMIT 1`,
        [venta.nroRelacionado, venta.tipoRelacionado ?? '']
    );
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return `La factura Nro ${venta.nroRelacionado} es un adelanto vinculado a la nota de empaque Nro ${rows[0].nroNE}: no se le puede emitir una nota de crédito. Primero desvinculala de la nota de empaque.`;
}

function error(mensaje: string, idNE?: number): AppError {
    return new AppError(CodigoError.VALIDACION, mensaje, 409, { modulo: 'VentasAdelantos', metodo: 'GuardarAdelantosNE', idNE });
}

// Reemplaza los adelantos vinculados a la NE por los de `venta.adelantos` (solo se usa `idFactura`).
// Corre DENTRO de la transacción del Agregar/Modificar de la NE (la validación real: el front solo
// ofrece los candidatos válidos, pero el POST se puede armar a mano). Si `venta.adelantos` no viene
// definido (cliente viejo) no toca nada; un array vacío desvincula todo.
export async function GuardarAdelantosNE(connection: PoolConnection, venta: Venta, usuario?: string): Promise<void> {
    if (!Array.isArray(venta.adelantos)) return;

    const idNE = venta.id!;
    const ids = [...new Set(venta.adelantos.map(a => Number(a?.idFactura)).filter(n => Number.isInteger(n) && n > 0))];

    if (ids.length === 0) {
        await connection.query("DELETE FROM ventas_adelantos WHERE idNE = ?", [idNE]);
        return;
    }

    const [filas]: any = await connection.query(
        `SELECT v.id, v.idCliente, v.idEmpresa, v.total, v.nroProceso, vf.tipoFactura, vf.neto, vf.iva, a.idNE AS idNEVinculada
         FROM ventas v
         INNER JOIN ventas_factura vf ON vf.idVenta = v.id
         LEFT JOIN ventas_adelantos a ON a.idFactura = v.id
         WHERE v.id IN (?) AND ${SQL_ES_ADELANTO}
         FOR UPDATE`,
        [ids, ...MOTIVOS_SIN_PRODUCTOS]
    );

    if ((filas as any[]).length !== ids.length)
        throw error('Alguno de los adelantos seleccionados ya no está disponible (no es una factura sin productos válida, tiene una nota de crédito fiscal o no existe). Actualizá la lista y volvé a elegir.', idNE);

    for (const f of filas as any[]) {
        if (Number(f.idCliente) !== Number(venta.cliente?.id ?? 0))
            throw error(`El adelanto ${f.nroProceso} pertenece a otro cliente: una nota de empaque solo puede vincular adelantos de su mismo cliente.`, idNE);
        if (f.idNEVinculada != null && Number(f.idNEVinculada) !== Number(idNE))
            throw error(`El adelanto ${f.nroProceso} ya está vinculado a otra nota de empaque.`, idNE);
    }

    // Todos los adelantos de una NE tienen que ser de la misma empresa y el mismo tipo de comprobante:
    // la factura que cancela el saldo se emite con esos mismos datos (decisión de negocio, 29-oct-2026).
    const empresas = new Set((filas as any[]).map(f => Number(f.idEmpresa)));
    const tipos = new Set((filas as any[]).map(f => Number(f.tipoFactura)));
    if (empresas.size > 1 || tipos.size > 1)
        throw error('Los adelantos de una nota de empaque tienen que ser de la misma empresa y del mismo tipo de comprobante.', idNE);

    const totalAdelantos = (filas as any[]).reduce((acc, f) => acc + Number(f.total), 0);
    if (venta.total != null && totalAdelantos > Number(venta.total) * COTA_SANIDAD_TOTAL_NE + 0.01)
        throw error('Los adelantos vinculados superan el total de la nota de empaque.', idNE);

    await connection.query("DELETE FROM ventas_adelantos WHERE idNE = ? AND idFactura NOT IN (?)", [idNE, ids]);

    for (const f of filas as any[]) {
        if (f.idNEVinculada != null) continue; // ya vinculado a esta NE: se conserva su auditoría
        try {
            await connection.query(
                "INSERT INTO ventas_adelantos (idNE, idFactura, total, neto, iva, usuario) VALUES (?, ?, ?, ?, ?, ?)",
                [idNE, f.id, f.total, f.neto, f.iva, usuario ?? null]
            );
        } catch (e: any) {
            if (e?.code === 'ER_DUP_ENTRY')
                throw error(`El adelanto ${f.nroProceso} acaba de ser vinculado a otra nota de empaque.`, idNE);
            throw e;
        }
    }
}
