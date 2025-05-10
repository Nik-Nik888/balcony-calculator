const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors');
const { onRequest } = require('firebase-functions/v2/https');
const fs = require('fs');

// Загружаем настройки CORS из cors.json
let corsConfig;
try {
  corsConfig = JSON.parse(fs.readFileSync('cors.json', 'utf8'));
} catch (error) {
  console.error('Failed to load cors.json:', error.message);
  corsConfig = [
    {
      origin: [
        'https://balconycalculator-15c42.web.app',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
      ],
      method: ['POST', 'OPTIONS'],
      responseHeader: ['Content-Type', 'Access-Control-Allow-Origin'],
      maxAgeSeconds: 600,
    },
  ];
}

// Настройка CORS с динамическим origin
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = corsConfig[0].origin;
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      functions.logger.error('CORS error: Origin not allowed', { origin });
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  methods: corsConfig[0].method || ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: corsConfig[0].responseHeader || [
    'Content-Type',
    'Access-Control-Allow-Origin',
  ],
  optionsSuccessStatus: 204,
  maxAge: corsConfig[0].maxAgeSeconds || 600,
};

const corsMiddleware = cors(corsOptions);

// Инициализация Firebase Admin
try {
  admin.initializeApp();
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Failed to initialize Firebase Admin:', error.message);
  functions.logger.error('Firebase Admin initialization failed', {
    error: error.message,
    stack: error.stack,
  });
  throw new Error('Firebase Admin initialization failed');
}

// Импорты из модулей
const {
  getMaterials,
  getMaterial,
  getCategories,
  addMaterial,
  deleteMaterial,
  editMaterial,
  validateMaterialData,
} = require('./modules/materialsManager');
const computeMaterials = require('./modules/calculateMaterials');

