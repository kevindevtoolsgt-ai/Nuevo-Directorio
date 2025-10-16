// Importar el módulo mssql para la interacción con la base de datos SQL Server.
const sql = require('mssql'); // Cambio: Usar el driver por defecto (tedious)

let pool; // Declarar una variable para almacenar el pool de conexiones

/**
 * Configuración de la conexión a la base de datos usando el driver 'tedious'.
 * Esta configuración es más estándar, multiplataforma y menos propensa a errores de drivers locales.
 */
const config = {
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeout: 15000,
    requestTimeout: 15000,
    options: {
        // Forzar la encriptación y confiar en el certificado del servidor.
        // Esto es compatible con la mayoría de las configuraciones, incluyendo Azure SQL,
        // SQL Server en Docker y servidores locales con certificados autofirmados.
        encrypt: true,
        trustServerCertificate: true,
    },
    pool: {
        max: 10, // Máximo de conexiones en el pool
        min: 0, // Mínimo de conexiones en el pool
        idleTimeoutMillis: 30000 // Tiempo en ms para cerrar conexiones inactivas
    }
};

// Para depuración: Muestra la configuración de conexión sin la contraseña.
const displayConfig = {
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user,
    password: '[REDACTED]'
};
console.log('Configuración de conexión a MSSQL:', displayConfig);

/**
 * Inicializa el esquema de la base de datos.
 * Esta función se asegura de que las tablas 'Users' y 'Personal' existan,
 * y que tengan todas las columnas necesarias.
 * Utiliza 'IF NOT EXISTS' para evitar errores si las tablas o columnas ya existen.
 */
