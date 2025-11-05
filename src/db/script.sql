DROP DATABASE IF EXISTS dbeasystore;
CREATE DATABASE dbeasystore;

USE dbeasystore;

DROP TABLE IF EXISTS parametros;
CREATE TABLE parametros (
    clave VARCHAR(30) PRIMARY KEY,
    valor VARCHAR(50) NOT NULL DEFAULT ''
);

DROP TABLE IF EXISTS parametros_facturacion;
CREATE TABLE parametros_facturacion (
    condicion VARCHAR(50),
    puntoVta INT,
    cuil BIGINT,
    razon VARCHAR(100),
    direccion VARCHAR(250)
);

DROP TABLE IF EXISTS backups;
CREATE TABLE backups (
    nombre VARCHAR(30) PRIMARY KEY,
    fecha DATE
);

DROP TABLE IF EXISTS usuarios;
CREATE TABLE usuarios (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario VARCHAR(30),
    nombre VARCHAR(100),
    email VARCHAR(100),
    pass VARCHAR(30),
    idCargo INT
);

DROP TABLE IF EXISTS cargos;
CREATE TABLE cargos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100)
);

DROP TABLE IF EXISTS clientes;
CREATE TABLE clientes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100),
    razonSocial VARCHAR(100),
    telefono VARCHAR(20),
    celular VARCHAR(20),
    contacto VARCHAR(100),
    email VARCHAR(100),
    idCondIva INT,  
    idTipoDocumento INT,
    documento BIGINT,
    idCondicionPago INT,
    idCategoria INT,
    fechaAlta TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fechaBaja DATE
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS direcciones_cliente;
CREATE TABLE direcciones_cliente (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idCliente INT,
    resumen VARCHAR(300),
    codPostal VARCHAR(10),
    calle VARCHAR(150),
    numero VARCHAR(10),
    localidad VARCHAR(100),
    provincia VARCHAR(100),
    observaciones VARCHAR(300)
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS tipos_pago;
CREATE TABLE tipos_pago (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(15)
);

DROP TABLE IF EXISTS tipos_documento;
CREATE TABLE tipos_documento(
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50)
);


DROP TABLE IF EXISTS ventas;
CREATE TABLE ventas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idProceso INT NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    hora VARCHAR(10),
    idCliente INT NOT NULL,
    idLista INT NOT NULL,
    nroNota INT,
    idEmpresa INT NOT NULL,
    idTComprobante INT NOT NULL,
    idTDescuento INT,
    descuento DECIMAL(5,2),
    codPromocion INT,
    redondeo DECIMAL(10,2),
    total DECIMAL(10,2),
    fechaBaja DATETIME
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS ventas_productos;
CREATE TABLE ventas_productos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idVenta INT NOT NULL,
    idProducto INT NOT NULL,
    idLineaTalle INT,
    cantidad INT NOT NULL,
    precio DECIMAL(10,2) NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    t1 INT,
    t2 INT,
    t3 INT,
    t4 INT,
    t5 INT,
    t6 INT,
    t7 INT,
    t8 INT,
    t9 INT,
    t10 INT,
    talles VARCHAR(100)
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS ventas_servicios;
CREATE TABLE ventas_servicios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idVenta INT NOT NULL,
    idServicio INT NOT NULL,
    cantidad INT NOT NULL,
    precio DECIMAL(10,2) NOT NULL,
    total DECIMAL(10,2) NOT NULL
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS ventas_pagos;
CREATE TABLE ventas_pagos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idVenta INT NOT NULL,
    idMetodo INT NOT NULL,
    monto DECIMAL(10,2) NOT NULL
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS ventas_factura;
CREATE TABLE ventas_factura (
    idVenta INT PRIMARY KEY,
    cae BIGINT,
    caeVto DATE,
    ticket INT,
    tipoFactura INT,
    neto DECIMAL(10,2),
    iva DECIMAL(10,2),
    dni BIGINT,
    tipoDni INT,
    ptoVenta INT,
    condReceptor INT DEFAULT 0
)
ENGINE=InnoDB;


