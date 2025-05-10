const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors');
const { onRequest } = require('firebase-functions/v2/https');
const fs = require('fs');

// Загружаем настройки CORS из cors.json
let corsConfig;
try {
  corsConfig = JSON.parse(fs.readFileSync('cors.json', 'utf8'));
  if (!corsConfig || !Array.isArray(corsConfig) || !corsConfig[0] || !corsConfig[0].origin) {
    throw new Error('Invalid cors.json configuration');
  }
  functions.logger.info('CORS configuration loaded successfully');
} catch (error) {
  functions.logger.error('Failed to load cors.json', {
    message: error.message,
    stack: error.stack,
  });
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

// Настройка CORS
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
  exposedHeaders: corsConfig[0].responseHeader || ['Content-Type', 'Access-Control-Allow-Origin'],
  optionsSuccessStatus: 204,
  maxAge: corsConfig[0].maxAgeSeconds || 600,
};

const corsMiddleware = cors(corsOptions);

// Инициализация Firebase Admin
try {
  admin.initializeApp();
  functions.logger.info('Firebase Admin initialized successfully');
} catch (error) {
  functions.logger.error('Firebase Admin initialization failed', {
    message: error.message,
    stack: error.stack,
  });
  throw new Error('Firebase Admin initialization failed');
}

const db = admin.firestore();

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

/**
 * Логирует событие в Firestore.
 * @param {string} event - Название события.
 * @param {string} userId - ID пользователя.
 * @param {string} ip - IP-адрес клиента.
 * @param {Object} [extra] - Дополнительные данные для лога.
 */
async function logToFirestore(event, userId, ip, extra = {}) {
  try {
    await db.collection('analytics').add({
      event,
      userId: userId || 'unauthenticated',
      ip: ip || 'unknown',
      page_title: 'Balcony Calculator',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ...extra,
    });
  } catch (firestoreError) {
    functions.logger.warn('Failed to log to Firestore', {
      event,
      message: firestoreError.message,
      stack: firestoreError.stack,
    });
  }
}

/**
 * Middleware для проверки аутентификации.
 * @param {Object} req - HTTP-запрос.
 * @param {Object} res - HTTP-ответ.
 * @param {Function} next - Следующий middleware.
 */
