import ExcelJS from 'exceljs';

export async function crearExcelClientes(data: any[]) {
  // 1. Crear nuevo libro de trabajo
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Clientes');

  // 2. Estilo de encabezado (mismo celeste claro usado en excelProductosService)
  const estiloHeader = {
    font: { bold: true },
    alignment: { horizontal: 'center' as const, vertical: 'middle' as const },
    fill: {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: 'FFDDEBF7' }
    }
  };

  // 3. Encabezados (fila 1)
  const columnas = [
    "Codigo", "Nombre", "Razon Social", "Documento", "Tipo Doc.", "Condicion IVA",
    "Condicion Pago", "Categoria", "Lista Precio", "Telefono", "Celular", "Contacto", "Email", "Fecha Alta"
  ];

  columnas.forEach((titulo, colIndex) => {
    const cell = worksheet.getCell(1, colIndex + 1);
    cell.value = titulo;
    Object.assign(cell, estiloHeader);
  });

  // 4. Datos (fila 2 en adelante)
  data.forEach((c, rowIndex) => {
    const fila = [
      c.Codigo || "",
      c.Nombre || "",
      c.RazonSocial || "",
      c.Documento || "",
      c.TipoDocumento || "",
      c.CondicionIva || "",
      c.CondicionPago || "",
      c.Categoria || "",
      c.ListaPrecio || "",
      c.Telefono || "",
      c.Celular || "",
      c.Contacto || "",
      c.Email || "",
      c.FechaAlta || ""
    ];

    fila.forEach((valor, colIndex) => {
      worksheet.getCell(rowIndex + 2, colIndex + 1).value = valor;
    });
  });

  // 5. Ajustar ancho de columnas automáticamente
  for (let i = 1; i <= columnas.length; i++) {
    const column = worksheet.getColumn(i);
    let maxLength = 0;

    column.eachCell({ includeEmpty: true }, (cell) => {
      const columnLength = cell.value ? cell.value.toString().length : 10;
      if (columnLength > maxLength) {
        maxLength = columnLength;
      }
    });

    column.width = maxLength < 10 ? 10 : maxLength + 2;
  }

  // 6. Convertir a buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}
