import ExcelJS from 'exceljs';
import { ESTADOS_PRE_CERRADOS } from '../models/ventaEstados';
const moment = require('moment');

/**
 * Export de la pantalla Pre-Facturación (Presupuesto / Pedido / Nota de Empaque), oct-2026.
 * Objetivo del cliente: llevar el control de pedidos pendientes y de la mercadería afectada sin
 * pasar a mano cada detalle a un Excel.
 *
 * Dos hojas:
 *  - "Procesos": una fila por documento (cabecera).
 *  - "Detalle": una fila por línea (prenda / no catalogado / servicio), talles en columnas.
 *
 * "Pendiente" = el documento todavía no está cerrado (ver ESTADOS_PRE_CERRADOS): sin comprobante
 * todavía, la mercadería sigue afectada. Se exportan TODOS los estados y la columna Pendiente
 * deja filtrar en Excel. Sin importes por línea a propósito: para este control alcanzan las
 * cantidades y el total de cabecera.
 */

const TALLES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL'];

function aFecha(valor: any): Date | null {
  return valor ? moment.utc(valor).startOf('day').toDate() : null;
}

function esPendiente(estado: string): string {
  return ESTADOS_PRE_CERRADOS.includes(estado) ? 'N' : 'S';
}

export async function crearExcelPreFacturacion(
  documentos: any[],
  detalle: { productos: any[]; servicios: any[] },
) {
  const workbook = new ExcelJS.Workbook();

  // Mapa idVenta -> datos del documento, para completar cada línea del detalle.
  const docPorId = new Map<number, any>();
  const ordenDoc = new Map<number, number>();
  documentos.forEach((d, i) => { docPorId.set(d.idVenta, d); ordenDoc.set(d.idVenta, i); });

  // =========================
  // HOJA 1: PROCESOS
  // =========================
  const sheet1 = workbook.addWorksheet('Procesos');
  sheet1.columns = [
    { header: 'Proceso', key: 'proceso', width: 18 },
    { header: 'N° Proceso', key: 'nroProceso', width: 12 },
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Fecha de entrega', key: 'fechaEntrega', width: 16 },
    { header: 'Cliente', key: 'cliente', width: 32 },
    { header: 'Estado', key: 'estado', width: 14 },
    { header: 'Pendiente', key: 'pendiente', width: 11 },
    { header: 'Cant. prendas', key: 'cantPrendas', width: 14 },
    { header: 'Cant. servicios', key: 'cantServicios', width: 15 },
    { header: 'Total', key: 'total', width: 16 },
    { header: 'Observación', key: 'observacion', width: 40 },
  ];

  documentos.forEach(r => {
    const fila = sheet1.addRow({
      proceso: r.proceso,
      nroProceso: Number(r.nroProceso),
      fecha: aFecha(r.fecha),
      fechaEntrega: aFecha(r.fechaEntrega),
      cliente: r.cliente,
      estado: r.estado,
      pendiente: esPendiente(r.estado),
      cantPrendas: Number(r.cantidad_prendas) || 0,
      cantServicios: Number(r.cantidad_servicios) || 0,
      total: Number(r.total) || 0,
      observacion: r.observacion ?? '',
    });
    fila.getCell('fecha').numFmt = 'dd/mm/yyyy';
    if (r.fechaEntrega) fila.getCell('fechaEntrega').numFmt = 'dd/mm/yyyy';
    fila.getCell('total').numFmt = '#,##0.00';
  });

  sheet1.autoFilter = { from: 'A1', to: 'K1' };

  // =========================
  // HOJA 2: DETALLE
  // =========================
  const sheet2 = workbook.addWorksheet('Detalle');
  sheet2.columns = [
    { header: 'Proceso', key: 'proceso', width: 18 },
    { header: 'N° Proceso', key: 'nroProceso', width: 12 },
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Fecha de entrega', key: 'fechaEntrega', width: 16 },
    { header: 'Cliente', key: 'cliente', width: 32 },
    { header: 'Estado', key: 'estado', width: 14 },
    { header: 'Pendiente', key: 'pendiente', width: 11 },
    { header: 'Tipo de ítem', key: 'tipoItem', width: 15 },
    { header: 'Producto', key: 'producto', width: 20 },
    { header: 'Tipo', key: 'tipo', width: 20 },
    { header: 'Género', key: 'genero', width: 12 },
    { header: 'Código', key: 'codigo', width: 12 },
    { header: 'Artículo', key: 'articulo', width: 30 },
    { header: 'Material', key: 'material', width: 20 },
    { header: 'Color', key: 'color', width: 15 },
    ...TALLES.map(t => ({ header: t, key: t, width: 7 })),
    { header: 'Total', key: 'total', width: 9 },
  ];

  // Prendas/no catalogados primero y servicios después, dentro de cada documento; los
  // documentos conservan el orden del listado (fecha desc).
  const lineas: { orden: number; tipoOrden: number; idLinea: number; datos: any }[] = [];

  detalle.productos.forEach(l => {
    const d = docPorId.get(l.idVenta);
    if (!d) return;
    const talles: Record<string, number> = {};
    TALLES.forEach((t, i) => { talles[t] = Number(l[`t${i + 1}`]) || 0; });
    const sumaTalles = Object.values(talles).reduce((a, b) => a + b, 0);
    const cantidad = Number(l.cantidad) || 0;
    // Línea cargada solo con la cantidad total y los talles como etiqueta: no se reparte la
    // cantidad entre talles (serían unidades inventadas) - el Total sale de cantidad y la
    // etiqueta va en su propia columna.
    const sinDesglose = sumaTalles === 0 && cantidad > 0;
    lineas.push({
      orden: ordenDoc.get(l.idVenta)!, tipoOrden: 0, idLinea: Number(l.idLinea),
      datos: {
        ...baseDoc(d),
        tipoItem: l.tipoItem, producto: l.producto, tipo: l.tipo, genero: l.genero,
        codigo: l.codigo, articulo: l.articulo, material: l.material, color: l.color,
        ...talles,
        total: cantidad,
        tallesSinDesglose: sinDesglose ? (l.tallesLabel ?? '') : '',
      },
    });
  });

  detalle.servicios.forEach(l => {
    const d = docPorId.get(l.idVenta);
    if (!d) return;
    const talles: Record<string, number | null> = {};
    TALLES.forEach(t => { talles[t] = null; }); // un servicio no tiene talles: vacío, no cero
    lineas.push({
      orden: ordenDoc.get(l.idVenta)!, tipoOrden: 1, idLinea: Number(l.idLinea),
      datos: {
        ...baseDoc(d),
        tipoItem: 'Servicio', codigo: l.codigo, articulo: l.articulo,
        ...talles,
        total: Number(l.cantidad) || 0,
      },
    });
  });

  lineas.sort((a, b) => a.orden - b.orden || a.tipoOrden - b.tipoOrden || a.idLinea - b.idLinea);

  // La columna "Talles (sin desglose)" solo existe si el export trae alguna línea cargada así;
  // si no, sería una columna vacía.
  if (lineas.some(l => l.datos.tallesSinDesglose)) {
    sheet2.getColumn(sheet2.columns.length + 1).key = 'tallesSinDesglose';
    sheet2.getColumn('tallesSinDesglose').header = 'Talles (sin desglose)';
    sheet2.getColumn('tallesSinDesglose').width = 24;
  }

  lineas.forEach(l => {
    const fila = sheet2.addRow(l.datos);
    fila.getCell('fecha').numFmt = 'dd/mm/yyyy';
    if (l.datos.fechaEntrega) fila.getCell('fechaEntrega').numFmt = 'dd/mm/yyyy';
  });

  const ultimaColumna = sheet2.columns.length;
  sheet2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ultimaColumna } };

  // Talles en 0 se muestran como "–" (mismo formato que el resto de los exportables); sigue
  // siendo el número 0, solo cambia cómo se ve.
  TALLES.forEach(t => {
    sheet2.getColumn(t).eachCell((c, rowIndex) => {
      if (rowIndex === 1) return;
      c.numFmt = '#,##0;-#,##0;"–"';
      c.alignment = { horizontal: 'center' };
    });
  });

  // Encabezados con el mismo estilo que los otros exportables (excelVentasService).
  [sheet1, sheet2].forEach(sheet => {
    sheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  });

  return await workbook.xlsx.writeBuffer();
}

function baseDoc(d: any) {
  return {
    proceso: d.proceso,
    nroProceso: Number(d.nroProceso),
    fecha: aFecha(d.fecha),
    fechaEntrega: aFecha(d.fechaEntrega),
    cliente: d.cliente,
    estado: d.estado,
    pendiente: esPendiente(d.estado),
  };
}
