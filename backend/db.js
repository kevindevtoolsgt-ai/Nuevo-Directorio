// Importar el módulo mssql para la interacción con la base de datos SQL Server.
const sql = require('mssql');

let pool; // Declarar una variable para almacenar el pool de conexiones

/**
 * Configuración de la conexión a la base de datos.
 * Lee las variables de entorno del archivo .env para obtener las credenciales y detalles del servidor.
 * Es una buena práctica de seguridad no tener credenciales escritas directamente en el código.
 */
const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433, // Usar puerto 1433 por defecto si no se especifica
    options: {
        encrypt: true, // Forzar la encriptación para conexiones seguras.
        trustServerCertificate: true // Confiar en certificados autofirmados solo para desarrollo local.
    },
    pool: {
        max: 10, // Máximo de conexiones en el pool
        min: 0, // Mínimo de conexiones en el pool
        idleTimeoutMillis: 30000 // Tiempo en ms para cerrar conexiones inactivas
    },
    connectionTimeout: 15000, // Tiempo de espera para la conexión inicial
    requestTimeout: 15000 // Tiempo de espera para una petición
};

// Para depuración: Muestra la configuración de conexión sin la contraseña.
const displayConfig = { ...config, password: '[REDACTED]' };
console.log('Configuración de conexión a MSSQL:', displayConfig);

/**
 * Inicializa el esquema de la base de datos.
 * Esta función se asegura de que las tablas 'Users' y 'Personal' existan,
 * y que tengan todas las columnas necesarias.
 * Utiliza 'IF NOT EXISTS' para evitar errores si las tablas o columnas ya existen.
 */
