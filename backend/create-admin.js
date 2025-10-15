/**
 * Script para crear un usuario administrador en la base de datos.
 *
 * USO:
 * 1. Abre una terminal en la carpeta 'backend' y ejecuta: node create-admin.js <username>
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const bcrypt = require('bcrypt');
const { connect, getPool, close, sql } = require('./db');
const { registerSchema } = require('./validation'); // Importar el esquema de validación
const readline = require('readline');

// Lee el usuario y la contraseña de los argumentos de la línea de comandos.
const usernameArg = process.argv[2];
// La contraseña se pedirá de forma interactiva por seguridad.

// ---------------------
const createAdminUser = async () => {
    let pool; // Definir pool en un alcance más amplio

    try {
        if (!usernameArg) {
            console.error('Error: Debes proporcionar un nombre de usuario.');
            console.error("Uso: node create-admin.js <username>");
            return;
        }

        const password = await askPassword();
        if (!password) {
            console.error('Error: La contraseña no puede estar vacía.');
            return;
        }

        const newAdmin = {
            username: usernameArg,
            password: password,
            role: 'admin'
        };

        // Validar los datos del nuevo admin con el esquema de Joi
        const { error } = registerSchema.validate({ username: newAdmin.username, password: newAdmin.password, role: newAdmin.role }, { abortEarly: false });
        if (error) {
            console.error('Error: Los datos del administrador no son válidos.');
            error.details.forEach(detail => console.error(`- ${detail.message}`));
            return;
        }

        console.log('Conectando a la base de datos...');
        await connect();
        pool = getPool(); // Asignar al pool ya conectado

        console.log(`Verificando si el usuario '${newAdmin.username}' ya existe...`);
        const userExists = await pool.request().input('username', sql.NVarChar, newAdmin.username).query('SELECT id FROM Users WHERE username = @username');

        if (userExists.recordset.length > 0) {
            console.log(`El usuario '${newAdmin.username}' ya existe. No se creará uno nuevo.`);
        } else {
            console.log('El usuario no existe, procediendo a crearlo...');
            console.log('Encriptando contraseña...');
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(newAdmin.password, saltRounds);

            console.log('Insertando nuevo administrador en la base de datos...');
            await pool.request()
                .input('username', sql.NVarChar, newAdmin.username)
                .input('password', sql.NVarChar, hashedPassword)
                .input('role', sql.NVarChar, newAdmin.role)
                .query('INSERT INTO Users (username, password, role) VALUES (@username, @password, @role)');

            console.log(`\n¡Éxito! El usuario administrador '${newAdmin.username}' ha sido creado.`);
            console.log('Ahora puedes iniciar sesión en la página de administración con las credenciales que proporcionaste.');
        }

    } catch (error) {
        console.error('\nError al crear el usuario administrador:', error.message);
    } finally {
        if (pool && pool.connected) {
            console.log('Cerrando conexión a la base de datos...');
            await close().catch(err => console.error('Error al cerrar la conexión:', err));
        }
    }
};

/**
 * Pide la contraseña de forma segura sin mostrarla en la terminal.
 * @returns {Promise<string>} La contraseña introducida por el usuario.
 */
function askPassword() {
    return new Promise(resolve => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question('Introduce la contraseña para el administrador: ', (pass) => {
            rl.close();
            console.log(); // Nueva línea para limpiar la salida
            resolve(pass);
        });

        // Silenciar la salida mientras se escribe la contraseña (compatible con más terminales)
        const stdout = process.stdout;
        rl._writeToOutput = function _writeToOutput(stringToWrite) {
            if (stringToWrite.match(/[\r\n]/)) {
                stdout.write(stringToWrite);
            }
        };
    });
}

createAdminUser();