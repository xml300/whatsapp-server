import mongoose from "mongoose";
import "dotenv/config";

const DATABASE_URL = process.env.MONGODB_URL;

if(!DATABASE_URL){
    throw new Error("Please provide a MongoDB URL");
}

mongoose.connect(DATABASE_URL)
.then(() => console.log("Connected to MongoDB"))
.catch((err) => console.log(err));

const userSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true
    },
    apiKey: String,
    phoneNumber: String,
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

const credentialSchema = new mongoose.Schema({
    phoneNumber: String,
    credential: String,
});

const keyStoreSchema = new mongoose.Schema({
    key: String,
    value: String,
    phoneNumber: String,
    type: String,
    id: String,
});

export const User = mongoose.model("User", userSchema);
export const Credential = mongoose.model("Credential", credentialSchema);
export const KeyStore = mongoose.model("KeyStore", keyStoreSchema);