DROP TABLE IF EXISTS etiquetas;
CREATE TABLE etiquetas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    tamanio VARCHAR(10),
    titulo VARCHAR(50),
    mOferta INT,
    mCodigo INT,
    mPrecio INT,
    mNombre INT,
    mVencimiento INT,
    bordeColor VARCHAR(10),
    bordeAncho VARCHAR(10),
    tituloColor VARCHAR(10),
    tituloAlineacion VARCHAR(10),
    ofertaFondo VARCHAR(10),
    ofertaAlineacion VARCHAR(10),
    nombreAlineacion VARCHAR(10),
    vencimientoAlineacion VARCHAR(10),
    precioAlineacion VARCHAR(10),
    precioColor VARCHAR(10)
);

DROP TABLE IF EXISTS productos;
CREATE TABLE productos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(30),
    nombre VARCHAR(100),
    empresa VARCHAR(50),
    idProceso INT,
    idCliente INT,
    idTipo INT,
    idSubTipo INT,
    idGenero INT,
    idMaterial INT,
    idColor INT,
    idTemporada INT,
    moldeleria INT,
    imagen VARCHAR(300),
    fechaBaja DATE
);

DROP TABLE IF EXISTS procesos;
CREATE TABLE procesos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    abreviatura VARCHAR(10)
);

DROP TABLE IF EXISTS procesos_venta;
CREATE TABLE procesos_venta (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50)
);


DROP TABLE IF EXISTS tipos_producto;
CREATE TABLE tipos_producto (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    abreviatura VARCHAR(10)
);

DROP TABLE IF EXISTS subtipos_producto;
CREATE TABLE subtipos_producto (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    abreviatura VARCHAR(10)
);

DROP TABLE IF EXISTS generos;
CREATE TABLE generos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    abreviatura VARCHAR(10)
);

DROP TABLE IF EXISTS colores;
CREATE TABLE colores (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    hexa VARCHAR(10)
);

DROP TABLE IF EXISTS materiales;
CREATE TABLE materiales (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50)
);

DROP TABLE IF EXISTS temporadas;
CREATE TABLE temporadas (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    abreviatura VARCHAR(10)
);

DROP TABLE IF EXISTS materiales_colores;
CREATE TABLE materiales_colores (
    idColor INT,
    idMaterial INT
);

DROP TABLE IF EXISTS lineas_talle;
CREATE TABLE lineas_talle (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50)
);

DROP TABLE IF EXISTS metodos_pago;
CREATE TABLE metodos_pago (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50)
);

DROP TABLE IF EXISTS talles_producto;
CREATE TABLE talles_producto (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idProducto INT,
    idLineaTalle INT,
    talle VARCHAR(5),
    ubicacion INT,
    cantidad INT,
    precio DECIMAL(10,2),
    costo DECIMAL(10,2)
);

DROP TABLE IF EXISTS condiciones_iva;
CREATE TABLE condiciones_iva (
    id INT PRIMARY KEY,
    descripcion VARCHAR(50)
);

DROP TABLE IF EXISTS comprobantes_condicion;
CREATE TABLE comprobantes_condicion (
    id INT  UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idCondicion INT,
    idComprobante INT,
    desComprobante VARCHAR(10)
);

DROP TABLE IF EXISTS condiciones_pago;
CREATE TABLE condiciones_pago (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50)
);

DROP TABLE IF EXISTS servicios;
CREATE TABLE servicios (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(30),
    descripcion VARCHAR(50)
);

DROP TABLE IF EXISTS empresas;
CREATE TABLE empresas (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    razonSocial VARCHAR(100),
    condicion VARCHAR(50),
    puntoVta INT,
    cuil BIGINT,
    direccion VARCHAR(250)
);

