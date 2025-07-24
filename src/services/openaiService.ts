import OpenAI from 'openai';
import ChatHistory, { IChatHistory } from '../models/ChatHistory';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: "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",
});

// System prompt for the AI assistant
const SYSTEM_PROMPT = `You are NimmoBot, a helpful WhatsApp assistant. You should:\n\n1. Be friendly and conversational\n2. Keep responses concise and relevant\n3. Help users with their questions and requests\n4. Respond in a natural, human-like way\n5. If you don't know something, be honest about it\n6. Use simple language that's easy to understand\n\nRemember: You're chatting on WhatsApp, so keep responses appropriate for a messaging platform.`;

const MAX_HISTORY_LENGTH = 500;

/**
 * Get AI response for a user message, using persistent chat history from MongoDB
 * @param userId - The WhatsApp user ID
 * @param userMessage - The message from the user
 * @returns Promise<string> - The AI response
 */
export const getAIResponse = async (userId: string, userMessage: string): Promise<string> => {
  try {
    // Store the user message in DB
    await ChatHistory.create({
      userId,
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    });

    // Fetch the latest 500 messages for this user (oldest to newest)
    const historyDocs: IChatHistory[] = await ChatHistory.find({ userId })
      .sort({ timestamp: 1 })
      .limit(MAX_HISTORY_LENGTH)
      .lean();

    // Build the conversation for OpenAI
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...historyDocs.map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content })),
    ];

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      max_tokens: 150, // Limit response length for WhatsApp
      temperature: 0.7, // Balanced creativity
    });

    const aiResponse = completion.choices[0]?.message?.content || 'Sorry, I couldn\'t generate a response right now.';

    // Store the AI response in DB
    await ChatHistory.create({
      userId,
      role: 'assistant',
      content: aiResponse,
      timestamp: new Date(),
    });

    return aiResponse;
  } catch (error) {
    console.error('❌ OpenAI API error:', error);
    // Return a fallback response
    return 'Sorry, I\'m having trouble connecting to my AI service right now. Please try again later.';
  }
};

/**
 * Clear conversation history for a specific user (from DB)
 * @param userId - The WhatsApp user ID
 */
export const clearUserHistory = async (userId: string): Promise<void> => {
  await ChatHistory.deleteMany({ userId });
  console.log(`🗑️ Cleared conversation history for user: ${userId}`);
};

/**
 * Get conversation history for a specific user (from DB)
 * @param userId - The WhatsApp user ID
 * @returns Promise<IChatHistory[]> - The conversation history
 */
export const getUserHistory = async (userId: string): Promise<IChatHistory[]> => {
  return ChatHistory.find({ userId }).sort({ timestamp: 1 }).lean();
};

/**
 * Get total number of active conversations (distinct users in DB)
 * @returns Promise<number> - Number of users with active conversations
 */
export const getActiveConversationsCount = async (): Promise<number> => {
  return ChatHistory.distinct('userId').then(users => users.length);
};

/**
 * Extracts user intent (service, town, budget, type, language) from chat history and latest message.
 * Returns an object with the extracted fields (if found).
 */
export const extractUserIntent = async (userId: string, userMessage: string): Promise<{service?: string, town?: string, budget?: number, type?: 'vehicule' | 'immobilier', language?: 'fr' | 'en'}> => {
  // Fetch recent chat history
  const historyDocs: IChatHistory[] = await ChatHistory.find({ userId })
    .sort({ timestamp: 1 })
    .limit(20)
    .lean();

  const historyText = historyDocs.map(msg => `${msg.role === 'user' ? 'User' : 'Bot'}: ${msg.content}`).join('\n');

  const prompt = `You are an assistant that extracts a user's intent from a WhatsApp conversation.\n\nConversation:\n${historyText}\nUser: ${userMessage}\n\nExtract the following as JSON (if you don't know, use null):\n{\n  "service": string | null, // what service or product is the user looking for?\n  "town": string | null, // what town or city is the user interested in?\n  "budget": number | null, // what is the user's budget (FCFA)?\n  "type": "vehicule" | "immobilier" | null, // is the user looking for a vehicle or real estate?\n  "language": "fr" | "en" | null // what is the user's language?\n}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'You are a helpful assistant that extracts structured data from chat.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 200,
    temperature: 0.2,
  });

  const text = completion.choices[0]?.message?.content || '{}';
  try {
    const json = JSON.parse(text.replace(/```json|```/g, '').trim());
    return {
      service: json.service || undefined,
      town: json.town || undefined,
      budget: json.budget || undefined,
      type: json.type || undefined,
      language: json.language || undefined,
    };
  } catch {
    return {};
  }
}; 