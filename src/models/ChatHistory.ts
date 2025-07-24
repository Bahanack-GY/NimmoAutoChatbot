import mongoose, { Document, Schema } from 'mongoose';

export interface IChatHistory extends Document {
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const ChatHistorySchema = new Schema<IChatHistory>({
  userId: { type: String, required: true, index: true },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now, index: true },
});

const ChatHistory = mongoose.model<IChatHistory>('ChatHistory', ChatHistorySchema);

export default ChatHistory; 