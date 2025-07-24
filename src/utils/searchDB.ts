import mongoose from 'mongoose';
import Fuse from 'fuse.js';
import Vehicule from '../models/Vehicule';
import Immobilier from '../models/Immobilier';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/NimmoChatBot';

/**
 * Typo-tolerant, all-fields search for Vehicule or Immobilier.
 * @param {string} type - 'vehicule' or 'immobilier'
 * @param {string} query - The search string
 * @param {number} [limit=5] - Max results to return
 */
export async function searchDB(type: 'vehicule' | 'immobilier', query: string, limit = 5) {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGODB_URI);
  }
  let Model: any, allDocs;
  if (type === 'vehicule') {
    Model = Vehicule;
  } else {
    Model = Immobilier;
  }
  allDocs = await Model.find({}).lean();

  // Prepare fuse.js options to search all fields
  const keys = Object.keys(allDocs[0] || {});
  const fuse = new Fuse(allDocs, {
    keys,
    threshold: 0.4, // typo-tolerance
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const results = fuse.search(query, { limit });
  let matches = results.map(r => r.item as Record<string, any>);

  // If no results, suggest closest matches
  if (matches.length === 0) {
    // Lower threshold for suggestions
    const suggestFuse = new Fuse(allDocs, {
      keys,
      threshold: 0.6,
      ignoreLocation: true,
      minMatchCharLength: 2,
    });
    const suggestions = suggestFuse.search(query, { limit: 3 }).map(r => r.item);
    // Do not disconnect here
    return { matches: [], suggestions };
  }

  // Try to complete missing fields from similar entries
  matches = matches.map(match => {
    match = match as Record<string, any>;
    for (const key of keys) {
      if ((match[key] === undefined || match[key] === null || match[key] === '') && allDocs.length > 1) {
        // Find another doc with same id or similar fields
        const similar = allDocs.find((d: any) => d[key] && d.id !== match.id);
        if (similar) match[key] = similar[key];
      }
    }
    return match;
  });

  // Do not disconnect here
  return { matches, suggestions: [] };
}