async function initializeDatabase() {
    try {
        console.log('Verificando y preparando el esquema de la base de datos...');
        const request = pool.request();

        // --- Tabla de Usuarios (Users) ---
        // Crear la tabla 'Users' si no existe.
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Users' AND xtype='U')
            CREATE TABLE Users (
                id INT PRIMARY KEY IDENTITY(1,1),
                username NVARCHAR(255) NOT NULL UNIQUE,
                password NVARCHAR(255) NOT NULL
            )
        `);

        // Añadir la columna 'role' a la tabla 'Users' si no existe.
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'role' AND Object_ID = Object_ID(N'Users'))
            BEGIN
                ALTER TABLE Users ADD role NVARCHAR(50) NOT NULL DEFAULT 'user'
            END
        `);

        // --- Tabla de Personal ---
        // Crear la tabla 'Personal' si no existe.
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Personal' AND xtype='U')
            CREATE TABLE Personal (
                id INT PRIMARY KEY IDENTITY(1,1),
                nombre NVARCHAR(255) NOT NULL,
                correo NVARCHAR(255),
                extension NVARCHAR(50),
                puesto NVARCHAR(255),
                departamento NVARCHAR(255),
                descripcion NVARCHAR(MAX),
                fotoUrl NVARCHAR(MAX),
                en_carrusel BIT DEFAULT 0,
                fecha_nacimiento DATE
            )
        `);

        // Asegurar que los valores nulos en 'en_carrusel' se conviertan a 0.
        await request.query(`UPDATE Personal SET en_carrusel = 0 WHERE en_carrusel IS NULL;`);

        // Añadir la columna 'fecha_nacimiento' a la tabla 'Personal' si no existe.
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'fecha_nacimiento' AND Object_ID = Object_ID(N'Personal'))
            BEGIN
                ALTER TABLE Personal ADD fecha_nacimiento DATE NULL
            END
        `);

        // --- Tabla de Información Importante (ImportantInfo) ---
        // Crear la tabla 'ImportantInfo' si no existe.
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ImportantInfo' AND xtype='U')
            CREATE TABLE ImportantInfo (
                id INT PRIMARY KEY IDENTITY(1,1),
                title NVARCHAR(255) NOT NULL,
                content NVARCHAR(MAX),
                extension NVARCHAR(50)
            )
        `);

        console.log('El esquema de la base de datos ha sido verificado y está listo.');
    } catch (err) {
        // Si hay un error durante la inicialización, se muestra en consola y se detiene la aplicación.
        console.error('Error al inicializar el esquema de la base de datos: ', err);
        throw err; // Re-lanzar el error para que el llamador (pruebas) pueda manejarlo.
    }
}

/**
 * Establece la conexión con la base de datos MSSQL con reintentos.
 * Si la conexión es exitosa, llama a la función para inicializar el esquema.
 */
async function connect(retries = 5) {
    while (retries > 0) {
        try {
            if (pool && pool.connected) {
                console.log('Ya conectado a MSSQL, reutilizando conexión existente.');
                return;
            }
            
            console.log('Intentando conectar a MSSQL...');
            pool = new sql.ConnectionPool(config);
            
            pool.on('error', err => {
                console.error('Error en el pool de conexiones de MSSQL:', err);
            });

            await pool.connect();
            console.log('Conexión exitosa con MSSQL.');
            
            // Una vez conectados, aseguramos que las tablas estén configuradas.
            await initializeDatabase();
            return; // Salir del bucle si la conexión es exitosa
        } catch (err) {
            console.error(`La conexión a la base de datos falló. Reintentos restantes: ${retries - 1}`, err.message);
            retries--;
            if (retries === 0) {
                throw err; // Lanzar el error final si todos los reintentos fallan
            }
            // Esperar 5 segundos antes de reintentar
            await new Promise(res => setTimeout(res, 5000));
        }
    }
}

/**
 * Cierra la conexión a la base de datos MSSQL.
 */
async function close() {
    try {
        if (pool && pool.connected) {
            await pool.close();
            console.log('Conexión a MSSQL cerrada.');
        }
    } catch (err) {
        console.error('Error al cerrar la conexión a la base de datos: ', err);
        throw err;
    }
}

/**
 * Obtiene toda la información importante.
 * @returns {Promise<Array>} Lista de objetos de información importante. 
 */
async function getImportantInfo() {
    try {
        const request = pool.request();
        const result = await request.query('SELECT * FROM ImportantInfo');
        return result.recordset;
    } catch (err) {
        console.error('Error al obtener información importante:', err);
        throw err;
    }
}

/**
 * Obtiene información importante por ID.
 * @param {number} id - ID de la información importante.
 * @returns {Promise<Object>} Objeto de información importante.
 */
async function getImportantInfoById(id) {
    try {
        const request = pool.request();
        const result = await request
            .input('id', sql.Int, id)
            .query('SELECT * FROM ImportantInfo WHERE id = @id');
        return result.recordset[0];
    } catch (err) {
        console.error('Error al obtener información importante por ID:', err);
        throw err;
    }
}

/**
 * Agrega nueva información importante.
 * @param {string} title - Título de la información.
 * @param {string} content - Contenido de la información.
 * @param {string} extension - Extensión asociada.
 * @returns {Promise<Object>} El objeto de información importante agregado.
 */
async function addImportantInfo(title, content, extension) {
    try {
        const request = pool.request();
        const result = await request
            .input('title', sql.NVarChar, title)
            .input('content', sql.NVarChar, content)
            .input('extension', sql.NVarChar, extension)
            .query('INSERT INTO ImportantInfo (title, content, extension) VALUES (@title, @content, @extension); SELECT SCOPE_IDENTITY() AS id;');
        return { id: result.recordset[0].id, title, content, extension };
    } catch (err) {
        console.error('Error al agregar información importante:', err);
        throw err;
    }
}

/**
 * Actualiza información importante existente.
 * @param {number} id - ID de la información importante a actualizar.
 * @param {string} title - Nuevo título.
 * @param {string} content - Nuevo contenido.
 * @param {string} extension - Nueva extensión.
 * @returns {Promise<boolean>} True si se actualizó, false si no.
 */
async function updateImportantInfo(id, title, content, extension) {
    try {
        const request = pool.request();
        const result = await request
            .input('id', sql.Int, id)
            .input('title', sql.NVarChar, title)
            .input('content', sql.NVarChar, content)
            .input('extension', sql.NVarChar, extension)
            .query('UPDATE ImportantInfo SET title = @title, content = @content, extension = @extension WHERE id = @id');
        return result.rowsAffected[0] > 0; // Devuelve true si se actualizó al menos una fila
    } catch (err) {
        console.error('Error al actualizar información importante:', err);
        throw err;
    }
}

/**
 * Elimina información importante por ID.
 * @param {number} id - ID de la información importante a eliminar.
 * @returns {Promise<boolean>} True si se eliminó, false si no.
 */
async function deleteImportantInfo(id) {
    try {
        const request = pool.request();
        const result = await request
            .input('id', sql.Int, id)
            .query('DELETE FROM ImportantInfo WHERE id = @id');
        return result.rowsAffected[0] > 0; // Devuelve true si se eliminó al menos una fila
    } catch (err) {
        console.error('Error al eliminar información importante:', err);
        throw err;
    }
}

/**
 * Exporta las funciones 'connect' y el objeto 'sql'.
 * Esto permite que otros archivos (como server.js) puedan usar la conexión
 * a la base de datos y ejecutar consultas.
 */
const getPool = () => pool;

/**
 * Exporta las funciones 'connect' y el objeto 'sql'.
 * Esto permite que otros archivos (como server.js) puedan usar la conexión
 * a la base de datos y ejecutar consultas.
 */
module.exports = { connect, close, sql, getPool, getImportantInfo, getImportantInfoById, addImportantInfo, updateImportantInfo, deleteImportantInfo };