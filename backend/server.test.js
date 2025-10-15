const request = require('supertest');
const bcrypt = require('bcrypt');
const { app, io } = require('./server');
const { sql, connect, close, getPool } = require('./db');

jest.setTimeout(20000); // Aumentar el tiempo de espera global para las pruebas

describe('Endpoints de la API', () => {

  const testUser = {
    username: `testuser_${Date.now()}`, // Usuario único para evitar conflictos
    password: 'password123',
    role: 'admin'
  };

  // Hook para configurar la BD y crear un usuario de prueba
  beforeAll(async () => {
    await connect();
    const hashedPassword = await bcrypt.hash(testUser.password, 10);
    const pool = getPool();
    await pool.request()
        .input('username', sql.NVarChar, testUser.username)
        .input('password', sql.NVarChar, hashedPassword)
        .input('role', sql.NVarChar, testUser.role)
        .query('INSERT INTO Users (username, password, role) VALUES (@username, @password, @role)');
  });

  // Hook para limpiar la BD y cerrar conexiones después de las pruebas
  afterAll(async () => {
    const pool = getPool();
    await pool.request().input('username', sql.NVarChar, testUser.username).query('DELETE FROM Users WHERE username = @username');
    await close();
    io.close();
  });

  // --- Pruebas Públicas ---
  describe('Endpoints Públicos', () => {
    it('debería obtener el conteo total del personal', async () => {
      const response = await request(app)
        .get('/api/public/personal/count')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('total');
      expect(typeof response.body.total).toBe('number');
    });
  });

  // --- Pruebas de Autenticación y Seguridad ---
  describe('Seguridad y Autenticación', () => {
    it('debería denegar el acceso a una ruta protegida sin un token', async () => {
      await request(app)
        .get('/api/personal') // Ruta protegida
        .expect(401); // Esperamos "No Autorizado"
    });

    it('debería denegar el login con una contraseña incorrecta', async () => {
      await request(app)
        .post('/api/login')
        .send({
          username: testUser.username,
          password: 'passwordincorrecto'
        })
        .expect(401); // Esperamos "No Autorizado"
    });

    it('debería permitir el login con credenciales correctas y establecer una cookie de autenticación', async () => {
      const response = await request(app)
        .post('/api/login')
        .send({
          username: testUser.username,
          password: testUser.password
        })
        .expect(200); // Esperamos "OK"

      // Verificar que la cabecera 'set-cookie' existe y contiene nuestro token
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies.some(cookie => cookie.startsWith('authToken='))).toBe(true);
    });
  });

  // --- Pruebas CRUD de Personal (Rutas Protegidas) ---
  describe('CRUD de Personal', () => {
    const agent = request.agent(app); // Usar un agente para mantener la sesión (cookies)
    let newStaffId;

    beforeAll(async () => {
      // Iniciar sesión una vez para todas las pruebas de este bloque
      await agent
        .post('/api/login')
        .send({
          username: testUser.username,
          password: testUser.password
        });
    });

    it('debería CREAR un nuevo miembro del personal', async () => {
      const newStaffMember = {
        nombre: 'Personal de Prueba',
        puesto: 'Tester',
        departamento: 'Calidad',
        correo: `test.${Date.now()}@test.com`,
        extension: '123'
      };

      const response = await agent // Usar el agente autenticado
        .post('/api/personal')
        .send(newStaffMember)
        .expect(201); // 201 Created

      // Dado que la API no devuelve el ID, lo buscamos en la BD para usarlo en las siguientes pruebas
      const pool = getPool();
      const result = await pool.request().input('correo', sql.NVarChar, newStaffMember.correo).query('SELECT id FROM Personal WHERE correo = @correo');
      expect(result.recordset.length).toBe(1);
      newStaffId = result.recordset[0].id;
    });

    it('debería ACTUALIZAR el miembro del personal recién creado', async () => {
      expect(newStaffId).toBeDefined(); // Asegurarse de que la prueba anterior nos dio un ID

      const updatedData = {
        nombre: 'Personal de Prueba (Actualizado)',
        puesto: 'Senior Tester'
      };

      await agent
        .put(`/api/personal/${newStaffId}`)
        .send(updatedData)
        .expect(200);

      // Opcional pero recomendado: verificar que el cambio se reflejó en la BD
      const pool = getPool();
      const result = await pool.request().input('id', sql.Int, newStaffId).query('SELECT nombre, puesto FROM Personal WHERE id = @id');
      expect(result.recordset[0].nombre).toBe(updatedData.nombre);
      expect(result.recordset[0].puesto).toBe(updatedData.puesto);
    });

    it('debería ELIMINAR el miembro del personal recién creado', async () => {
      expect(newStaffId).toBeDefined();

      await agent
        .delete(`/api/personal/${newStaffId}`)
        .expect(200);

      // Opcional pero recomendado: verificar que ya no está en la BD
      const pool = getPool();
      const result = await pool.request().input('id', sql.Int, newStaffId).query('SELECT * FROM Personal WHERE id = @id');
      expect(result.recordset.length).toBe(0);
    });
  });
});