async function initializeDatabase(pool) {
    try {
        console.log('Verificando y preparando el esquema de la base de datos...');
        // NOTA: La lógica de migración se ha movido a `migrateSchema_RemoveExtensionIdFromPuestos`
        const request = pool.request();

        // --- Tabla de Usuarios (Users) ---
        // Crear la tabla 'Users' si no existe.
        await request.query(`
            IF OBJECT_ID('dbo.Users', 'U') IS NULL
            CREATE TABLE Users (
                id INT PRIMARY KEY IDENTITY(1,1),
                username NVARCHAR(255) NOT NULL UNIQUE,
                password NVARCHAR(255) NOT NULL,
                role NVARCHAR(50) NOT NULL DEFAULT 'user'
            )
        `);

        // --- Tabla de Personal ---
        // Crear la tabla 'Personal' si no existe.
        await request.query(`
            IF OBJECT_ID('dbo.Personal', 'U') IS NULL
            CREATE TABLE Personal (
                id INT PRIMARY KEY IDENTITY(1,1),
                nombre NVARCHAR(255) NOT NULL,
                correo NVARCHAR(255) UNIQUE,
                descripcion NVARCHAR(MAX),
                fotoUrl NVARCHAR(MAX),
                en_carrusel BIT NOT NULL DEFAULT 0,
                fecha_nacimiento DATE NULL
            )
        `);

        // --- Tabla de Departamentos (Departments) ---
        await request.query(`
            IF OBJECT_ID('dbo.Departments', 'U') IS NULL
            CREATE TABLE Departments (
                id INT PRIMARY KEY IDENTITY(1,1),
                name NVARCHAR(255) NOT NULL UNIQUE
            )
        `);

        // --- Tabla de Extensiones (Extensions) ---
        await request.query(`
            IF OBJECT_ID('dbo.Extensions', 'U') IS NULL
            CREATE TABLE Extensions (
                id INT PRIMARY KEY IDENTITY(1,1),
                number NVARCHAR(50) NOT NULL UNIQUE,
                department_id INT NULL,
                CONSTRAINT FK_Extensions_Departments FOREIGN KEY (department_id) REFERENCES Departments(id) ON DELETE SET NULL
            )
        `);

        // --- Tabla de Puestos (Puestos) ---
        await request.query(`
            IF OBJECT_ID('dbo.Puestos', 'U') IS NULL
            CREATE TABLE Puestos (
                id INT PRIMARY KEY IDENTITY(1,1),
                name NVARCHAR(255) NOT NULL,
                department_id INT NOT NULL, 
                CONSTRAINT FK_Puestos_Departments FOREIGN KEY (department_id) REFERENCES Departments(id) ON DELETE CASCADE,
            )
        `);

        // Para el nombre del puesto y el departamento, usamos una restricción UNIQUE compuesta.
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sys.objects WHERE name = 'UQ_Puestos_Name_Department' AND type = 'UQ')
            ALTER TABLE Puestos ADD CONSTRAINT UQ_Puestos_Name_Department UNIQUE(name, department_id);
        `);

        // --- Tabla de Unión Puesto-Extensión (PuestoExtension) ---
        // Esta tabla permite una relación muchos-a-muchos entre Puestos y Extensiones.
        await request.query(`
            IF OBJECT_ID('dbo.PuestoExtension', 'U') IS NULL
            CREATE TABLE PuestoExtension (
                puesto_id INT NOT NULL,
                extension_id INT NOT NULL,
                CONSTRAINT PK_PuestoExtension PRIMARY KEY (puesto_id, extension_id),
                CONSTRAINT FK_PuestoExtension_Puestos FOREIGN KEY (puesto_id) REFERENCES Puestos(id) ON DELETE CASCADE,
                CONSTRAINT FK_PuestoExtension_Extensions FOREIGN KEY (extension_id) REFERENCES Extensions(id) ON DELETE CASCADE
            )
        `);

        // --- Tabla de Unión Personal-Extensión (PersonalExtension) ---
        // Esta tabla permite una relación muchos-a-muchos entre Personal y Extensiones.
        await request.query(`
            IF OBJECT_ID('dbo.PersonalExtension', 'U') IS NULL
            CREATE TABLE PersonalExtension (
                personal_id INT NOT NULL,
                extension_id INT NOT NULL,
                CONSTRAINT PK_PersonalExtension PRIMARY KEY (personal_id, extension_id),
                CONSTRAINT FK_PersonalExtension_Personal FOREIGN KEY (personal_id) REFERENCES Personal(id) ON DELETE CASCADE,
                CONSTRAINT FK_PersonalExtension_Extensions FOREIGN KEY (extension_id) REFERENCES Extensions(id) ON DELETE CASCADE
            )
        `);
        // --- Tabla de Información Importante (ImportantInfo) ---
        // Crear la tabla 'ImportantInfo' si no existe.
        await request.query(`
            IF OBJECT_ID('dbo.ImportantInfo', 'U') IS NULL
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
            
            // --- OPTIMIZACIÓN DE ARRANQUE ---
            // Solo inicializa/verifica el esquema si la variable de entorno DB_INIT_SCHEMA está en 'true'.
            // Esto evita ejecutar múltiples consultas de verificación en cada reinicio del servidor.
            if (process.env.DB_INIT_SCHEMA === 'true') {
                // Una vez conectados, aseguramos que las tablas estén configuradas.
                await initializeDatabase(pool);

                // Ejecutar las migraciones necesarias. Comenta esto después de la primera ejecución exitosa.
                await runMigrations(pool);
            } else {
                console.log("Arranque rápido: Se omite la verificación del esquema de la base de datos. Para forzarla, inicia con DB_INIT_SCHEMA=true.");
            }

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
 * Ejecuta una serie de migraciones de esquema de forma secuencial.
 * Esto asegura que la base de datos se actualice a la última versión.
 */
async function runMigrations(pool) {
    console.log("Iniciando proceso de migración de esquema...");
    const request = pool.request();

    try {
        // --- Migración 1: Adaptar relación Personal -> Puesto ---
        console.log("Migración 1: Adaptando relación Personal -> Puesto...");

        // Añadir la columna 'puesto_id' a 'Personal' si no existe.
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sys.columns WHERE name = 'puesto_id' AND object_id = OBJECT_ID('dbo.Personal'))
                ALTER TABLE Personal ADD puesto_id INT NULL;
        `);

        // Añadir la clave foránea de Personal a Puestos si no existe.
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_Personal_Puestos')
                ALTER TABLE Personal ADD CONSTRAINT FK_Personal_Puestos FOREIGN KEY (puesto_id) REFERENCES Puestos(id) ON DELETE SET NULL;
        `);

        // --- Migración 2: Corregir restricción UNIQUE en 'Puestos.personal_id' (si existiera de una versión anterior) ---
        // Esta migración es ahora principalmente de limpieza, ya que la columna 'personal_id' se elimina de 'Puestos'.
        // El objetivo es reemplazar una restricción UNIQUE (que solo permite un NULL) por un índice único filtrado (que permite múltiples NULLs).
        console.log("Migración 2: Corrigiendo restricciones antiguas en 'Puestos'...");

        // Buscar y eliminar cualquier restricción UNIQUE incorrecta en la columna 'personal_id' si todavía existe.
        const constraintResult = await request.query(`
            SELECT name FROM sys.objects 
            WHERE type = 'UQ' AND parent_object_id = OBJECT_ID('dbo.Puestos')
            AND COL_NAME(parent_object_id, (SELECT column_id FROM sys.index_columns WHERE object_id = object_id AND index_id = (SELECT index_id FROM sys.indexes WHERE object_id = parent_object_id AND name = objects.name))) = 'personal_id';
        `);

        if (constraintResult.recordset.length > 0) {
            const constraintName = constraintResult.recordset[0].name;
            console.log(`  -> Eliminando restricción UNIQUE obsoleta: ${constraintName}`);
            await request.query(`ALTER TABLE Puestos DROP CONSTRAINT ${constraintName}`);
        }

        // Eliminar la columna 'personal_id' de 'Puestos' si aún existe.
        if ((await request.query("SELECT * FROM sys.columns WHERE name = 'personal_id' AND object_id = OBJECT_ID('dbo.Puestos')")).recordset.length > 0) {
            console.log("  -> Eliminando columna obsoleta 'personal_id' de la tabla 'Puestos'.");
            await request.query("ALTER TABLE Puestos DROP COLUMN personal_id");
        }

        console.log("Proceso de migración de esquema completado con éxito.");

    } catch (err) {
        console.error('Error durante la migración del esquema: ', err);
        throw err;
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
 * Busca personal en la base de datos para la vista pública.
 * La búsqueda es insensible a mayúsculas/minúsculas y a tildes.
 * @param {string} searchTerm - El término de búsqueda normalizado (sin tildes, en minúsculas).
 * @returns {Promise<Array>} - Una lista de personal que coincide con la búsqueda.
 */
async function searchPublicStaff(searchTerm) {
    try {
        const request = getPool().request();
        // El término de búsqueda ya viene normalizado desde el frontend.
        // Añadimos '%' para que funcione como un 'contains'.
        const likeTerm = `%${searchTerm}%`;

        // Usamos COLLATE Latin1_General_CI_AI para que la comparación sea
        // Case-Insensitive (CI) y Accent-Insensitive (AI).
        const query = `
            SELECT 
                p.id, p.nombre, p.correo, p.fotoUrl, p.fecha_nacimiento,
                puesto.name AS puesto,
                depto.name AS departamento, 
                COALESCE(
                    (SELECT STRING_AGG(e.number, ', ') FROM PersonalExtension p_ext JOIN Extensions e ON p_ext.extension_id = e.id WHERE p_ext.personal_id = p.id),
                    (SELECT STRING_AGG(e.number, ', ') FROM PuestoExtension pu_ext JOIN Extensions e ON pu_ext.extension_id = e.id WHERE pu_ext.puesto_id = p.puesto_id)
                ) as extension
            FROM Personal p
            LEFT JOIN Puestos puesto ON p.puesto_id = puesto.id
            LEFT JOIN Departments depto ON puesto.department_id = depto.id
            WHERE 
                (p.nombre COLLATE Latin1_General_CI_AI LIKE @likeTerm) OR
                (puesto.name COLLATE Latin1_General_CI_AI LIKE @likeTerm) OR
                (depto.name COLLATE Latin1_General_CI_AI LIKE @likeTerm) OR
                (p.correo COLLATE Latin1_General_CI_AI LIKE @likeTerm) OR
                EXISTS (
                    SELECT 1 FROM PuestoExtension pe JOIN Extensions e ON pe.extension_id = e.id 
                    WHERE pe.puesto_id = p.puesto_id AND e.number LIKE @likeTerm
                ) OR
                EXISTS (
                    SELECT 1 FROM PersonalExtension p_ext JOIN Extensions e ON p_ext.extension_id = e.id 
                    WHERE p_ext.personal_id = p.id AND e.number LIKE @likeTerm
                )
        `;

        const result = await request.input('likeTerm', sql.NVarChar, likeTerm).query(query);
        return result.recordset;
    } catch (err) {
        console.error('Error al buscar personal:', err);
        throw err;
    }
}

/**
 * Devuelve la instancia del pool de conexiones.
 * Es una función getter para acceder al pool desde otros módulos
 * sin exponer la variable `pool` directamente.
 */
const getPool = () => pool;

/**
 * Exporta las funciones 'connect' y el objeto 'sql'.
 * Esto permite que otros archivos (como server.js) puedan usar la conexión
 * a la base de datos y ejecutar consultas.
 */
module.exports = { connect, close, sql, getPool, getImportantInfo, getImportantInfoById, addImportantInfo, updateImportantInfo, deleteImportantInfo, searchPublicStaff };