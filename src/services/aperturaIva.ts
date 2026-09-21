/**
 * Apertura de IVA por alícuota, compartida entre los informes de Ventas para
 * Conciliación (R1, excelConciliacionService.ts) y el Libro IVA Ventas
 * (excelLibroIvaService.ts) - HANDOFF-apertura-iva-R1.md y HANDOFF-apertura-
 * iva-libro-iva-ventas.md.
 *
 * Es una función pura de reparto, NO de cálculo: toma el neto/IVA que el
 * comprobante ya tiene persistido (vf.neto/vf.iva, la fuente de verdad fiscal)
 * y lo ubica en la columna de alícuota que corresponde. Nunca deriva un
 * porcentaje ni recalcula neto o IVA - si algún día existe la multi-alícuota
 * real (tabla ventas_iva), este es el único lugar que hay que tocar para que
 * los dos informes la hereden.
 *
 * Vacío (null), no cero, cuando el concepto no aplica al comprobante (no es
 * fiscal, o el facturante es Monotributista y no discrimina IVA). Cero solo
 * cuando es una afirmación verdadera: hoy el 100% de lo facturado por un
 * Responsable Inscripto es al 21%, así que "10,5%: $0" significa "no hubo
 * operaciones a esa alícuota", no "no se sabe".
 */

export interface ComprobanteParaAperturaIva {
    /** true si el comprobante tiene fila en ventas_factura (pasó por ARCA). */
    esFiscal: boolean;
    /** empresas.condicion del facturante, tal cual está en la base. */
    condicionFacturante: string | null | undefined;
    /** vf.neto - null/undefined si no hay dato. */
    neto: number | string | null | undefined;
    /** vf.iva - null/undefined si no hay dato. */
    iva: number | string | null | undefined;
}

export interface AperturaIva {
    netoGravado21: number | null;
    iva21: number | null;
    netoGravado105: number | null;
    iva105: number | null;
    noGravadoExento: number | null;
}

export const CONDICION_RESPONSABLE_INSCRIPTO = 'Responsable Inscripto';

export function aperturaIva(comprobante: ComprobanteParaAperturaIva): AperturaIva {
    const esRIFacturante = comprobante.condicionFacturante === CONDICION_RESPONSABLE_INSCRIPTO;
    const aplica = esRIFacturante && comprobante.esFiscal;

    if (!aplica) {
        return {
            netoGravado21: null,
            iva21: null,
            netoGravado105: null,
            iva105: null,
            noGravadoExento: null,
        };
    }

    return {
        netoGravado21: Number(comprobante.neto) || 0,
        iva21: Number(comprobante.iva) || 0,
        // 10,5% y "No gravado/exento" en 0, no vacío, cuando aplica: el sistema
        // hoy emite todo a una sola alícuota (verificado contra toda la base,
        // ratio iva/neto siempre 0,2100 o 0,0000) - no es que falte el dato.
        netoGravado105: 0,
        iva105: 0,
        noGravadoExento: 0,
    };
}