// Middleware для проверки аутентификации
const authenticateRequest = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    functions.logger.error('Authentication failed: No token provided', {
      headers: req.headers,
      ip: req.ip,
      authToken: '[missing]',
    });
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    functions.logger.info('User authenticated', {
      userId: decodedToken.uid,
      email: decodedToken.email || 'unknown',
      ip: req.ip,
      authToken: '[provided]',
    });
    return next();
  } catch (error) {
    functions.logger.error('Authentication failed', {
      error: error.message,
      stack: error.stack,
      ip: req.ip,
      authToken: '[provided]',
    });
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

// Эндпоинт для управления материалами
exports.manageMaterials = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MB',
    maxInstances: 10,
    maxBodySize: '1mb',
  },
  async (req, res) => {
    corsMiddleware(req, res, async () => {
      // Обработка OPTIONS-запроса для CORS
      if (req.method === 'OPTIONS') {
        functions.logger.info('Handling OPTIONS request for manageMaterials', {
          ip: req.ip,
        });
        // Логируем в Firestore для аналитики
        await db.collection('analytics').add({
          event: 'options_request',
          endpoint: 'manageMaterials',
          ip: req.ip,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.status(204).send('');
      }

      // Логируем начало обработки запроса
      const startTime = Date.now();
      functions.logger.info('Received request for manageMaterials', {
        method: req.method,
        body: req.body,
        headers: req.headers,
        ip: req.ip,
        timestamp: new Date().toISOString(),
        authToken: req.headers.authorization ? '[provided]' : '[missing]',
      });

      try {
        // Проверка метода запроса
        if (req.method !== 'POST') {
          functions.logger.error('Method not allowed', {
            method: req.method,
            ip: req.ip,
            authToken: req.headers.authorization ? '[provided]' : '[missing]',
          });
          return res
            .status(405)
            .json({ success: false, error: 'Method not allowed. Use POST.' });
        }

        // Проверка размера тела запроса через Content-Length
        const contentLength = parseInt(req.headers['content-length'] || '0', 10);
        if (contentLength > 1000000) {
          // 1MB в байтах
          functions.logger.error('Request body too large', {
            size: contentLength,
            ip: req.ip,
            authToken: req.headers.authorization ? '[provided]' : '[missing]',
          });
          return res.status(413).json({ success: false, error: 'Request body too large' });
        }

        // Применяем middleware аутентификации
        await authenticateRequest(req, res, async () => {
          const { action, category, page, itemsPerPage, key, data } = req.body;
          if (!action || typeof action !== 'string') {
            functions.logger.error('No action specified in request body', {
              body: req.body,
              userId: req.user.uid,
              ip: req.ip,
              authToken: req.headers.authorization ? '[provided]' : '[missing]',
            });
            return res
              .status(400)
              .json({ success: false, error: 'Action is required and must be a string' });
          }

          functions.logger.info('Processing action', {
            action,
            userId: req.user.uid,
            ip: req.ip,
            authToken: req.headers.authorization ? '[provided]' : '[missing]',
          });

          // Добавляем userId и authToken в объект запроса для передачи в модули
          req.userId = req.user.uid;
          req.authToken = req.headers.authorization;

          // Маршрутизация действий через объект
          const actions = {
            getMaterials: async () => {
              const pageNum = parseInt(page) || 0;
              const items = parseInt(itemsPerPage) || 100;
              if (pageNum < 0 || items <= 0) {
                functions.logger.error('Invalid pagination parameters', {
                  page,
                  itemsPerPage,
                  userId: req.user.uid,
                  ip: req.ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                return res
                  .status(400)
                  .json({ success: false, error: 'Invalid pagination parameters' });
              }
              const result = await getMaterials(category, pageNum, items, req.authToken, req.userId);
              // Логируем в Firestore для аналитики
              await db.collection('analytics').add({
                event: result.success ? 'action_processed' : 'action_failed',
                endpoint: 'manageMaterials',
                action: 'getMaterials',
                userId: req.userId,
                success: result.success,
                error: result.error || null,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
              });
              return res.status(200).json(result);
            },
            getMaterial: async () => {
              if (!key || typeof key !== 'string') {
                functions.logger.error('Key is required and must be a string for getMaterial', {
                  key,
                  userId: req.user.uid,
                  ip: req.ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                return res
                  .status(400)
                  .json({ success: false, error: 'Key is required and must be a string' });
              }
              const result = await getMaterial(key, req.authToken, req.userId);
              // Логируем в Firestore для аналитики
              await db.collection('analytics').add({
                event: result.success ? 'action_processed' : 'action_failed',
                endpoint: 'manageMaterials',
                action: 'getMaterial',
                userId: req.userId,
                success: result.success,
                error: result.error || null,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
              });
              return res.status(result.success ? 200 : 404).json(result);
            },
            getCategories: async () => {
              const pageNum = parseInt(page) || 0;
              const items = parseInt(itemsPerPage) || 50;
              if (pageNum < 0 || items <= 0) {
                functions.logger.error('Invalid pagination parameters', {
                  page,
                  itemsPerPage,
                  userId: req.user.uid,
                  ip: req.ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                return res
                  .status(400)
                  .json({ success: false, error: 'Invalid pagination parameters' });
              }
              const result = await getCategories(pageNum, items, req.authToken, req.userId);
              // Логируем в Firestore для аналитики
              await db.collection('analytics').add({
                event: result.success ? 'action_processed' : 'action_failed',
                endpoint: 'manageMaterials',
                action: 'getCategories',
                userId: req.userId,
                success: result.success,
                error: result.error || null,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
              });
              return res.status(result.success ? 200 : 500).json(result);
            },
            addMaterial: async () => {
              if (!data || typeof data !== 'object') {
                functions.logger.error('Data is required and must be an object for addMaterial', {
                  data,
                  userId: req.user.uid,
                  ip: req.ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                return res
                  .status(400)
                  .json({ success: false, error: 'Data is required and must be an object' });
              }
              const validation = validateMaterialData(data);
              if (!validation.success) {
                functions.logger.error('Invalid material data', {
                  error: validation.error,
                  data,
                  userId: req.user.uid,
                  ip: req.ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                return res.status(400).json({ success: false, error: validation.error });
              }
              const result = await addMaterial(data, req.authToken, req.userId);
              // Логируем в Firestore для аналитики
              await db.collection('analytics').add({
                event: result.success ? 'action_processed' : 'action_failed',
                endpoint: 'manageMaterials',
                action: 'addMaterial',
                userId: req.userId,
                success: result.success,
                error: result.error || null,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
              });
              return res.status(result.success ? 200 : 400).json(result);
            },
            deleteMaterial: async () => {
              if (!key || typeof key !== 'string') {
                functions.logger.error('Key is required and must be a string for deleteMaterial', {
                  key,
                  userId: req.user.uid,
                  ip: req.ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                return res
                  .status(400)
                  .json({ success: false, error: 'Key is required and must be a string' });
              }
              const result = await deleteMaterial(key, req.authToken, req.userId);
              // Логируем в Firestore для аналитики
              await db.collection('analytics').add({
                event: result.success ? 'action_processed' : 'action_failed',
                endpoint: 'manageMaterials',
                action: 'deleteMaterial',
                userId: req.userId,
                success: result.success,
                error: result.error || null,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
              });
              return res.status(result.success ? 200 : 404).json(result);
            },
            editMaterial: async () => {
              if (!data || typeof data !== 'object') {
                functions.logger.error('Data is required and must be an object for editMaterial', {
                  data,
                  userId: req.user.uid,
                  ip: req.ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                return res
                  .status(400)
                  .json({ success: false, error: 'Data is required and must be an object' });
              }
              const validation = validateMaterialData(data);
              if (!validation.success) {
                functions.logger.error('Invalid material data', {
                  error: validation.error,
                  data,
                  userId: req.user.uid,
                  ip: req.ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                return res.status(400).json({ success: false, error: validation.error });
              }
              const result = await editMaterial(data, req.authToken, req.userId);
              // Логируем в Firestore для аналитики
              await db.collection('analytics').add({
                event: result.success ? 'action_processed' : 'action_failed',
                endpoint: 'manageMaterials',
                action: 'editMaterial',
                userId: req.userId,
                success: result.success,
                error: result.error || null,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
              });
              return res.status(result.success ? 200 : 400).json(result);
            },
          };

          // Выполняем соответствующее действие
          if (actions[action]) {
            return await actions[action]();
          } else {
            functions.logger.error('Invalid action', {
              action,
              userId: req.user.uid,
              ip: req.ip,
              authToken: req.authToken ? '[provided]' : '[missing]',
            });
            return res.status(400).json({ success: false, error: 'Invalid action' });
          }
        });
      } catch (error) {
        functions.logger.error('Error in manageMaterials', {
          action: req.body.action || 'unknown',
          message: error.message,
          stack: error.stack,
          userId: req.user?.uid || 'unauthenticated',
          ip: req.ip,
          duration: `${Date.now() - startTime}ms`,
          authToken: req.headers.authorization ? '[provided]' : '[missing]',
        });
        // Логируем ошибку в Firestore для аналитики
        await db.collection('analytics').add({
          event: 'request_failed',
          endpoint: 'manageMaterials',
          action: req.body.action || 'unknown',
          userId: req.user?.uid || 'unauthenticated',
          error: error.message,
          ip: req.ip,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.status(500).json({ success: false, error: `Server error: ${error.message}` });
      }
    });
  },
);

// Эндпоинт для расчета материалов
exports.calculateMaterials = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 120, // Увеличено для сложных расчётов
    memory: '512MB', // Увеличено для обработки больших запросов
    maxInstances: 10,
    maxBodySize: '1mb',
  },
  async (req, res) => {
    corsMiddleware(req, res, async () => {
      // Обработка OPTIONS-запроса для CORS
      if (req.method === 'OPTIONS') {
        functions.logger.info('Handling OPTIONS request for calculateMaterials', {
          ip: req.ip,
        });
        // Логируем в Firestore для аналитики
        await db.collection('analytics').add({
          event: 'options_request',
          endpoint: 'calculateMaterials',
          ip: req.ip,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.status(204).send('');
      }

      // Логируем начало обработки запроса
      const startTime = Date.now();
      functions.logger.info('Received request for calculateMaterials', {
        method: req.method,
        body: req.body,
        headers: req.headers,
        ip: req.ip,
        timestamp: new Date().toISOString(),
        authToken: req.headers.authorization ? '[provided]' : '[missing]',
      });

      try {
        // Проверка метода запроса
        if (req.method !== 'POST') {
          functions.logger.error('Method not allowed', {
            method: req.method,
            ip: req.ip,
            authToken: req.headers.authorization ? '[provided]' : '[missing]',
          });
          return res
            .status(405)
            .json({ success: false, error: 'Method not allowed. Use POST.' });
        }

        // Проверка размера тела запроса через Content-Length
        const contentLength = parseInt(req.headers['content-length'] || '0', 10);
        if (contentLength > 1000000) {
          // 1MB в байтах
          functions.logger.error('Request body too large', {
            size: contentLength,
            ip: req.ip,
            authToken: req.headers.authorization ? '[provided]' : '[missing]',
          });
          return res.status(413).json({ success: false, error: 'Request body too large' });
        }

        // Применяем middleware аутентификации
        await authenticateRequest(req, res, async () => {
          // Валидация тела запроса
          const { tabName, data } = req.body;
          if (!tabName || !data || typeof tabName !== 'string' || typeof data !== 'object') {
            functions.logger.error('Invalid request body for calculateMaterials', {
              tabName,
              data,
              userId: req.user.uid,
              ip: req.ip,
              authToken: req.headers.authorization ? '[provided]' : '[missing]',
            });
            return res.status(400).json({
              success: false,
              error: 'tabName and data are required and must be a string and an object respectively',
            });
          }

          // Добавляем userId и authToken в объект запроса для передачи в модули
          req.userId = req.user.uid;
          req.authToken = req.headers.authorization;

          const result = await computeMaterials(req);
          functions.logger.info('calculateMaterials result', {
            result,
            userId: req.user.uid,
            ip: req.ip,
            duration: `${Date.now() - startTime}ms`,
            authToken: req.authToken ? '[provided]' : '[missing]',
          });

          // Логируем в Firestore для аналитики
          await db.collection('analytics').add({
            event: result.success ? 'action_processed' : 'action_failed',
            endpoint: 'calculateMaterials',
            action: 'computeMaterials',
            userId: req.userId,
            tabName: tabName,
            success: result.success,
            error: result.error || null,
            totalCost: result.totalCost || null,
            resultsCount: result.results ? result.results.length : 0,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });

          // Проверяем успешность выполнения
          if (result.success) {
            return res.status(200).json(result);
          } else {
            return res.status(400).json(result);
          }
        });
      } catch (error) {
        functions.logger.error('Error in calculateMaterials', {
          message: error.message,
          stack: error.stack,
          userId: req.user?.uid || 'unauthenticated',
          ip: req.ip,
          duration: `${Date.now() - startTime}ms`,
          authToken: req.headers.authorization ? '[provided]' : '[missing]',
        });
        // Логируем ошибку в Firestore для аналитики
        await db.collection('analytics').add({
          event: 'request_failed',
          endpoint: 'calculateMaterials',
          userId: req.user?.uid || 'unauthenticated',
          error: error.message,
          ip: req.ip,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.status(500).json({ success: false, error: `Server error: ${error.message}` });
      }
    });
  },
);