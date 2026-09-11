import ExcelJS from 'exceljs';
import { TIPOS_COMPROBANTE_ARCA } from '../models/tiposComprobanteArca';
const moment = require('moment');

/**
 * Excel del Libro IVA Ventas: 3 hojas (Libro IVA Ventas, Control correlatividad,
 * Fuera del libro). Ver HANDOFF-libro-iva-ventas-y-compras.md, Fase 1 Paso 3,
 * para el diseño completo y el porqué de cada hoja.
 *
 * `libro` viene de LibrosIvaRepo.ObtenerLibroIvaVentas(), `correlatividad` de
 * ObtenerCorrelatividadVentas() y `excluidos` de ObtenerExcluidosDelLibro().
 */
export async function crearExcelLibroIvaVentas(libro: any[], correlatividad: any[], excluidos: any[]) {
  const workbook = new ExcelJS.Workbook();

  // =========================
  // HOJA 1: LIBRO IVA VENTAS
  // =========================
  const sheet1 = workbook.addWorksheet('Libro IVA Ventas');

  sheet1.columns = [
    { header: 'Fecha', key: 'fecha', width: 14 },
    { header: 'Tipo', key: 'tipo', width: 20 },
    { header: 'Cod. Tipo Cbte.', key: 'codTipoCbte', width: 15 },
    { header: 'Pto. Vta.', key: 'ptoVenta', width: 12 },
    { header: 'Comprobante', key: 'comprobante', width: 15 },
    { header: 'Tipo Doc.', key: 'tipoDoc', width: 16 },
    { header: 'Cod. Tipo Doc.', key: 'codTipoDoc', width: 14 },
    { header: 'CUIT', key: 'cuit', width: 18 },
    { header: 'Razon social', key: 'razonSocial', width: 35 },
    { header: 'Cond. IVA', key: 'condIva', width: 22 },
    { header: 'Gravado', key: 'grabado', width: 15 },
    { header: 'Tasa', key: 'tasa', width: 8 },
    { header: 'IVA', key: 'iva', width: 15 },
    { header: 'Total', key: 'total', width: 15 },
    { header: 'CAE', key: 'cae', width: 18 },
    { header: 'Vto. CAE', key: 'caeVto', width: 14 },
    { header: 'Estado', key: 'estado', width: 12 },
    { header: 'Comp. asociado', key: 'compAsociado', width: 18 },
    { header: 'Observación', key: 'observacion', width: 40 },
  ];

  libro.forEach(r => {
    const meta = TIPOS_COMPROBANTE_ARCA[r.tipoFactura];
    // Sin metadata conocida (código ARCA nuevo/no contemplado): no se descarta la
    // fila, se muestra igual con signo +1 y se marca en Observación - un comprobante
    // real no puede desaparecer del libro por un mapeo desactualizado.
    const signo = meta?.signo ?? 1;
    const esNota = meta?.esNota ?? false;

    const neto = Number(r.neto);
    const iva = Number(r.iva);
    const total = Number(r.total);

    const fila = sheet1.addRow({
      fecha: moment.utc(r.fecha).startOf('day').toDate(),
      tipo: meta?.descripcion ?? `TIPO ${r.tipoFactura} (SIN MAPEAR)`,
      codTipoCbte: r.tipoFactura,
      ptoVenta: String(r.ptoVenta ?? '').padStart(5, '0'),
      comprobante: r.ticket,
      tipoDoc: descripcionTipoDoc(r.tipoDni),
      codTipoDoc: r.tipoDni ?? '',
      cuit: formatearDocumento(r.dni),
      razonSocial: r.razonSocial,
      condIva: r.condicionIva,
      grabado: neto * signo,
      tasa: 21,
      iva: iva * signo,
      total: total * signo,
      cae: r.cae != null ? String(r.cae) : '',
      caeVto: r.caeVto ? moment.utc(r.caeVto).startOf('day').toDate() : null,
      estado: r.fechaBaja ? 'Anulado' : 'Emitido',
      compAsociado: esNota && r.ticketRelacionado
        ? `${r.tipoRelacionado}-${String(r.ptoVentaRelacionado ?? '').padStart(5, '0')}-${r.ticketRelacionado}`
        : '',
      observacion: armarObservacion(r, meta, neto, iva, total, esNota),
    });

    fila.getCell('fecha').numFmt = 'dd/mm/yyyy';
    fila.getCell('cuit').numFmt = '@';
    if (r.caeVto) fila.getCell('caeVto').numFmt = 'dd/mm/yyyy';
  });

  sheet1.autoFilter = { from: 'A1', to: 'S1' };

  // Fila TOTAL sobre Gravado (K), IVA (M) y Total (N). Mismo guard de referencia
  // circular que excelVentasService: sin filas de datos, SUM(K2:K1) se normaliza
  // a K1:K2 e incluye la fila de totales - se pone 0 literal en ese caso.
  const lastDataRow1 = sheet1.rowCount;
  const totalRow1 = lastDataRow1 + 1;

  sheet1.getCell(`A${totalRow1}`).value = 'TOTAL';
  for (const col of ['K', 'M', 'N']) {
    sheet1.getCell(`${col}${totalRow1}`).value = libro.length > 0
      ? { formula: `SUM(${col}2:${col}${lastDataRow1})` }
      : 0;
    sheet1.getCell(`${col}${totalRow1}`).numFmt = '$ #,##0.00';
  }
  sheet1.getRow(totalRow1).font = { bold: true };

  // =========================
  // HOJA 2: CONTROL CORRELATIVIDAD
  // =========================
  const sheet2 = workbook.addWorksheet('Control correlatividad');

  sheet2.columns = [
    { header: 'Tipo', key: 'tipo', width: 20 },
    { header: 'Pto. Vta.', key: 'ptoVenta', width: 12 },
    { header: 'Último del período anterior', key: 'ultimoAnterior', width: 24 },
    { header: 'Desde', key: 'desde', width: 12 },
    { header: 'Hasta', key: 'hasta', width: 12 },
    { header: 'Emitidos', key: 'emitidos', width: 12 },
    { header: 'Esperados', key: 'esperados', width: 12 },
    { header: 'Faltantes', key: 'faltantes', width: 40 },
  ];

  correlatividad.forEach(r => {
    const fila = sheet2.addRow({
      tipo: TIPOS_COMPROBANTE_ARCA[r.tipoFactura]?.descripcion ?? `TIPO ${r.tipoFactura}`,
      ptoVenta: String(r.ptoVenta ?? '').padStart(5, '0'),
      ultimoAnterior: r.ultimoPeriodoAnterior ?? 'N/D (primer comprobante del par)',
      desde: r.desde,
      hasta: r.hasta,
      emitidos: r.emitidos,
      esperados: r.esperados,
      faltantes: r.faltantes.length > 0
        ? r.faltantes.join(', ') + (r.saltoRespectoPeriodoAnterior ? ' (incluye salto contra el período anterior)' : '')
        : '-',
    });

    // Fila con faltantes: fondo rojo suave para que salte a la vista.
    if (r.faltantes.length > 0) {
      fila.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4E4' } };
      });
    }
  });

  sheet2.autoFilter = { from: 'A1', to: 'H1' };

  // =========================
  // HOJA 3: FUERA DEL LIBRO (CONCILIACIÓN)
  // =========================
  const sheet3 = workbook.addWorksheet('Fuera del libro');

  sheet3.mergeCells('A1:E1');
  sheet3.getCell('A1').value =
    'Comprobantes internos (Cotización, NC X, ND X) que impactan las ventas del negocio pero no son fiscales - no pasan por ARCA y no tienen CAE. ' +
    'Por eso el total de esta hoja, sumado al total del Libro IVA Ventas, explica la diferencia contra el reporte de ventas del mismo período.';
  sheet3.getCell('A1').alignment = { wrapText: true, vertical: 'middle' };
  sheet3.getCell('A1').font = { italic: true };
  sheet3.getRow(1).height = 45;

  const headerRow3 = sheet3.getRow(2);
  headerRow3.values = ['Proceso', 'N° Proceso', 'Fecha', 'Cliente', 'Total'];
  sheet3.getColumn(1).width = 18;
  sheet3.getColumn(2).width = 15;
  sheet3.getColumn(3).width = 18;
  sheet3.getColumn(4).width = 35;
  sheet3.getColumn(5).width = 15;

  excluidos.forEach(r => {
    sheet3.addRow([
      r.proceso,
      r.nroProceso,
      moment.utc(r.fecha).format('DD/MM/YYYY'),
      r.razonSocial,
      Number(r.total),
    ]);
  });

  sheet3.getColumn(5).numFmt = '$ #,##0.00';
  sheet3.autoFilter = { from: 'A2', to: 'E2' };
  sheet3.views = [{ state: 'frozen', ySplit: 2 }];

  // =========================
  // ESTILO GENERAL (encabezados)
  // =========================
  [[sheet1, 1], [sheet2, 1], [sheet3, 2]].forEach(([sheet, headerRowIndex]: any) => {
    const headerRow = sheet.getRow(headerRowIndex);

    headerRow.eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
  });

  sheet1.views = [{ state: 'frozen', ySplit: 1 }];
  sheet2.views = [{ state: 'frozen', ySplit: 1 }];

  sheet1.getColumn('grabado').numFmt = '$ #,##0.00';
  sheet1.getColumn('iva').numFmt = '$ #,##0.00';
  sheet1.getColumn('total').numFmt = '$ #,##0.00';
  sheet1.getColumn('cae').numFmt = '@';

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

