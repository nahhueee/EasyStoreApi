/**
 * IDs internos de procesos de venta (tabla `procesos_venta`).
 * Deben coincidir con ID_PROCESO en el front (venta.constants.ts).
 */
export enum IdProceso {
    FACTURA = 1,
    COTIZACION = 2,
    NOTA_CREDITO = 3,
    NOTA_DEBITO = 4,
    PRESUPUESTO = 5,
    PEDIDO = 6,
    NOTA_EMPAQUE = 7,
}

/**
 * Strings que identifican el tipo de proceso relacionado a una venta
 * (columna `tipoRelacionado`). Se persisten en BD, no cambiar los valores
 * sin migración. Deben coincidir con TIPO_RELACIONADO en el front
 * (venta.constants.ts).
 */
export enum TipoRelacionado {
    PRESUPUESTO = "PRESUPUESTO",
    PEDIDO = "PEDIDO",
    NOTA_EMPAQUE = "NOTA DE EMPAQUE",
}

/**
 * Estados posibles de una venta (columna `estado`). Deben coincidir con
 * ESTADO_VENTA en el front (venta.constants.ts).
 */
export enum EstadoVenta {
    APROBADO = "Aprobado",
    APROBADA = "Aprobada",
    PENDIENTE = "Pendiente",
    FINALIZADA = "Finalizada",

    ASOCIADO = "Asociado",
    ASOCIADA = "Asociada",
    // Estado de cierre exclusivo del Presupuesto: a diferencia de Pedido/Nota
    // de Empaque, el Presupuesto no tiene un estado "Facturado" propio (no es
    // un documento que se facture) - una vez usado para cualquier cosa
    // (armar un Pedido/Nota, o facturarlo directo) queda en RELACIONADO.
    RELACIONADO = "Relacionado",

    FACTURADO = "Facturado",
    FACTURADA = "Facturada",
}

/**
 * A qué proceso destino (idProceso) apunta cada tipoRelacionado, y qué
 * estado toma ese relacionado mientras está "en uso" (todavía no cerrado
 * por una Factura/Cotización).
 */
export const RELACION_PROCESO: Record<TipoRelacionado, { idProceso: IdProceso; estadoUso: EstadoVenta }> = {
    [TipoRelacionado.PRESUPUESTO]:  { idProceso: IdProceso.PRESUPUESTO,  estadoUso: EstadoVenta.RELACIONADO },
    [TipoRelacionado.PEDIDO]:       { idProceso: IdProceso.PEDIDO,       estadoUso: EstadoVenta.ASOCIADO },
    [TipoRelacionado.NOTA_EMPAQUE]: { idProceso: IdProceso.NOTA_EMPAQUE, estadoUso: EstadoVenta.ASOCIADA },
};

/**
 * Estado final del relacionado cuando la venta que lo referencia es un
 * cierre (Factura o Cotización). El Presupuesto no aparece acá a propósito:
 * ver comentario de RELACIONADO en EstadoVenta.
 */
export const RELACION_CIERRE: Partial<Record<TipoRelacionado, EstadoVenta>> = {
    [TipoRelacionado.PEDIDO]:       EstadoVenta.FACTURADO,
    [TipoRelacionado.NOTA_EMPAQUE]: EstadoVenta.FACTURADA,
};

/**
 * Una venta "cierra el circuito" de un relacionado cuando ella misma es una
 * Factura o una Cotización (ambas pueden generarse con o sin comprobante
 * AFIP real - la Cotización nunca tiene datos de AFIP, por eso este chequeo
 * NO debe basarse en si `venta.factura` vino cargado).
 */
export function esProcesoDeCierre(idProceso?: number): boolean {
    return idProceso === IdProceso.FACTURA || idProceso === IdProceso.COTIZACION;
}

/**
 * Estado final que debe tomar el relacionado (nroRelacionado/tipoRelacionado)
 * de una venta al guardarse.
 */
export function ResolverEstadoRelacionado(idProcesoVenta?: number, tipoRelacionado?: string):
    { idProceso: IdProceso; estado: EstadoVenta } | null {

    const relacion = RELACION_PROCESO[tipoRelacionado as TipoRelacionado];
    if (!relacion) return null;

    const estadoCierre = esProcesoDeCierre(idProcesoVenta)
        ? RELACION_CIERRE[tipoRelacionado as TipoRelacionado]
        : undefined;

    return {
        idProceso: relacion.idProceso,
        estado: estadoCierre ?? relacion.estadoUso,
    };
}

/**
 * Estados "abiertos" (todavía no usados/cerrados) en los que se permite dar de
 * baja un Presupuesto/Pedido/Nota de Empaque (decisión 19/07/2026). Una vez
 * que el proceso queda Asociado/Relacionado (usado por otro documento) o
 * Facturado/Facturada (cerrado), no se puede dar de baja - dejaría una
 * referencia (nroRelacionado/tipoRelacionado) apuntando a algo inexistente.
 * Factura/Cotización/NC/ND quedan afuera a propósito: no aplica esta baja.
 */
export const ESTADOS_ABIERTOS_BAJA: Partial<Record<IdProceso, EstadoVenta[]>> = {
    [IdProceso.PRESUPUESTO]:  [EstadoVenta.APROBADO],
    [IdProceso.PEDIDO]:       [EstadoVenta.APROBADO],
    [IdProceso.NOTA_EMPAQUE]: [EstadoVenta.PENDIENTE, EstadoVenta.APROBADA],
};

export function puedeDarseDeBaja(idProceso?: number, estado?: string): boolean {
    const estadosAbiertos = ESTADOS_ABIERTOS_BAJA[idProceso as IdProceso];
    if (!estadosAbiertos) return false;
    return estadosAbiertos.includes(estado as EstadoVenta);
}
