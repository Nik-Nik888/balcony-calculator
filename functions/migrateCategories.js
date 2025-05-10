const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Инициализация Firebase Admin SDK
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
const materialsRef = db.collection('materials');

/**
 * Логирует событие в Firestore.
 * @param {Object} db - Инстанс Firestore.
 * @param {string} event - Название события.
 * @param {string} userId - ID пользователя.
 * @param {string} ip - IP-адрес клиента.
 * @param {Object} [extra] - Дополнительные данные для лога.
 */
async function logToFirestore(db, event, userId, ip, extra = {}) {
  try {
    await db.collection('analytics').add({
      event,
      userId: userId || 'unauthenticated',
      ip: ip || 'unknown',
      page_title: 'Balcony Calculator - Migration',
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
 * Миграция строкового поля categories в массив.
 * @param {Object} req - HTTP-запрос.
 * @param {Object} res - HTTP-ответ.
 */
async function migrateCategories(req, res) {
  const startTime = Date.now();
  const userId = req.body.userId || req.user?.uid || 'unauthenticated';
  const ip = req.ip || 'unknown';

  functions.logger.info('Starting category migration', { userId, ip });

  try {
    const snapshot = await materialsRef.get();
    const batch = db.batch();
    let updatedCount = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      if (typeof data.categories === 'string') {
        batch.update(doc.ref, {
          categories: [data.categories],
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        updatedCount++;
      }
    });

    if (updatedCount === 0) {
      functions.logger.info('No categories need migration', { userId, ip });
      await logToFirestore(db, 'category_migration_noop', userId, ip, {
        duration: `${Date.now() - startTime}ms`,
      });
      return res.status(200).send('No categories need migration');
    }

    await batch.commit();
    functions.logger.info('Category migration completed', {
      updatedCount,
      duration: `${Date.now() - startTime}ms`,
      userId,
      ip,
    });

    await logToFirestore(db, 'category_migration_completed', userId, ip, {
      updated_count: updatedCount,
      duration: `${Date.now() - startTime}ms`,
    });

    return res.status(200).send(`Migration completed: ${updatedCount} documents updated`);
  } catch (error) {
    functions.logger.error('Error during category migration', {
      message: error.message,
      stack: error.stack,
      userId,
      ip,
      duration: `${Date.now() - startTime}ms`,
    });

    await logToFirestore(db, 'category_migration_failed', userId, ip, {
      error: error.message,
      duration: `${Date.now() - startTime}ms`,
    });

    return res.status(500).send(`Error: ${error.message}`);
  }
}

exports.migrateCategories = functions.https.onRequest(migrateCategories);
