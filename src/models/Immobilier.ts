import mongoose, { Document, Schema } from "mongoose";

export interface IImmobilier extends Document {
  id: number;
  CategorieFr: string;
  CategorieEn: string;
  nom: string;
  prix: number;
  localisationFr: string;
  localisationEn: string;
  superficie: number;
  placeassise?: number;
  chambre: number;
  douche?: number;
  description: string;
  image1?: string;
  image2?: string;
  image3?: string;
  image4?: string;
  image5?: string;
  fetchedAt: { type: Date };
}

const ImmobilierSchema = new Schema<IImmobilier>({
  id: { type: Number, required: true, unique: true },
  CategorieFr: { type: String },
  CategorieEn: { type: String },
  nom: { type: String },
  prix: { type: Number },
  localisationFr: { type: String },
  localisationEn: { type: String },
  superficie: { type: Number },
  placeassise: { type: Number, default: 0 },
  chambre: { type: Number },
  douche: { type: Number, default: 0 },
  description: { type: String },
  image1: String,
  image2: String,
  image3: String,
  image4: String,
  image5: String,
  fetchedAt: { type: Date },
});

const Immobilier = mongoose.model<IImmobilier>("Immobilier", ImmobilierSchema);

export default Immobilier;
