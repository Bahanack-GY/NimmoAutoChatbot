import mongoose, { Document, Schema } from "mongoose";

export interface IVehicule extends Document {
  id: number;
  CategorieFr: string;
  CategorieEn: string;
  modeleFr: string;
  modeleEn: string;
  marqueFr: string;
  marqueEn: string;
  villeFr: string;
  villeEn: string;
  nom: string;
  prix: number;
  annee?: number | null;
  kilometrage?: number | null;
  description: string;
  image1?: string;
  image2?: string;
  image3?: string;
  image4?: string;
  image5?: string;
  fetchedAt?: Date;
}

const VehiculeSchema = new Schema<IVehicule>({
  id: { type: Number, required: true, unique: true },
  CategorieFr: { type: String },
  CategorieEn: { type: String },
  modeleFr: { type: String },
  modeleEn: { type: String },
  marqueFr: { type: String },
  marqueEn: { type: String },
  villeFr: { type: String },
  villeEn: { type: String },
  nom: { type: String },
  prix: { type: Number },
  annee: { type: Number, default: null },
  kilometrage: { type: Number, default: null },
  description: { type: String },
  image1: String,
  image2: String,
  image3: String,
  image4: String,
  image5: String,
  fetchedAt: { type: Date },
});

const Vehicule = mongoose.model<IVehicule>("Vehicule", VehiculeSchema);

export default Vehicule; 