// Códigos de tipo de documento ARCA/AFIP más frecuentes en el negocio. Un código
// no contemplado se muestra igual (con su número), no se oculta ni se rompe.
const TIPOS_DOC_ARCA: Record<number, string> = {
  80: 'CUIT',
  86: 'CUIL',
  96: 'DNI',
  99: 'CONSUMIDOR FINAL',
};

function descripcionTipoDoc(tipoDni: number | null): string {
  if (tipoDni == null) return '';
  return TIPOS_DOC_ARCA[tipoDni] ?? `TIPO ${tipoDni}`;
}

// Número de documento (CUIT/CUIL/DNI) sin separadores, apto para importación
// automática. La celda se exporta con numFmt '@' (texto) para que Excel no lo
// convierta a notación científica ni le agregue ceros/exponente.
function formatearDocumento(dni: number | null): string {
  if (dni == null) return '';
  return String(dni);
}

// Concatena las alertas de la columna Observación. Vacía si no hay nada que mirar.
function armarObservacion(r: any, meta: any, neto: number, iva: number, total: number, esNota: boolean): string {
  const alertas: string[] = [];

  if (Math.abs(total - (neto + iva)) > 0.02) alertas.push('NETO+IVA NO CIERRA CONTRA TOTAL');
  if ([11, 12, 13].includes(r.tipoFactura)) alertas.push('FACTURA C EN EMPRESA RI - REVISAR');
  if (!meta) alertas.push('CODIGO DE COMPROBANTE NO MAPEADO - REVISAR');
  if (esNota && !r.ticketRelacionado) alertas.push('NOTA SIN COMPROBANTE ASOCIADO');

  return alertas.join(' | ');
}
