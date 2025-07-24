import axios from 'axios';
import mongoose from 'mongoose';
import Immobilier from '../models/Immobilier';
import Vehicule from '../models/Vehicule';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/NimmoChatBot';

async function fetchAndStore() {
  await mongoose.connect(MONGODB_URI);

  // --- VEHICULES ---
  try {
    const vehiculesRes = await axios.get('https://nimmo-auto.com/api/v1/produits/vehicule/all');
    const vehicules = vehiculesRes.data.result || [];
    for (const v of vehicules) {
      const exists = await Vehicule.exists({ id: v.id });
      if (!exists) {
        await Vehicule.create({
          ...v,
          annee: v.annee ?? null,
          fetchedAt: new Date()
        });
        console.log(`Added new vehicule: ${v.id}`);
      }
    }
  } catch (err) {
    console.error('Error fetching/storing vehicules:', err);
  }

  // --- IMMOBILIER ---
  try {
    const immRes = await axios.get('https://nimmo-auto.com/api/v1/produits/immobilier/all');
    const immobiliers = immRes.data.result || [];
    for (const im of immobiliers) {
      const exists = await Immobilier.exists({ id: im.id });
      if (!exists) {
        await Immobilier.create({
          ...im,
          placeassise: im.placeassise ?? 0,
          douche: im.douche ?? 0,
          fetchedAt: new Date()
        });
        console.log(`Added new immobilier: ${im.id}`);
      }
    }
  } catch (err) {
    console.error('Error fetching/storing immobiliers:', err);
  }

  await mongoose.disconnect();
}

// Only run if called directly
if (require.main === module) {
  fetchAndStore().then(() => {
    console.log('DB fill complete');
    process.exit(0);
  });
}

export default fetchAndStore;
