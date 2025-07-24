import { Client, LocalAuth, Message, MessageMedia } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { webSocketService } from './websocketService';
import { getAIResponse, extractUserIntent } from './openaiService';
import UserIntent from '../models/UserIntent';
import { searchDB } from '../utils/searchDB';
import mongoose from 'mongoose';

// WhatsApp client instance
let client: Client;

// Start WhatsApp client
export const startWhatsApp = () => {
  const authDataPath = path.join(__dirname, '../../.wwebjs_auth');
  
  // Ensure auth directory exists
  if (!fs.existsSync(authDataPath)) {
    fs.mkdirSync(authDataPath, { recursive: true });
  }

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: authDataPath,
      clientId: 'nimmobot-whatsapp'
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-extensions',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ],
    },
    webVersion: '2.2402.5',
    webVersionCache: {
      type: 'local'
    }
  });

  // Generate QR code in terminal (only if session is not available)
  client.on('qr', (qr) => {
    console.log('📱 Scan this QR code with WhatsApp to authenticate:');
    qrcode.generate(qr, { small: true });
    console.log('💡 After scanning, the session will be saved for future use.');
    
    // Broadcast QR code to WebSocket clients
    webSocketService.broadcastQR(qr);
  });

  // Ready event - session is authenticated and ready
  client.on('ready', () => {
    console.log('✅ WhatsApp client is ready and authenticated!');
    console.log('💾 Session saved - no need to scan QR code again on restart.');
    
    // Broadcast ready status to WebSocket clients
    webSocketService.broadcastReady();
  });

  // Loading screen event
  client.on('loading_screen', (percent, message) => {
    console.log(`🔄 Loading WhatsApp: ${percent}% - ${message}`);
    
    // Broadcast loading status to WebSocket clients
    webSocketService.broadcastLoading(Number(percent), message);
  });

  // Auth failure
  client.on('auth_failure', (msg) => {
    console.error('❌ Auth failure:', msg);
    console.log('🔄 Please restart the server and scan the QR code again.');
    
    // Broadcast auth failure to WebSocket clients
    webSocketService.broadcastAuthFailure(msg);
  });

  // Disconnected
  client.on('disconnected', (reason) => {
    console.warn('⚠️ WhatsApp client disconnected:', reason);
    console.log('🔄 Attempting to reconnect...');
    
    // Broadcast disconnection to WebSocket clients
    webSocketService.broadcastDisconnected(reason);
  });

  // Listen for incoming messages
  client.on('message', async (message: Message) => {
    // Ensure MongoDB is connected before any DB operation
    if (mongoose.connection.readyState !== 1) {
      const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nimmobot';
      console.log('[DEBUG] Connecting to MongoDB before handling message...');
      await mongoose.connect(mongoURI);
      console.log('[DEBUG] MongoDB connected.');
    }
    // Ignore status updates (messages from status@broadcast)
    if (message.from === 'status@broadcast') {
      console.log('📊 Ignoring status update');
      return;
    }
    
    // Ignore group messages (messages that contain @g.us)
    if (message.from.includes('@g.us')) {
      console.log('👥 Ignoring group message');
      return;
    }
    
    console.log(`📩 Received message from ${message.from}: ${message.body}`);
    
    // Broadcast incoming message to WebSocket clients
    webSocketService.broadcastMessage(message.from, message.body);
    
    try {
      // 1. Extract intent from message and chat history
      const intent = await extractUserIntent(message.from, message.body);
      let userIntent = await UserIntent.findOne({ userId: message.from });
      if (!userIntent) {
        userIntent = await UserIntent.create({ userId: message.from, ...intent, status: 'collecting', lastUpdated: new Date() });
      } else {
        // Merge new info
        if (intent.service) userIntent.service = intent.service;
        if (intent.town) userIntent.town = intent.town;
        if (intent.budget) userIntent.budget = intent.budget;
        if (intent.type) userIntent.type = intent.type;
        if (intent.language) userIntent.language = intent.language;
        userIntent.lastUpdated = new Date();
        await userIntent.save();
      }
      // Declare userIntentObj and lang here so they are available below
      const userIntentObj = userIntent.toObject ? userIntent.toObject() : userIntent;
      const lang = userIntentObj.language || 'fr';
      console.log('[DEBUG] userIntent:', JSON.stringify(userIntentObj, null, 2));

      // 1. Detect if the user is refusing the last proposal or asking for other options
      let isRefusal = false;
      try {
        const refusalCheckPrompt = `You are an assistant. The following message is from a user in a WhatsApp chat. Does the message indicate that the user is refusing, not interested in, or asking for other options/propositions/alternatives to the previous proposal? Reply with only 'yes' or 'no'.\n\nMessage: ${message.body}`;
        const refusalCheck = await extractOpenAIReply(refusalCheckPrompt);
        isRefusal = refusalCheck.trim().toLowerCase().startsWith('y');
      } catch {}

      // 1. Detect if the user is interested in a specific offer
      let interestedIndex: number | null = null;
      try {
        if (userIntentObj.lastProposedIds && userIntentObj.lastProposedIds.length > 0) {
          const interestPrompt = `You are an assistant. The following message is from a user in a WhatsApp chat. The last options proposed had these IDs: [${userIntentObj.lastProposedIds.join(', ')}]. If the user is showing interest in one of the options, reply ONLY with the index (starting from 1) of the option they are interested in. If not, reply with 'none'.\n\nMessage: ${message.body}`;
          const interestCheck = await extractOpenAIReply(interestPrompt);
          const idx = parseInt(interestCheck.trim(), 10);
          if (!isNaN(idx) && idx >= 1 && idx <= userIntentObj.lastProposedIds.length) {
            interestedIndex = idx - 1;
          }
        }
      } catch {}

      // 2. If user is interested in an offer, send each offer as a separate message and try to convince
      if (interestedIndex !== null && userIntentObj.lastProposedIds && userIntentObj.lastProposedIds.length > 0) {
        const offerIds = userIntentObj.lastProposedIds;
        const Model: mongoose.Model<any> = userIntentObj.type === 'vehicule'
          ? (await import('../models/Vehicule')).default
          : (await import('../models/Immobilier')).default;
        const offers = await Model.find({ id: { $in: offerIds } }).lean();
        const lang = userIntentObj.language || 'fr';
        // Send each offer as a separate message
        for (const offer of offers) {
          const productLink = `https://nimmo-auto.com/fr/produit/view/${offer.id}`;
          let offerMsg = '';
          if (lang === 'fr') {
            offerMsg = `🏷️ *${offer.nom || offer.modeleFr || offer.CategorieFr}*\n💰 Prix: ${offer.prix?.toLocaleString()} FCFA\n📍 Lieu: ${offer.localisationFr || offer.villeFr || ''}\n🛏️ Chambres: ${offer.chambre ?? '-'}\n🚿 Douches: ${offer.douche ?? '-'}\n📏 Superficie: ${offer.superficie ? offer.superficie + ' m²' : '-'}\n📝 Description: ${offer.description || '-'}\n🔗 Voir le produit: ${productLink}\n`;
          } else {
            offerMsg = `🏷️ *${offer.nom || offer.modeleEn || offer.CategorieEn}*\n💰 Price: ${offer.prix?.toLocaleString()} FCFA\n📍 Location: ${offer.localisationEn || offer.villeEn || ''}\n🛏️ Bedrooms: ${offer.chambre ?? '-'}\n🚿 Bathrooms: ${offer.douche ?? '-'}\n📏 Area: ${offer.superficie ? offer.superficie + ' m²' : '-'}\n📝 Description: ${offer.description || '-'}\n🔗 View product: ${productLink}\n`;
          }
          await client.sendMessage(message.from, offerMsg);
        }
        // Send a persuasive message for the selected offer
        const selectedOffer = offers[interestedIndex];
        if (selectedOffer) {
          const convincePrompt = `You are a friendly WhatsApp assistant. Here are the details of an offer the user is interested in:\n${JSON.stringify(selectedOffer, null, 2)}\n\nWrite a persuasive, friendly message in ${lang === 'fr' ? 'French' : 'English'} to convince the user to buy or take action. Highlight the benefits and make it sound appealing, but do not be pushy.`;
          const convinceMsg = await extractOpenAIReply(convincePrompt);
          await client.sendMessage(message.from, convinceMsg);
        }
        return;
      }

      // 2. If all info is present, search DB and generate a human-like reply
      if (userIntentObj.service && userIntentObj.town && userIntentObj.budget && userIntentObj.type) {
        userIntent.status = 'ready';
        await userIntent.save();
        // Search DB
        // Build a more precise search string using localisationFr and town
        let searchString = '';
        if (userIntentObj.localisationFr) {
          searchString = userIntentObj.localisationFr;
        } else if (userIntentObj.town) {
          searchString = userIntentObj.town;
        }
        if (userIntentObj.service) searchString += ` ${userIntentObj.service}`;
        if (userIntentObj.budget) searchString += ` ${userIntentObj.budget}`;
        console.log('[DEBUG] searchString:', searchString.trim());
        let { matches, suggestions } = await searchDB(userIntentObj.type, searchString.trim());
        // If refusal, filter out previously proposed options
        const lastIds = Array.isArray(userIntentObj.lastProposedIds) ? userIntentObj.lastProposedIds : [];
        if (isRefusal && lastIds.length > 0) {
          matches = matches.filter(m => !lastIds.includes(m.id));
          suggestions = suggestions.filter((s: any) => !lastIds.includes(s.id));
        }
        // Pick up to 5 new options to propose
        const toPropose = matches.slice(0, 5);
        // Update lastProposedIds
        userIntent.lastProposedIds = (userIntent.lastProposedIds || []).concat(toPropose.map(m => m.id));
        await userIntent.save();
        // Use OpenAI to generate a human-like reply
        let replyPrompt = `You are a friendly WhatsApp assistant. Here are the search results for the user's request (service: ${userIntentObj.service}, town: ${userIntentObj.town}, budget: ${userIntentObj.budget} FCFA):\n\n`;
        if (toPropose.length > 0) {
          // Send an intro message first
          let introMsg = '';
          if (lang === 'fr') {
            introMsg = `Bonjour! Voici les meilleures options pour votre recherche de ${userIntentObj.service} à ${userIntentObj.town} avec un budget de ${userIntentObj.budget?.toLocaleString()} FCFA :`;
          } else {
            introMsg = `Hello! Here are the best options for your search for ${userIntentObj.service} in ${userIntentObj.town} with a budget of ${userIntentObj.budget?.toLocaleString()} FCFA:`;
          }
          await client.sendMessage(message.from, introMsg);
          // Send each offer as a separate message (with image if available)
          for (const offer of toPropose) {
            console.log('Sending offer:', JSON.stringify(offer, null, 2));
            let offerMsg = '';
            const productLink = `https://nimmo-auto.com/fr/produit/view/${offer.id}`;
            if (lang === 'fr') {
              offerMsg = `🏷️ *${offer.nom || offer.modeleFr || offer.CategorieFr}*\n💰 Prix: ${offer.prix?.toLocaleString()} FCFA\n📍 Lieu: ${offer.localisationFr || offer.villeFr || ''}\n🛏️ Chambres: ${offer.chambre ?? '-'}\n🚿 Douches: ${offer.douche ?? '-'}\n📏 Superficie: ${offer.superficie ? offer.superficie + ' m²' : '-'}\n📝 Description: ${offer.description || '-'}\n🔗 Voir le produit: ${productLink}\n`;
            } else {
              offerMsg = `🏷️ *${offer.nom || offer.modeleEn || offer.CategorieEn}*\n💰 Price: ${offer.prix?.toLocaleString()} FCFA\n📍 Location: ${offer.localisationEn || offer.villeEn || ''}\n🛏️ Bedrooms: ${offer.chambre ?? '-'}\n🚿 Bathrooms: ${offer.douche ?? '-'}\n📏 Area: ${offer.superficie ? offer.superficie + ' m²' : '-'}\n📝 Description: ${offer.description || '-'}\n🔗 View product: ${productLink}\n`;
            }
            const imageField = offer.image1 || offer.image2 || offer.image3 || offer.image4 || offer.image5;
            const imageUrl = `https://nimmo-auto.com/content/cache/gallery/uploads/produit/${imageField}`;;
            console.log('imageUrl', imageUrl);
            console.log("imageField",imageField)
            if (imageUrl) {
              try {
                console.log('[DEBUG] Attempting to send image for offer.');
                console.log('[DEBUG] Built image URL:', imageUrl);
                // Download the image to a temp file
                const tempFilePath = path.join(__dirname, '../../tmp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8) + '.jpg');
                console.log('[DEBUG] Downloading image to:', tempFilePath);
                const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
                console.log('[DEBUG] Image downloaded, writing to file...');
                fs.writeFileSync(tempFilePath, response.data);
                console.log('[DEBUG] File written, preparing MessageMedia...');
                const media = MessageMedia.fromFilePath(tempFilePath);
                console.log('[DEBUG] Sending WhatsApp image with caption...');
                await client.sendMessage(message.from, media, { caption: offerMsg });
                console.log('[DEBUG] Image sent, cleaning up temp file.');
                fs.unlinkSync(tempFilePath); // Clean up temp file
                console.log('[DEBUG] Temp file deleted.');
              } catch (err) {
                console.log('[ERROR] Failed to download/send image for offer:', imageUrl, err);
                console.log('Ignoring image for offer (failed to load or send):', imageUrl);
                await client.sendMessage(message.from, offerMsg);
              }
            } else {
              console.log('[DEBUG] No valid image for offer, sending text only.');
              console.log('Ignoring image for offer (no valid image):', imageField);
              await client.sendMessage(message.from, offerMsg);
            }
          }
          // Only send the closing message, not the OpenAI summary
          let closingMsg = lang === 'fr'
            ? "N'hésitez pas à me dire si l'une de ces offres vous intéresse !"
            : "Let me know if you're interested in any of these offers!";
          await client.sendMessage(message.from, closingMsg);
          return;
        } else if (suggestions.length > 0) {
          replyPrompt += `No exact matches found. Here are some similar options:\n${JSON.stringify(suggestions, null, 2)}\n\nWrite a short, friendly message to the user suggesting these alternatives. Also ask if they want to try searching in a different town or location. Reply in ${lang === 'fr' ? 'French' : 'English'}.`;
        } else {
          replyPrompt += `No results found. Write a short, friendly message apologizing and asking if the user wants to try a different search. Reply in ${lang === 'fr' ? 'French' : 'English'}.`;
        }
        const completion = await extractOpenAIReply(replyPrompt);
        await client.sendMessage(message.from, completion);
      } else {
        // 3. If info is missing, use OpenAI to ask for it conversationally
        let missing = [];
        if (!userIntentObj.service) missing.push(lang === 'fr' ? 'le service ou le type de produit' : 'service or type of product');
        if (!userIntentObj.town) missing.push(lang === 'fr' ? 'la ville' : 'town or city');
        if (!userIntentObj.budget) missing.push(lang === 'fr' ? 'le budget' : 'budget');
        const askPrompt = `You are a friendly WhatsApp assistant. The user is looking for something, but you still need: ${missing.join(', ')}. Write a short, friendly, conversational message asking for this info. Do not bombard the user with questions; ask naturally and reference previous context if possible. Reply in ${lang === 'fr' ? 'French' : 'English'}.`;
        const completion = await extractOpenAIReply(askPrompt);
        await client.sendMessage(message.from, completion);
      }
    } catch (err) {
      console.error('Failed to process user intent and reply:', err);
      try {
        await client.sendMessage(message.from, 'Sorry, I\'m having trouble responding right now. Please try again later.');
      } catch (fallbackErr) {
        console.error('Failed to send fallback response:', fallbackErr);
      }
    }
  });

  console.log('🚀 Initializing WhatsApp client...');
  client.initialize();
};