async function authenticateRequest(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    functions.logger.error('Authentication failed: No token provided', {
      headers: req.headers,
      ip: req.ip,
      authToken: '[missing]',
    });
    await logToFirestore('authentication_failed', 'unauthenticated', req.ip, {
      message: 'No token provided',
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
    await logToFirestore('authentication_success', decodedToken.uid, req.ip, {
      email: decodedToken.email || 'unknown',
    });
    return next();
  } catch (error) {
    functions.logger.error('Authentication failed', {
      message: error.message,
      stack: error.stack,
      ip: req.ip,
      authToken: '[provided]',
    });
    await logToFirestore('authentication_failed', 'unauthenticated', req.ip, {
      message: error.message,
      authToken: '[provided]',
    });
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

/**
 * Эндпоинт для управления материалами.
 */
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
      const startTime = Date.now();
      const ip = req.ip || 'unknown';
      const body = req.body || {};

      functions.logger.info('Received request for manageMaterials', {
        method: req.method,
        body,
        headers: req.headers,
        ip,
        timestamp: new Date().toISOString(),
        authToken: req.headers.authorization ? '[provided]' : '[missing]',
      });

      try {
        if (req.method === 'OPTIONS') {
          functions.logger.info('Handling OPTIONS request for manageMaterials', { ip });
          await logToFirestore('options_request', 'unauthenticated', ip, {
            endpoint: 'manageMaterials',
          });
          return res.status(204).send('');
        }

        if (req.method !== 'POST') {
          functions.logger.error('Method not allowed', {
            method: req.method,
            ip,
            authToken: req.headers.authorization ? '[provided]' : '[missing]',
          });
          await logToFirestore('method_not_allowed', 'unauthenticated', ip, {
            endpoint: 'manageMaterials',
            method: req.method,
          });
          return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
        }

        await authenticateRequest(req, res, async () => {
          const { action, category, page, itemsPerPage, key, data } = body;
          if (!action || typeof action !== 'string') {
            functions.logger.error('No action specified in request body', {
              body,
              userId: req.user.uid,
              ip,
              authToken: req.headers.authorization ? '[provided]' : '[missing]',
            });
            await logToFirestore('invalid_request', req.user.uid, ip, {
              endpoint: 'manageMaterials',
              error: 'Action is required and must be a string',
            });
            return res
              .status(400)
              .json({ success: false, error: 'Action is required and must be a string' });
          }

          functions.logger.info('Processing action', {
            action,
            userId: req.user.uid,
            ip,
            authToken: req.headers.authorization ? '[provided]' : '[missing]',
          });

          req.userId = req.user.uid;
          req.authToken = req.headers.authorization;

          const actions = {
            getMaterials: async () => {
              const pageNum = parseInt(page) || 0;
              const items = parseInt(itemsPerPage) || 100;
              if (pageNum < 0 || items <= 0) {
                functions.logger.error('Invalid pagination parameters', {
                  page,
                  itemsPerPage,
                  userId: req.userId,
                  ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                await logToFirestore('invalid_request', req.userId, ip, {
                  endpoint: 'manageMaterials',
                  action: 'getMaterials',
                  error: 'Invalid pagination parameters',
                });
                return res
                  .status(400)
                  .json({ success: false, error: 'Invalid pagination parameters' });
              }
              const result = await getMaterials(
                category,
                pageNum,
                items,
                req.authToken,
                req.userId
              );
              await logToFirestore(
                result.success ? 'action_processed' : 'action_failed',
                req.userId,
                ip,
                {
                  endpoint: 'manageMaterials',
                  action: 'getMaterials',
                  success: result.success,
                  error: result.error || null,
                  duration: `${Date.now() - startTime}ms`,
                }
              );
              return res.status(200).json(result);
            },
            getMaterial: async () => {
              if (!key || typeof key !== 'string') {
                functions.logger.error('Key is required and must be a string for getMaterial', {
                  key,
                  userId: req.userId,
                  ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                await logToFirestore('invalid_request', req.userId, ip, {
                  endpoint: 'manageMaterials',
                  action: 'getMaterial',
                  error: 'Key is required and must be a string',
                });
                return res
                  .status(400)
                  .json({ success: false, error: 'Key is required and must be a string' });
              }
              const result = await getMaterial(key, req.authToken, req.userId);
              await logToFirestore(
                result.success ? 'action_processed' : 'action_failed',
                req.userId,
                ip,
                {
                  endpoint: 'manageMaterials',
                  action: 'getMaterial',
                  success: result.success,
                  error: result.error || null,
                  duration: `${Date.now() - startTime}ms`,
                }
              );
              return res.status(result.success ? 200 : 404).json(result);
            },
            getCategories: async () => {
              const pageNum = parseInt(page) || 0;
              const items = parseInt(itemsPerPage) || 50;
              if (pageNum < 0 || items <= 0) {
                functions.logger.error('Invalid pagination parameters', {
                  page,
                  itemsPerPage,
                  userId: req.userId,
                  ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                await logToFirestore('invalid_request', req.userId, ip, {
                  endpoint: 'manageMaterials',
                  action: 'getCategories',
                  error: 'Invalid pagination parameters',
                });
                return res
                  .status(400)
                  .json({ success: false, error: 'Invalid pagination parameters' });
              }
              const result = await getCategories(pageNum, items, req.authToken, req.userId);
              await logToFirestore(
                result.success ? 'action_processed' : 'action_failed',
                req.userId,
                ip,
                {
                  endpoint: 'manageMaterials',
                  action: 'getCategories',
                  success: result.success,
                  error: result.error || null,
                  duration: `${Date.now() - startTime}ms`,
                }
              );
              return res.status(result.success ? 200 : 500).json(result);
            },
            addMaterial: async () => {
              if (!data || typeof data !== 'object') {
                functions.logger.error('Data is required and must be an object for addMaterial', {
                  data,
                  userId: req.userId,
                  ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                await logToFirestore('invalid_request', req.userId, ip, {
                  endpoint: 'manageMaterials',
                  action: 'addMaterial',
                  error: 'Data is required and must be an object',
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
                  userId: req.userId,
                  ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                await logToFirestore('invalid_request', req.userId, ip, {
                  endpoint: 'manageMaterials',
                  action: 'addMaterial',
                  error: validation.error,
                });
                return res.status(400).json({ success: false, error: validation.error });
              }
              const result = await addMaterial(data, req.authToken, req.userId);
              await logToFirestore(
                result.success ? 'action_processed' : 'action_failed',
                req.userId,
                ip,
                {
                  endpoint: 'manageMaterials',
                  action: 'addMaterial',
                  success: result.success,
                  error: result.error || null,
                  duration: `${Date.now() - startTime}ms`,
                }
              );
              return res.status(result.success ? 200 : 400).json(result);
            },
            deleteMaterial: async () => {
              if (!key || typeof key !== 'string') {
                functions.logger.error('Key is required and must be a string for deleteMaterial', {
                  key,
                  userId: req.userId,
                  ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                await logToFirestore('invalid_request', req.userId, ip, {
                  endpoint: 'manageMaterials',
                  action: 'deleteMaterial',
                  error: 'Key is required and must be a string',
                });
                return res
                  .status(400)
                  .json({ success: false, error: 'Key is required and must be a string' });
              }
              const result = await deleteMaterial(key, req.authToken, req.userId);
              await logToFirestore(
                result.success ? 'action_processed' : 'action_failed',
                req.userId,
                ip,
                {
                  endpoint: 'manageMaterials',
                  action: 'deleteMaterial',
                  success: result.success,
                  error: result.error || null,
                  duration: `${Date.now() - startTime}ms`,
                }
              );
              return res.status(result.success ? 200 : 404).json(result);
            },
            editMaterial: async () => {
              if (!data || typeof data !== 'object') {
                functions.logger.error('Data is required and must be an object for editMaterial', {
                  data,
                  userId: req.userId,
                  ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                await logToFirestore('invalid_request', req.userId, ip, {
                  endpoint: 'manageMaterials',
                  action: 'editMaterial',
                  error: 'Data is required and must be an object',
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
                  userId: req.userId,
                  ip,
                  authToken: req.authToken ? '[provided]' : '[missing]',
                });
                await logToFirestore('invalid_request', req.userId, ip, {
                  endpoint: 'manageMaterials',
                  action: 'editMaterial',
                  error: validation.error,
                });
                return res.status(400).json({ success: false, error: validation.error });
              }
              const result = await editMaterial(data, req.authToken, req.userId);
              await logToFirestore(
                result.success ? 'action_processed' : 'action_failed',
                req.userId,
                ip,
                {
                  endpoint: 'manageMaterials',
                  action: 'editMaterial',
                  success: result.success,
                  error: result.error || null,
                  duration: `${Date.now() - startTime}ms`,
                }
              );
              return res.status(result.success ? 200 : 400).json(result);
            },
          };

          if (actions[action]) {
            return await actions[action]();
          } else {
            functions.logger.error('Invalid action', {
              action,
              userId: req.userId,
              ip,
              authToken: req.authToken ? '[provided]' : '[missing]',
            });
            await logToFirestore('invalid_request', req.userId, ip, {
              endpoint: 'manageMaterials',
              action,
              error: 'Invalid action',
            });
            return res.status(400).json({ success: false, error: 'Invalid action' });
          }
        });
      } catch (error) {
        functions.logger.error('Error in manageMaterials', {
          action: body.action || 'unknown',
          message: error.message,
          stack: error.stack,
          userId: req.user?.uid || 'unauthenticated',
          ip,
          duration: `${Date.now() - startTime}ms`,
          authToken: req.headers.authorization ? '[provided]' : '[missing]',
        });
        await logToFirestore('request_failed', req.user?.uid || 'unauthenticated', ip, {
          endpoint: 'manageMaterials',
          action: body.action || 'unknown',
          error: error.message,
          duration: `${Date.now() - startTime}ms`,
        });
        return res.status(500).json({ success: false, error: `Server error: ${error.message}` });
      }
    });
  }
);

/**
 * Эндпоинт для расчёта материалов.
 */
exports.calculateMaterials = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 120,
    memory: '512MB',
    maxInstances: 10,
    maxBodySize: '1mb',
  },
  async (req, res) => {
    corsMiddleware(req, res, async () => {
      const startTime = Date.now();
      const ip = req.ip || 'unknown';
      const body = req.body || {};

      functions.logger.info('Received request for calculateMaterials', {
        method: req.method,
        body,
        headers: req.headers,
        ip,
        timestamp: new Date().toISOString(),
        authToken: req.headers.authorization ? '[provided]' : '[missing]',
      });

      try {
        if (req.method === 'OPTIONS') {
          functions.logger.info('Handling OPTIONS request for calculateMaterials', { ip });
          await logToFirestore('options_request', 'unauthenticated', ip, {
            endpoint: 'calculateMaterials',
          });
          return res.status(204).send('');
        }

        if (req.method !== 'POST') {
          functions.logger.error('Method not allowed', {
            method: req.method,
            ip,
            authToken: req.headers.authorization ? '[provided]' : '[missing]',
          });
          await logToFirestore('method_not_allowed', 'unauthenticated', ip, {
            endpoint: 'calculateMaterials',
            method: req.method,
          });
          return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
        }

        await authenticateRequest(req, res, async () => {
          const { tabName, data } = body;
          if (!tabName || !data || typeof tabName !== 'string' || typeof data !== 'object') {
            functions.logger.error('Invalid request body for calculateMaterials', {
              tabName,
              data,
              userId: req.user.uid,
              ip,
              authToken: req.headers.authorization ? '[provided]' : '[missing]',
            });
            await logToFirestore('invalid_request', req.user.uid, ip, {
              endpoint: 'calculateMaterials',
              error:
                'tabName and data are required and must be a string and an object respectively',
            });
            return res.status(400).json({
              success: false,
              error:
                'tabName and data are required and must be a string and an object respectively',
            });
          }

          req.userId = req.user.uid;
          req.authToken = req.headers.authorization;

          const result = await computeMaterials(req);
          functions.logger.info('calculateMaterials result', {
            result,
            userId: req.userId,
            ip,
            duration: `${Date.now() - startTime}ms`,
            authToken: req.authToken ? '[provided]' : '[missing]',
          });

          await logToFirestore(
            result.success ? 'action_processed' : 'action_failed',
            req.userId,
            ip,
            {
              endpoint: 'calculateMaterials',
              action: 'computeMaterials',
              success: result.success,
              error: result.error || null,
              tabName,
              totalCost: result.totalCost || null,
              resultsCount: result.results ? result.results.length : 0,
              duration: `${Date.now() - startTime}ms`,
            }
          );

          return res.status(result.success ? 200 : 400).json(result);
        });
      } catch (error) {
        functions.logger.error('Error in calculateMaterials', {
          message: error.message,
          stack: error.stack,
          userId: req.user?.uid || 'unauthenticated',
          ip,
          duration: `${Date.now() - startTime}ms`,
          authToken: req.headers.authorization ? '[provided]' : '[missing]',
        });
        await logToFirestore('request_failed', req.user?.uid || 'unauthenticated', ip, {
          endpoint: 'calculateMaterials',
          action: 'computeMaterials',
          error: error.message,
          duration: `${Date.now() - startTime}ms`,
        });
        return res.status(500).json({ success: false, error: `Server error: ${error.message}` });
      }
    });
  }
);
