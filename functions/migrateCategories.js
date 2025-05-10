const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();
const materialsRef = db.collection('materials');

async function migrateCategories() {
  const snapshot = await materialsRef.get();
  const batch = db.batch();

  snapshot.forEach(doc => {
    const data = doc.data();
    if (typeof data.categories === 'string') {
      batch.update(doc.ref, {
        categories: [data.categories],
      });
    }
  });

  await batch.commit();
  console.log('Migration of categories completed');
}

migrateCategories().catch(console.error);