import mongoose, { Document, Schema } from 'mongoose';

export interface IUserIntent extends Document {
  userId: string;
  service?: string;
  town?: string;
  budget?: number;
  type?: 'vehicule' | 'immobilier';
  language?: 'fr' | 'en';
  lastProposedIds?: number[];
  status: 'collecting' | 'ready';
  lastUpdated: Date;
  localisationFr?: string;
  localisationEn?: string;
}

const UserIntentSchema = new Schema<IUserIntent>({
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

const UserIntent = mongoose.model<IUserIntent>('UserIntent', UserIntentSchema);

export default UserIntent; 