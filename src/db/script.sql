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
)

DROP TABLE IF EXISTS ventas_entrega;
CREATE TABLE ventas_entrega (
    id INT PRIMARY KEY,
    idCliente INT NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS ventas_entrega_detalle;
CREATE TABLE ventas_entrega_detalle (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idEntrega INT NOT NULL,
    idVenta INT NOT NULL,
    montoAplicado DECIMAL(10,2) NOT NULL
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

INSERT INTO parametros_facturacion(condicion, puntoVta, cuil, razon, direccion) 
VALUES ('monotributista', 0, 0, '', '');

INSERT INTO productos 
(codigo, nombre, idProceso, idTipo, idSubTipo, idGenero, idMaterial, idColor, idTemporada, moldeleria, imagen, fechaBaja) 
VALUES 
('1', 'VARIOS', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

INSERT INTO tipos_pago(id, nombre) VALUES (NULL,'EFECTIVO'), (NULL,'TARJETA'), (NULL,'TRANSFERENCIA'), (NULL,'COMBINADO');
INSERT INTO cargos(id, nombre) VALUES (NULL,'ADMINISTRADOR'), (NULL,'EMPLEADO');
INSERT INTO `clientes` (`id`, `nombre`, `razonSocial`, `telefono`, `celular`, `contacto`, `email`, `idCondIva`, `idTipoDocumento`, `documento`, `condicionPago`, `idCategoria`, `fechaAlta`, `fechaBaja`) VALUES (NULL, 'CONSUMIDOR FINAL', 'CONSUMIDOR FINAL', '0', '0', 'CONSUMIDOR FINAL', NULL, '0', '0', '0', '0', '0', CURRENT_TIMESTAMP, NULL);
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

INSERT INTO condiciones_pago (id, descripcion) VALUES
(1, 'CONTADO'),
(2, 'CUENTA CORRIENTE'),
(3, 'PAGO DIGITAL'),
(4, 'OTRO');

INSERT INTO tipos_documento(id, descripcion) VALUES
(80, 'CUIT'),
(86, 'CUIL'),
(96, 'DNI');

