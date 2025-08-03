const mongoose = require('mongoose');
require('dotenv').config();

async function clearAllChats() {
  try {
    // Connect to MongoDB
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nimmobot';
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB');

    // Define the ChatHistory schema and model
    const ChatHistorySchema = new mongoose.Schema({
      userId: { type: String, required: true, index: true },
      role: { type: String, enum: ['user', 'assistant'], required: true },
      content: { type: String, required: true },
      timestamp: { type: Date, default: Date.now, index: true },
    });
    const ChatHistory = mongoose.model('ChatHistory', ChatHistorySchema);

    // Define the UserIntent schema and model
    const UserIntentSchema = new mongoose.Schema({
      userId: { type: String, required: true, unique: true, index: true },
      service: { type: String },
      town: { type: String },
      budget: { type: Number },
      type: { type: String, enum: ['vehicule', 'immobilier'] },
      language: { type: String, enum: ['fr', 'en'] },
      lastProposedIds: [{ type: Number }],
      status: { type: String, enum: ['collecting', 'ready'], default: 'collecting' },
      lastUpdated: { type: Date, default: Date.now },
      localisationFr: { type: String },
      localisationEn: { type: String },
    });
    const UserIntent = mongoose.model('UserIntent', UserIntentSchema);

    // Clear all chat history
    const result = await ChatHistory.deleteMany({});
    console.log(`🗑️ Cleared ${result.deletedCount} chat history records`);
    
    // Also clear UserIntent collection to reset user states
    const intentResult = await UserIntent.deleteMany({});
    console.log(`🗑️ Cleared ${intentResult.deletedCount} user intent records`);

    console.log('✅ All chats and user intents cleared successfully!');
    
  } catch (error) {
    console.error('❌ Error clearing chats:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run the function
clearAllChats(); 