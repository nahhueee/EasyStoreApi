import ExcelJS from 'exceljs';

export async function crearExcelResultados(data: any[]) {
  // 1. Crear nuevo libro de trabajo
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Resultados');

  // 2. Definir colores para los encabezados
  const estilosEncabezados = {
    // Verde claro para la primera fila de tallas
    fila1: {
      font: { bold: true },
      alignment: { horizontal: 'center' as const, vertical: 'middle' as const },
      fill: {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FFE2F0D9' } // Verde claro
      }
    },
    // Rojo claro para la segunda fila de tallas
    fila2: {
      font: { bold: true },
      alignment: { horizontal: 'center' as const, vertical: 'middle' as const },
      fill: {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FFFCE4D6' } // Naranja claro (coral)
      }
    },
    // Naranja claro para la tercera fila de tallas
    fila3: {
      font: { bold: true },
      alignment: { horizontal: 'center' as const, vertical: 'middle' as const },
      fill: {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FFFFE699' } // Amarillo claro (naranja pálido)
      }
    },
    // Celeste claro para encabezados informativos y tallas
    celesteClaro: {
      font: { bold: true },
      alignment: { horizontal: 'center' as const, vertical: 'middle' as const },
      fill: {
        type: 'pattern' as const,
        pattern: 'solid' as const,
        fgColor: { argb: 'FFDDEBF7' } // Celeste claro
      }
    }
  };

  // 3. Encabezados de tallas (filas 1-3, columnas I-R)
  const encabezadosTallas = [
    ["XXP", "PE", "ME", "GR", "XXG", "", "", "", "", ""],
    [4, 6, 8, 10, 12, 14, 16, 18, "", ""],
    [28, 30, 32, 34, 36, 38, 40, 42, 44, 46],
  ];

  // Añadir encabezados de tallas con colores diferentes
  encabezadosTallas.forEach((fila, rowIndex) => {
    fila.forEach((valor, colIndex) => {
      if (valor !== "") {
        const cell = worksheet.getCell(rowIndex + 1, colIndex + 9);
        cell.value = valor;
        
        // Aplicar estilo según la fila
        if (rowIndex === 0) {
          Object.assign(cell, estilosEncabezados.fila1);
        } else if (rowIndex === 1) {
          Object.assign(cell, estilosEncabezados.fila2);
        } else if (rowIndex === 2) {
          Object.assign(cell, estilosEncabezados.fila3);
        }
      }
    });
  });

  // 4. Encabezados informativos (fila 4, columnas A-H) - Celeste claro
  const columnasInfo = ["PROCESO", "CODIGO", "NOMBRE", "PRODUCTO", "TIPO", "GENERO", "MATERIAL", "COLOR"];
  columnasInfo.forEach((encabezado, colIndex) => {
    const cell = worksheet.getCell(4, colIndex + 1);
    cell.value = encabezado;
    Object.assign(cell, estilosEncabezados.celesteClaro);
  });

  // 5. Encabezados de tallas (fila 4, columnas I-R) - Celeste claro
  const columnasTallas = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL", "6XL"];
  columnasTallas.forEach((talla, colIndex) => {
    const cell = worksheet.getCell(4, colIndex + 9);
    cell.value = talla;
    Object.assign(cell, estilosEncabezados.celesteClaro);
  });

  // 6. Encabezado Total (fila 4, columna S) - Celeste claro
  const totalCell = worksheet.getCell(4, 19);
  totalCell.value = "TOTAL";
  Object.assign(totalCell, estilosEncabezados.celesteClaro);

  // 7. Añadir datos de productos (filas 5 en adelante)
  data.forEach((p, rowIndex) => {
    const fila = [
      p.Proceso || "",
      p.Codigo || "",
      p.Nombre || "",
      p.Producto || "",
      p.Tipo || "",
      p.Genero || "",
      p.Material || "",
      p.Color || "",
      p.XS || 0,
      p.S || 0,
      p.M || 0,
      p.L || 0,
      p.XL || 0,
      p.XXL || 0,
      p["3XL"] || 0,
      p["4XL"] || 0,
      p["5XL"] || 0,
      p["6XL"] || 0,
      p.Total || 0
    ];

    fila.forEach((valor, colIndex) => {
      const cell = worksheet.getCell(rowIndex + 5, colIndex + 1);
      cell.value = valor;
      
      // Formatear números para las cantidades (columnas I-S)
      if (colIndex >= 8 && colIndex <= 18) {
        cell.numFmt = '_-* #,##0_-;_-* #,##0_-;_-* "–"_-;_-@_-';
        cell.alignment = { horizontal: 'center' };
      }
    });
  });

  // 8. Ajustar el ancho de las columnas automáticamente
  for (let i = 1; i <= 19; i++) {
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

  // 9. Convertir a buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}