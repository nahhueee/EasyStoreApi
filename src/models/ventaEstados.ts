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
 * Origen del `idProducto` de cada línea de `ventas_productos` (columna `tipoItem`).
 * Se persiste en BD, no cambiar los valores sin migración. Debe coincidir con
 * TIPO_ITEM en el front (venta.constants.ts).
 *
 * `idProducto` es una FK polimórfica: sin este discriminador la única forma de
 * saber contra qué tabla resolverla era mirar `ventas.idProceso`, heurística que
 * se rompía al facturar un Presupuesto (la venta deja de ser presupuesto pero las
 * líneas siguen apuntando a `productos_presupuesto`). Ver migración
 * 20260801120000_add_tipoitem_ventas_productos.
 *
 * PRESUPUESTO = ítem no catalogado: no mueve stock y no tiene talles ni color. El
 * descuento general de la venta SÍ le aplica (se resuelve en el front, ver
 * TopeDescuentoDe en addmod-ventas; acá solo se persiste el importeDescuento ya
 * calculado).
 */
export enum TipoItemVenta {
    CATALOGO = "CATALOGO",
    PRESUPUESTO = "PRESUPUESTO",
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
    // Estado "en uso" del Presupuesto cuando se usó para armar un Pedido o una
    // Nota de Empaque (circuito abierto en otro documento, todavía no hay
    // comprobante ni cobro). Si en cambio el Presupuesto se factura directo
    // (Factura/Cotización), el cierre es real y pasa a FACTURADO (ver
    // RELACION_CIERRE) - ago-2026, antes los dos casos quedaban mezclados acá.
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
    // Presupuesto facturado directo (sin pasar por Pedido/Nota de Empaque): el
    // circuito cierra con comprobante y cobro, igual que los otros dos. Antes
    // caía a RELACIONADO (ver comentario de EstadoVenta.RELACIONADO), que mezclaba
    // "se usó para armar un Pedido" con "se facturó" - ago-2026.
    [TipoRelacionado.PRESUPUESTO]:  EstadoVenta.FACTURADO,
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

/**
 * Fragmento SQL para el nombre visible de un método de pago. Requiere que la
 * query tenga aliasados `mp` (metodos_pago) y `f` (fondos, vía
 * `LEFT JOIN fondos f ON f.id = mp.idFondo`).
 *
 * Extraído como constante compartida (B4-217, sep-2026 - ver
 * HANDOFF-informes-administracion-R1.md §3.6). Antes vivía duplicado e
 * idéntico en VentasRepository.ObtenerReporteAcumulado y
 * VentasRepository.ObtenerPagosVenta, mientras que
 * VentasRepository.ObtenerReporteVentas (columna "Métodos de pago" del informe
 * de ventas actual) mostraba en cambio `mp.nombre` crudo, sin este armado - el
 * mismo pago salía con dos nombres distintos según qué informe se mirara. Toda
 * query nueva que necesite mostrar el método de pago (ej.
 * conciliacionRepository.ts) debe reusar esta constante para no reabrir la
 * inconsistencia.
 */
export const SQL_METODO_PAGO_CASE = `
    CASE
        WHEN mp.tipo = 'CREDITO' THEN CONCAT(f.nombre, ' - Crédito')
        WHEN mp.tipo = 'DEBITO' THEN CONCAT(f.nombre, ' - Débito')
        WHEN mp.tipo = 'TRANSFERENCIA' THEN CONCAT(f.nombre, ' - Transferencia')
        ELSE mp.nombre
    END
`;
