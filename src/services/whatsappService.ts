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
    
    // Handle voice messages by transcribing them
    if (message.hasMedia && message.type === 'ptt') {
      try {
        console.log('[DEBUG] Voice message detected, transcribing...');
        
        // Download the voice message
        const media = await message.downloadMedia();
        if (!media) {
          console.log('[ERROR] Failed to download voice message');
          await client.sendMessage(message.from, 'Désolé, je n\'ai pas pu traiter votre message vocal. Pouvez-vous réessayer ou envoyer un message texte ?');
          return;
        }

        // Save the voice message temporarily
        const tempFilePath = path.join(__dirname, '../../temp_voice_' + Date.now() + '.ogg');
        fs.writeFileSync(tempFilePath, media.data, 'base64');

        // Transcribe using OpenAI Whisper
        const transcription = await transcribeVoiceMessage(tempFilePath);
        
        // Clean up temp file
        fs.unlinkSync(tempFilePath);

        if (transcription) {
          console.log('[DEBUG] Voice transcribed:', transcription);
          // Replace the message body with the transcription
          message.body = transcription;
        } else {
          console.log('[ERROR] Failed to transcribe voice message');
          await client.sendMessage(message.from, 'Désolé, je n\'ai pas pu comprendre votre message vocal. Pouvez-vous réessayer ou envoyer un message texte ?');
          return;
        }
      } catch (error) {
        console.error('[ERROR] Error processing voice message:', error);
        await client.sendMessage(message.from, 'Désolé, une erreur s\'est produite lors du traitement de votre message vocal. Pouvez-vous envoyer un message texte ?');
        return;
      }
    }
    
    console.log(`📩 Received message from ${message.from}: ${message.body}`);
    
    // Broadcast incoming message to WebSocket clients
    webSocketService.broadcastMessage(message.from, message.body);
    
    try {
      // 1. Extract intent from message and chat history
      const intent = await extractUserIntent(message.from, message.body);
      let userIntent = await UserIntent.findOne({ userId: message.from });
      let isNewUser = false;
      
      if (!userIntent) {
        userIntent = await UserIntent.create({ userId: message.from, ...intent, status: 'collecting', lastUpdated: new Date() });
        isNewUser = true;
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
      
      // Send introduction message for new users
      if (isNewUser) {
        const lang = intent.language || 'fr';
        let introMessage = '';
        if (lang === 'fr') {
          introMessage = `🤖 *Bonjour! Je suis NimmoBot, l'assistant virtuel de Nimmo Auto.*\n\nJe suis là pour vous aider à trouver rapidement les meilleures offres de véhicules et d'immobilier. Je peux vous proposer des options personnalisées selon vos besoins.\n\n*Comment puis-je vous aider aujourd'hui?*\n\n💡 Dites-moi ce que vous cherchez (véhicule ou immobilier), votre ville préférée et votre budget.`;
        } else {
          introMessage = `🤖 *Hello! I'm NimmoBot, the virtual assistant of Nimmo Auto.*\n\nI'm here to help you quickly find the best vehicle and real estate offers. I can suggest personalized options based on your needs.\n\n*How can I help you today?*\n\n💡 Tell me what you're looking for (vehicle or real estate), your preferred city and budget.`;
        }
        await client.sendMessage(message.from, introMessage);
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
            // First, try to detect if this is a reply to a specific message
            const messageLower = message.body.toLowerCase();
            const interestKeywords = [
              'celle ci', 'celui ci', 'celle-ci', 'celui-ci', // French
              'this one', 'that one', 'this', 'that', // English
              'je veux', 'i want', 'je prends', 'i take', // Want/take
              'je choisis', 'i choose', 'je sélectionne', 'i select', // Choose/select
              'ok', 'd\'accord', 'alright', 'yes', 'oui', // Agreement
              'parfait', 'perfect', 'super', 'great' // Positive
            ];
            
            const isReply = message.hasQuotedMsg || 
                           interestKeywords.some(keyword => messageLower.includes(keyword));
            
            console.log('[DEBUG] Interest detection:', {
              message: message.body,
              messageLower,
              hasQuotedMsg: message.hasQuotedMsg,
              interestKeywords: interestKeywords.filter(keyword => messageLower.includes(keyword)),
              isReply,
              lastProposedIds: userIntentObj.lastProposedIds
            });
            
            if (isReply && userIntentObj.lastProposedIds.length === 1) {
              // If it's a reply and there's only one offer, assume they're interested in that one
              interestedIndex = 0;
              console.log('[DEBUG] Detected reply to single offer, setting interestedIndex to 0');
            } else if (isReply && userIntentObj.lastProposedIds.length > 1) {
              // Use AI to detect which offer they're interested in
              const interestPrompt = `You are an assistant analyzing a WhatsApp message. The user has been shown ${userIntentObj.lastProposedIds.length} options and is responding to them.

IMPORTANT: Look for expressions of interest like:
- "je veux celui ci" (I want this one)
- "je choisis cette option" (I choose this option) 
- "celle ci" or "celui ci" (this one)
- "ok", "parfait", "super" (agreement)
- "je prends" (I take)
- Any positive response indicating selection

CRITICAL: If the user says "je veux celui ci" or "this one", they are referring to the LAST option shown (usually the most recent one). In most cases, this means option ${userIntentObj.lastProposedIds.length}.

If the user is showing interest in one of the options, reply ONLY with the index (starting from 1) of the option they are interested in. If they are not showing interest, reply with 'none'.

Message: "${message.body}"
Number of options: ${userIntentObj.lastProposedIds.length}

Reply with only the number or 'none':`;
          const interestCheck = await extractOpenAIReply(interestPrompt);
          const idx = parseInt(interestCheck.trim(), 10);
          if (!isNaN(idx) && idx >= 1 && idx <= userIntentObj.lastProposedIds.length) {
            interestedIndex = idx - 1;
                console.log('[DEBUG] AI detected interestedIndex:', interestedIndex);
              } else {
                // Fallback: if user says "celui ci" or "this one", default to the last offer
                const messageLower = message.body.toLowerCase();
                if (messageLower.includes('celui ci') || messageLower.includes('celle ci') || 
                    messageLower.includes('this one') || messageLower.includes('that one')) {
                  interestedIndex = userIntentObj.lastProposedIds.length - 1;
                  console.log('[DEBUG] Fallback: defaulting to last offer (index:', interestedIndex, ')');
                }
              }
            }
        }
      } catch (error) {
        console.error('[DEBUG] Error detecting interest:', error);
      }

      // 2. If user is interested in an offer, collect their information
      if (interestedIndex !== null && userIntentObj.lastProposedIds && userIntentObj.lastProposedIds.length > 0) {
        const offerIds = userIntentObj.lastProposedIds;
        const Model: mongoose.Model<any> = userIntentObj.type === 'vehicule'
          ? (await import('../models/Vehicule')).default
          : (await import('../models/Immobilier')).default;
        const offers = await Model.find({ id: { $in: offerIds } }).lean();
        const lang = userIntentObj.language || 'fr';
        
        // Get the selected offer
        const selectedOffer = offers[interestedIndex];
        console.log('[DEBUG] Selected offer details:', {
          interestedIndex,
          offerIds,
          selectedOfferId: selectedOffer?.id,
          selectedOfferName: selectedOffer?.nom,
          selectedOfferPrice: selectedOffer?.prix,
          selectedOfferLocation: selectedOffer?.localisationFr || selectedOffer?.villeFr,
          allOffers: offers.map((offer: any, idx: number) => ({
            index: idx,
            id: offer.id,
            name: offer.nom || offer.modeleFr || offer.CategorieFr,
            price: offer.prix,
            location: offer.localisationFr || offer.villeFr
          }))
        });
        
        if (selectedOffer) {
          // Check if this is a rental intent
          const isRental = userIntentObj.service?.toLowerCase().includes('location') || 
                          userIntentObj.service?.toLowerCase().includes('louer') ||
                          userIntentObj.service?.toLowerCase().includes('rent') ||
                          selectedOffer.CategorieFr?.toLowerCase().includes('location') ||
                          selectedOffer.description?.toLowerCase().includes('location') ||
                          selectedOffer.description?.toLowerCase().includes('louer');
          
          // Store the selected offer ID in user intent
          userIntent.selectedOfferId = selectedOffer.id;
          userIntent.selectedOfferDetails = selectedOffer;
          userIntent.status = 'collecting_info';
          userIntent.requestType = isRental ? 'rental' : 'purchase';
          await userIntent.save();
          
          // Extract phone number from JID
          const phoneNumber = message.from.replace('@c.us', '');
          
          // Send confirmation and start asking for information one by one
          let confirmationMsg = '';
          if (lang === 'fr') {
            confirmationMsg = `Excellent choix ! 🎉\n\nVous avez sélectionné : *${selectedOffer.nom || selectedOffer.modeleFr || selectedOffer.CategorieFr}*\n💰 Prix: ${selectedOffer.prix?.toLocaleString()} FCFA\n📍 Lieu: ${selectedOffer.localisationFr || selectedOffer.villeFr || ''}\n\nVotre numéro de téléphone (${phoneNumber}) a été automatiquement enregistré.\n\nPour finaliser votre demande, j'ai besoin de quelques informations. Commençons par votre nom et prénom :`;
          } else {
            confirmationMsg = `Excellent choice! 🎉\n\nYou have selected: *${selectedOffer.nom || selectedOffer.modeleEn || selectedOffer.CategorieEn}*\n💰 Price: ${selectedOffer.prix?.toLocaleString()} FCFA\n📍 Location: ${selectedOffer.localisationEn || selectedOffer.villeEn || ''}\n\nYour phone number (${phoneNumber}) has been automatically recorded.\n\nTo finalize your request, I need some information. Let's start with your first and last name:`;
          }
          await client.sendMessage(message.from, confirmationMsg);
        }
        return;
      }

      // 3. If user is in collecting_info status, extract their information
      if (userIntentObj.status === 'collecting_info') {
        const lang = userIntentObj.language || 'fr';
        
        // Extract phone number from JID
        const phoneNumber = message.from.replace('@c.us', '');
        
        // Check if this is a rental request (use the same logic as above)
        const isRental = userIntentObj.service?.toLowerCase().includes('location') || 
                        userIntentObj.service?.toLowerCase().includes('louer') ||
                        userIntentObj.service?.toLowerCase().includes('rent') ||
                        userIntentObj.selectedOfferDetails?.CategorieFr?.toLowerCase().includes('location') ||
                        userIntentObj.selectedOfferDetails?.description?.toLowerCase().includes('location') ||
                        userIntentObj.selectedOfferDetails?.description?.toLowerCase().includes('louer');
        
        // Extract user information from the message
        const userInfo = await extractUserInfo(message.body, lang, isRental);
        console.log('[DEBUG] Extracted user info:', userInfo);
        
        // Merge with existing user info
        const existingUserInfo = userIntentObj.userInfo || {};
        console.log('[DEBUG] Existing user info:', existingUserInfo);
        
        const mergedUserInfo = {
          ...existingUserInfo,
          ...userInfo,
          telephone: phoneNumber // Always update phone number from JID
        };
        console.log('[DEBUG] Merged user info:', mergedUserInfo);
        
        // Check what the next field to ask for is
        const nextField = getNextFieldToAsk(mergedUserInfo, isRental, lang);
        console.log('[DEBUG] Next field to ask:', nextField);
        
        if (nextField === null) {
          // All information is complete
          userIntent.userInfo = mergedUserInfo;
          userIntent.status = 'ready';
          await userIntent.save();
          
          // Send confirmation and next steps
          let confirmationMsg = '';
          if (lang === 'fr') {
            if (isRental) {
              confirmationMsg = `Parfait ! ✅\n\n*Informations reçues :*\n• Nom: ${mergedUserInfo.nom || 'Non spécifié'}\n• Prénom: ${mergedUserInfo.prenom || 'Non spécifié'}\n• Téléphone: ${phoneNumber}\n• Ville: ${mergedUserInfo.villeActuelle || 'Non spécifiée'}\n• Email: ${mergedUserInfo.email || 'Non spécifié'}\n• Nombre de jours: ${mergedUserInfo.nombreJours || 'Non spécifié'}\n• Date de début: ${mergedUserInfo.dateDebut || 'Non spécifiée'}\n\nVotre demande de location a été enregistrée. Un membre de notre équipe vous contactera dans les plus brefs délais pour finaliser votre réservation.\n\nMerci de votre confiance ! 🙏`;
            } else {
              confirmationMsg = `Parfait ! ✅\n\n*Informations reçues :*\n• Nom: ${mergedUserInfo.nom || 'Non spécifié'}\n• Prénom: ${mergedUserInfo.prenom || 'Non spécifié'}\n• Téléphone: ${phoneNumber}\n• Ville: ${mergedUserInfo.villeActuelle || 'Non spécifiée'}\n\nVotre demande a été enregistrée. Un membre de notre équipe vous contactera dans les plus brefs délais pour finaliser votre réservation.\n\nMerci de votre confiance ! 🙏`;
            }
          } else {
            if (isRental) {
              confirmationMsg = `Perfect! ✅\n\n*Information received:*\n• Name: ${mergedUserInfo.nom || 'Not specified'}\n• First name: ${mergedUserInfo.prenom || 'Not specified'}\n• Phone: ${phoneNumber}\n• City: ${mergedUserInfo.villeActuelle || 'Not specified'}\n• Email: ${mergedUserInfo.email || 'Not specified'}\n• Number of days: ${mergedUserInfo.nombreJours || 'Not specified'}\n• Start date: ${mergedUserInfo.dateDebut || 'Not specified'}\n\nYour rental request has been recorded. A member of our team will contact you shortly to finalize your booking.\n\nThank you for your trust! 🙏`;
            } else {
              confirmationMsg = `Perfect! ✅\n\n*Information received:*\n• Name: ${mergedUserInfo.nom || 'Not specified'}\n• First name: ${mergedUserInfo.prenom || 'Not specified'}\n• Phone: ${phoneNumber}\n• City: ${mergedUserInfo.villeActuelle || 'Not specified'}\n\nYour request has been recorded. A member of our team will contact you shortly to finalize your booking.\n\nThank you for your trust! 🙏`;
            }
          }
          await client.sendMessage(message.from, confirmationMsg);
        } else {
          // Update user intent with partial information
          userIntent.userInfo = mergedUserInfo;
          await userIntent.save();
          
          // Ask for the next specific field
          let nextQuestionMsg = '';
          if (lang === 'fr') {
            switch (nextField) {
              case 'nom_et_prenom':
                nextQuestionMsg = `Merci ! Maintenant, j'ai besoin de votre nom et prénom :`;
                break;
              case 'ville_actuelle':
                nextQuestionMsg = `Parfait ! Maintenant, dans quelle ville habitez-vous actuellement ?`;
                break;
              case 'email':
                nextQuestionMsg = `Excellent ! Maintenant, j'ai besoin de votre adresse email :`;
                break;
              case 'nombre_jours':
                nextQuestionMsg = `Parfait ! Pour combien de jours souhaitez-vous louer ?`;
                break;
              case 'date_debut':
                nextQuestionMsg = `Très bien ! À partir de quelle date souhaitez-vous commencer la location ? (format: JJ/MM/AAAA)`;
                break;
              default:
                nextQuestionMsg = `Merci ! J'ai besoin de plus d'informations.`;
            }
          } else {
            switch (nextField) {
              case 'first_and_last_name':
                nextQuestionMsg = `Thank you! Now I need your first and last name:`;
                break;
              case 'current_city':
                nextQuestionMsg = `Perfect! Now, in which city do you currently live?`;
                break;
              case 'email':
                nextQuestionMsg = `Excellent! Now I need your email address:`;
                break;
              case 'number_of_days':
                nextQuestionMsg = `Perfect! For how many days would you like to rent?`;
                break;
              case 'start_date':
                nextQuestionMsg = `Very good! From what date would you like to start the rental? (format: DD/MM/YYYY)`;
                break;
              default:
                nextQuestionMsg = `Thank you! I need more information.`;
            }
          }
          await client.sendMessage(message.from, nextQuestionMsg);
        }
        return;
      }

      // 2. If all info is present, search DB and generate a human-like reply
      if (userIntentObj.service && userIntentObj.town && userIntentObj.budget && userIntentObj.type) {
        userIntent.status = 'ready';
        await userIntent.save();
        // New precise search workflow
        const userBudget = userIntentObj.budget || 0;
        const userTown = userIntentObj.town?.toLowerCase() || '';
        const userService = userIntentObj.service?.toLowerCase() || '';
        
        console.log('[DEBUG] Search criteria:', { userTown, userService, userBudget });
        
        // Step 1: Get all documents of the correct type
        const Model: mongoose.Model<any> = userIntentObj.type === 'vehicule'
          ? (await import('../models/Vehicule')).default
          : (await import('../models/Immobilier')).default;
        
        let allDocs = await Model.find({}).lean();
        console.log('[DEBUG] Total documents found:', allDocs.length);
        
        // Step 2: Filter by town (localisationFr for immobilier, villeFr for vehicles)
        let townMatches = allDocs.filter((doc: any) => {
          if (userIntentObj.type === 'immobilier') {
            const localisationFr = (doc.localisationFr || '').toLowerCase();
            return localisationFr.includes(userTown) || userTown.includes(localisationFr);
          } else {
            const villeFr = (doc.villeFr || '').toLowerCase();
            return villeFr.includes(userTown) || userTown.includes(villeFr);
          }
        });
        console.log('[DEBUG] Town matches:', townMatches.length);
        
        // Step 3: Filter by service in description and/or categorie
        let serviceMatches = townMatches;
        if (userService) {
          serviceMatches = townMatches.filter((doc: any) => {
            const description = (doc.description || '').toLowerCase();
            const categorie = (doc.CategorieFr || '').toLowerCase();
            
            // Special handling for immobilier with "meublés" keyword
            if (userIntentObj.type === 'immobilier' && 
                (userService.includes('meublé') || userService.includes('meuble'))) {
              // Search for specific furnished categories
              const furnishedCategories = ['appartements meublés', 'studio meublés', 'maison meublés'];
              const hasFurnishedCategory = furnishedCategories.some(cat => 
                categorie.includes(cat.toLowerCase())
              );
              return hasFurnishedCategory || description.includes(userService);
            } else if (userIntentObj.type === 'vehicule') {
              // Enhanced service matching for vehicles - search in multiple fields
              const modele = (doc.modeleFr || '').toLowerCase();
              const marque = (doc.marqueFr || '').toLowerCase();
              const nom = (doc.nom || '').toLowerCase();
              
              return description.includes(userService) || 
                     categorie.includes(userService) || 
                     modele.includes(userService) || 
                     marque.includes(userService) || 
                     nom.includes(userService);
            } else {
              // Regular service matching for other immobilier
              return description.includes(userService) || categorie.includes(userService);
            }
          });
          console.log('[DEBUG] Service matches:', serviceMatches.length);
          
          // If no service matches, continue with town matches (skip service filter)
          if (serviceMatches.length === 0) {
            console.log('[DEBUG] No service matches, continuing with town matches only');
            serviceMatches = townMatches;
          }
        }
        
        // Step 4: Filter by budget with 25% tolerance
        let budgetMatches = serviceMatches;
        if (userBudget > 0) {
          const budgetTolerance = userBudget * 0.25;
          const minBudget = userBudget - budgetTolerance;
          const maxBudget = userBudget + budgetTolerance;
          
          budgetMatches = serviceMatches.filter((doc: any) => {
            const price = doc.prix || 0;
            return price >= minBudget && price <= maxBudget;
          });
          console.log('[DEBUG] Budget matches (25% tolerance):', budgetMatches.length);
        }
        
        // Use the final filtered results
        let matches = budgetMatches;
        let suggestions: any[] = [];
        
        // If no matches found, provide suggestions from town matches
        if (matches.length === 0) {
          suggestions = townMatches.slice(0, 3);
          console.log('[DEBUG] No matches found, using town suggestions');
        }
        
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
            introMsg = `Voici les meilleures options pour votre recherche de ${userIntentObj.service} à ${userIntentObj.town} avec un budget de ${userIntentObj.budget?.toLocaleString()} FCFA :`;
          } else {
            introMsg = `Here are the best options for your search for ${userIntentObj.service} in ${userIntentObj.town} with a budget of ${userIntentObj.budget?.toLocaleString()} FCFA:`;
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
        } else {
          // Filter suggestions using the same workflow
          const userBudget = userIntentObj.budget || 0;
          const userTown = userIntentObj.town?.toLowerCase() || '';
          const userService = userIntentObj.service?.toLowerCase() || '';
          
          const filteredSuggestions = suggestions.filter((suggestion: any) => {
            // Town check (localisationFr for immobilier, villeFr for vehicles)
            let isTownMatch = false;
            if (userIntentObj.type === 'immobilier') {
              const localisationFr = (suggestion.localisationFr || '').toLowerCase();
              isTownMatch = localisationFr.includes(userTown) || userTown.includes(localisationFr);
            } else {
              const villeFr = (suggestion.villeFr || '').toLowerCase();
              isTownMatch = villeFr.includes(userTown) || userTown.includes(villeFr);
            }
            
            // Budget check with 25% tolerance
            const price = suggestion.prix || 0;
            const budgetTolerance = userBudget * 0.25;
            const minBudget = userBudget - budgetTolerance;
            const maxBudget = userBudget + budgetTolerance;
            const isBudgetMatch = price >= minBudget && price <= maxBudget;
            
            // For suggestions, only check town and budget (skip service filter)
            return isTownMatch && isBudgetMatch;
          });
          
          if (filteredSuggestions.length > 0) {
            // Send filtered suggestions
            let suggestionsMsg = '';
            if (lang === 'fr') {
              suggestionsMsg = `Nous n'avons pas trouvé d'offres exactes, mais voici quelques alternatives dans votre budget et région :\n\n`;
            } else {
              suggestionsMsg = `We didn't find exact offers, but here are some alternatives within your budget and region:\n\n`;
            }
            
            for (let i = 0; i < Math.min(filteredSuggestions.length, 3); i++) {
              const suggestion = filteredSuggestions[i] as any;
              const productLink = `https://nimmo-auto.com/fr/produit/view/${suggestion.id}`;
              if (lang === 'fr') {
                suggestionsMsg += `${i + 1}. ${suggestion.nom || suggestion.modeleFr || suggestion.CategorieFr} à ${suggestion.localisationFr || suggestion.villeFr} - ${suggestion.prix?.toLocaleString()} FCFA\n🔗 ${productLink}\n\n`;
              } else {
                suggestionsMsg += `${i + 1}. ${suggestion.nom || suggestion.modeleEn || suggestion.CategorieEn} in ${suggestion.localisationEn || suggestion.villeEn} - ${suggestion.prix?.toLocaleString()} FCFA\n🔗 ${productLink}\n\n`;
              }
            }
            
            suggestionsMsg += lang === 'fr' 
              ? "Souhaitez-vous explorer d'autres options ou ajuster vos critères ?"
              : "Would you like to explore other options or adjust your criteria?";
            
            await client.sendMessage(message.from, suggestionsMsg);
            return;
          } else {
            // No filtered suggestions either - send no results message
            let noResultsMsg = '';
            if (lang === 'fr') {
              noResultsMsg = `Désolé, je n'ai pas trouvé d'offres correspondant à vos critères (${userIntentObj.service} à ${userIntentObj.town} pour ${userIntentObj.budget?.toLocaleString()} FCFA).\n\n💡 Suggestions:\n• Essayez avec un budget légèrement plus élevé\n• Recherchez dans une ville voisine\n• Spécifiez un autre type de véhicule\n\nDites-moi si vous souhaitez ajuster vos critères de recherche !`;
            } else {
              noResultsMsg = `Sorry, I couldn't find offers matching your criteria (${userIntentObj.service} in ${userIntentObj.town} for ${userIntentObj.budget?.toLocaleString()} FCFA).\n\n💡 Suggestions:\n• Try with a slightly higher budget\n• Search in a neighboring city\n• Specify a different vehicle type\n\nLet me know if you'd like to adjust your search criteria!`;
            }
            await client.sendMessage(message.from, noResultsMsg);
            return;
          }
        }
        const completion = await extractOpenAIReply(replyPrompt);
        await client.sendMessage(message.from, completion);
      } else {
        // 3. If info is missing, use OpenAI to ask for it conversationally
        // Skip this for new users since they already got the introduction message
        if (!isNewUser) {
        let missing = [];
        if (!userIntentObj.service) missing.push(lang === 'fr' ? 'le service ou le type de produit' : 'service or type of product');
        if (!userIntentObj.town) missing.push(lang === 'fr' ? 'la ville' : 'town or city');
        if (!userIntentObj.budget) missing.push(lang === 'fr' ? 'le budget' : 'budget');
          const askPrompt = `You are a friendly WhatsApp assistant. The user is looking for something, but you still need: ${missing.join(', ')}. Write a short, friendly, conversational message asking for this info. Do not bombard the user with questions; ask naturally and reference previous context if possible. IMPORTANT: Do not start your message with "Bonjour" or any greeting. Reply in ${lang === 'fr' ? 'French' : 'English'}.`;
        const completion = await extractOpenAIReply(askPrompt);
        await client.sendMessage(message.from, completion);
        }
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

// Helper to get the next field to ask for
function getNextFieldToAsk(userInfo: any, isRental: boolean, language: string): string | null {
  // Check fields in order of priority
  if (!userInfo.nom && !userInfo.prenom) {
    return language === 'fr' ? 'nom_et_prenom' : 'first_and_last_name';
  }
  if (!userInfo.villeActuelle) {
    return language === 'fr' ? 'ville_actuelle' : 'current_city';
  }
  
  // Additional fields for rental requests
  if (isRental) {
    if (!userInfo.email) {
      return 'email';
    }
    if (!userInfo.nombreJours) {
      return language === 'fr' ? 'nombre_jours' : 'number_of_days';
    }
    if (!userInfo.dateDebut) {
      return language === 'fr' ? 'date_debut' : 'start_date';
    }
  }
  
  return null; // All fields are complete
}

// Helper to get missing fields based on request type (for backward compatibility)
function getMissingFields(userInfo: any, isRental: boolean, language: string): string[] {
  const missingFields: string[] = [];
  
  // Basic fields for all requests
  if (!userInfo.nom && !userInfo.prenom) {
    missingFields.push(language === 'fr' ? '• Nom et prénom' : '• First and last name');
  }
  if (!userInfo.villeActuelle) {
    missingFields.push(language === 'fr' ? '• Ville actuelle' : '• Current city');
  }
  
  // Additional fields for rental requests
  if (isRental) {
    if (!userInfo.email) {
      missingFields.push(language === 'fr' ? '• Email' : '• Email');
    }
    if (!userInfo.nombreJours) {
      missingFields.push(language === 'fr' ? '• Nombre de jours' : '• Number of days');
    }
    if (!userInfo.dateDebut) {
      missingFields.push(language === 'fr' ? '• Date de début (JJ/MM/AAAA)' : '• Start date (DD/MM/YYYY)');
    }
  }
  
  return missingFields;
}

// Helper to extract user information from message
async function extractUserInfo(message: string, language: string, isRental: boolean = false): Promise<{nom?: string, prenom?: string, villeActuelle?: string, email?: string, nombreJours?: number, dateDebut?: string} | null> {
  try {
    let prompt = `You are an assistant that extracts user contact information from a WhatsApp message. Extract the following information as JSON (if not found, use null):

IMPORTANT: Look for names, cities, emails, numbers, and dates in the message. If the user provides a full name, split it into nom (last name) and prenom (first name).

{
  "nom": "last name (if provided)",
  "prenom": "first name (if provided)", 
  "villeActuelle": "current city (if provided)"`;

    if (isRental) {
      prompt += `,
  "email": "email address (if provided)",
  "nombreJours": number of days as number (if provided),
  "dateDebut": "start date in DD/MM/YYYY format (if provided)"`;
    }

    prompt += `}

Message: "${message}"
Language: ${language}
Is rental request: ${isRental}

Examples:
- "Bahanack Georges yvan" → {"prenom": "Georges yvan", "nom": "Bahanack"}
- "Douala" → {"villeActuelle": "Douala"}
- "Bahanack Georges" → {"prenom": "Georges", "nom": "Bahanack"}

Reply with only the JSON object:`;

    const openai = (await import('openai')).default;
    const client = new openai({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that extracts structured data from text.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 150,
      temperature: 0.2,
    });

    const text = completion.choices[0]?.message?.content || '{}';
    console.log('[DEBUG] OpenAI response:', text);
    
    const userInfo = JSON.parse(text.replace(/```json|```/g, '').trim());
    console.log('[DEBUG] Parsed user info:', userInfo);
    
    // Check if at least some information was extracted
    const hasInfo = userInfo.nom || userInfo.prenom || userInfo.villeActuelle || userInfo.email || userInfo.nombreJours || userInfo.dateDebut;
    console.log('[DEBUG] Has info:', hasInfo, 'Fields:', { nom: userInfo.nom, prenom: userInfo.prenom, villeActuelle: userInfo.villeActuelle });
    return hasInfo ? userInfo : null;
  } catch (error) {
    console.error('Error extracting user info:', error);
    return null;
  }
}

// Helper to transcribe voice messages using OpenAI Whisper
async function transcribeVoiceMessage(filePath: string): Promise<string | null> {
  try {
    console.log('[DEBUG] Starting voice transcription for:', filePath);
    
    const openai = (await import('openai')).default;
    const client = new openai({ apiKey: process.env.OPENAI_API_KEY });
    
    // Read the audio file
    const audioFile = fs.createReadStream(filePath);
    
    // Transcribe using OpenAI Whisper
    const transcription = await client.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'fr', // Default to French, but Whisper can auto-detect
      response_format: 'text'
    });
    
    console.log('[DEBUG] Transcription completed:', transcription);
    return transcription;
  } catch (error) {
    console.error('[ERROR] Error transcribing voice message:', error);
    return null;
  }
} 