INSERT INTO parametros(clave, valor) 
VALUES 
('version','1.1.2'),
('dni',''), 
('expresion',''), 
('backups', 'false'), 
('dias', 'Lunes, Martes, Viernes'), 
('hora', '20:30'), 
('avisoNvaVersion', 'true'),
('actualizado', 'false');

INSERT INTO productos 
(codigo, nombre, idProceso, idTipo, idSubTipo, idGenero, idMaterial, idColor, idTemporada, moldeleria, imagen, fechaBaja) 
VALUES 
('1', 'VARIOS', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

INSERT INTO tipos_pago(id, nombre) VALUES (NULL,'EFECTIVO'), (NULL,'TARJETA'), (NULL,'TRANSFERENCIA'), (NULL,'COMBINADO');
INSERT INTO cargos(id, nombre) VALUES (NULL,'ADMINISTRADOR'), (NULL,'EMPLEADO');
INSERT INTO `clientes` (`id`, `nombre`, `razonSocial`, `telefono`, `celular`, `contacto`, `email`, `idCondIva`, `idTipoDocumento`, `documento`, `idCondicionPago`, `idCategoria`, `fechaAlta`, `fechaBaja`) VALUES (NULL, 'CONSUMIDOR FINAL', 'CONSUMIDOR FINAL', '0', '0', 'CONSUMIDOR FINAL', NULL, '0', '0', '0', '0', '0', CURRENT_TIMESTAMP, NULL);
INSERT INTO usuarios(id, usuario, nombre, email, pass, idCargo) VALUES (NULL, 'ADMIN', 'ADMINISTRADOR', NULL, '1235', 1);
INSERT INTO lineas_talle(descripcion)
VALUES
('XXP-PE-ME-GR-XXG'),
('4-6-8-10-12-14-16-18'),
('28-30-32-34-36-38-40-42-44-46'),
('XS-S-M-L-XL-XXL-3XL-4XL-5XL-6XL');

INSERT INTO condiciones_iva (id, descripcion) VALUES
(5, 'Consumidor Final'),
(1, 'IVA Responsable Inscripto'),
(6, 'Responsable Monotributo'),
(13, 'Monotributista Social'),
(15, 'IVA No Alcanzado');

INSERT INTO comprobantes_condicion (idCondicion, idComprobante, desComprobante) VALUES
(5, 0, 'COTIZACION'),
(1, 1, 'FACTURA A'),
(1, 11, 'FACTURA B'),
(1, 0, 'COTIZACION'),
(6, 11,'FACTURA C'),
(6, 0, 'COTIZACION'),
(13, 11,'FACTURA C'),
(13, 0, 'COTIZACION');

INSERT INTO condiciones_pago (id, descripcion) VALUES
(1, 'CONTADO'),
(2, 'CUENTA CORRIENTE'),
(3, 'PAGO DIGITAL'),
(4, 'OTRO');

INSERT INTO tipos_documento(id, descripcion) VALUES
(80, 'CUIT'),
(86, 'CUIL'),
(96, 'DNI');

INSERT INTO metodos_pago(id, descripcion) VALUES
(1, 'CONTADO'),
(2, 'TARJETA CREDITO'),
(3, 'TARJETA DEBITO'),
(4, 'MERCADO PAGO');

INSERT INTO procesos_venta(id, descripcion) VALUES
(1, 'FACTURA'),
(2, 'COTIZACION'),
(3, 'SHOWROOM'),
(4, 'DIFUSION'),
(5, 'CON NOTA EMPAQUE');

INSERT INTO empresas(id, razonSocial, condicion, puntoVta, cuil, direccion) VALUES
(1, 'SUCEDE SRL', 'Responsable Inscripto', 1, 27411750723, 'Mi direccion 285'),
(2, 'GABEL MARIELA', 'Monotributista', 1, 27411750723, 'Mi direccion 285'),
(3, 'OMAR CHAZA', 'Monotributista', 1, 27411750723, 'Mi direccion 285');