// Check if session exists
export const hasValidSession = (): boolean => {
  const authDataPath = path.join(__dirname, '../../.wwebjs_auth');
  return fs.existsSync(authDataPath) && fs.readdirSync(authDataPath).length > 0;
};

// Get client status
export const getClientStatus = () => {
  if (!client) return 'not_initialized';
  return client.pupPage ? 'connected' : 'disconnected';
};

// Send a WhatsApp message (with delay to avoid ban)
export const sendWhatsAppMessage = async (to: string, message: string) => {
  if (!client) throw new Error('WhatsApp client not initialized');
  
  // Check if client is ready
  if (!client.pupPage) {
    throw new Error('WhatsApp client is not ready. Please wait for authentication.');
  }
  
  // Add a delay to avoid spamming (best practice)
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return client.sendMessage(to, message);
};

// Clear session (use with caution)
export const clearSession = () => {
  const authDataPath = path.join(__dirname, '../../.wwebjs_auth');
  if (fs.existsSync(authDataPath)) {
    fs.rmSync(authDataPath, { recursive: true, force: true });
    console.log('🗑️ Session cleared. You will need to scan QR code again.');
  }
}; 

// Helper to get a human-like reply from OpenAI
async function extractOpenAIReply(prompt: string): Promise<string> {
  const openai = (await import('openai')).default;
  const client = new openai({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await client.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'You are a helpful WhatsApp assistant.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 200,
    temperature: 0.7,
  });
  return completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
} 