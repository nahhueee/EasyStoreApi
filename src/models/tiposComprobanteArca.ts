import { TipoComprobante } from './objFacturar';

/**
 * Metadata de cada código de comprobante ARCA para el Libro IVA (Ventas y Compras).
 * Espejo de TipoComprobante (objFacturar.ts) - no se duplican los códigos, solo se
 * agrega lo que el libro necesita: descripción larga, letra y signo.
 *
 * Decisión de signo: solo las Notas de Crédito restan (signo -1). Facturas y Notas
 * de Débito suman (signo 1). El signo se aplica de forma coherente a Grabado, IVA
 * y Total - las tres columnas, nunca una sola.
 *
 * Fuera del universo del libro: COTIZACION (99), NC_X (100) y ND_X (101) son
 * comprobantes internos que no pasan por ARCA y nunca tienen fila en
 * ventas_factura (ver el INNER JOIN en librosIvaRepository.ts) - por eso no
 * están en este mapa. Si algún día hace falta resolverlos igual, agregarlos acá
 * en vez de armar un mapa aparte.
 */
export const TIPOS_COMPROBANTE_ARCA: Record<number, { descripcion: string; letra: string; signo: number; esNota: boolean }> = {
    [TipoComprobante.FACTURA_A]: { descripcion: 'FACTURA A',         letra: 'A', signo:  1, esNota: false },
    [TipoComprobante.ND_A]:      { descripcion: 'NOTA DE DEBITO A',  letra: 'A', signo:  1, esNota: true  },
    [TipoComprobante.NC_A]:      { descripcion: 'NOTA DE CREDITO A', letra: 'A', signo: -1, esNota: true  },

    [TipoComprobante.FACTURA_B]: { descripcion: 'FACTURA B',         letra: 'B', signo:  1, esNota: false },
    [TipoComprobante.ND_B]:      { descripcion: 'NOTA DE DEBITO B',  letra: 'B', signo:  1, esNota: true  },
    [TipoComprobante.NC_B]:      { descripcion: 'NOTA DE CREDITO B', letra: 'B', signo: -1, esNota: true  },

    [TipoComprobante.FACTURA_C]: { descripcion: 'FACTURA C',         letra: 'C', signo:  1, esNota: false },
    [TipoComprobante.ND_C]:      { descripcion: 'NOTA DE DEBITO C',  letra: 'C', signo:  1, esNota: true  },
    [TipoComprobante.NC_C]:      { descripcion: 'NOTA DE CREDITO C', letra: 'C', signo: -1, esNota: true  },
};
