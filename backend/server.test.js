const request = require('supertest');
const bcrypt = require('bcrypt');
const { app, server, io } = require('./server');
const { sql, connect } = require('./db');

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
    await sql.query`INSERT INTO Users (username, password, role) VALUES (${testUser.username}, ${hashedPassword}, ${testUser.role})`;
  });

  // Hook para limpiar la BD y cerrar conexiones después de las pruebas
  afterAll(async () => {
    try {
      await sql.query`DELETE FROM Users WHERE username = ${testUser.username}`;
    } catch (err) {
      console.error("No se pudo limpiar el usuario de prueba:", err);
    }
    await sql.close();
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
      const result = await sql.query`SELECT id FROM Personal WHERE correo = ${newStaffMember.correo}`;
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
      const result = await sql.query`SELECT nombre, puesto FROM Personal WHERE id = ${newStaffId}`;
      expect(result.recordset[0].nombre).toBe(updatedData.nombre);
      expect(result.recordset[0].puesto).toBe(updatedData.puesto);
    });

    it('debería ELIMINAR el miembro del personal recién creado', async () => {
      expect(newStaffId).toBeDefined();

      await agent
        .delete(`/api/personal/${newStaffId}`)
        .expect(200);

      // Opcional pero recomendado: verificar que ya no está en la BD
      const result = await sql.query`SELECT * FROM Personal WHERE id = ${newStaffId}`;
      expect(result.recordset.length).toBe(0);
    });
  });
});
