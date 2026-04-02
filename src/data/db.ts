import mongoose from "mongoose";
import "dotenv/config";
import { logger } from "../lib/logger.js";

const DATABASE_URL = process.env.MONGODB_URL;

if(!DATABASE_URL){
    throw new Error("Please provide a MongoDB URL");
}

mongoose.connect(DATABASE_URL)
.then(() => logger.info("Connected to MongoDB"))
.catch((err) => logger.error("Failed to connect to MongoDB " + err));

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
    id: String,
    key: String,
    value: String,
    phoneNumber: String,
    type: String,
});

const logSchema = new mongoose.Schema({
    id: String,
    source: String,
    message: String,
    level: String,
    timestamp: Date,
});


export const User = mongoose.model("User", userSchema);
export const Credential = mongoose.model("Credential", credentialSchema);
export const KeyStore = mongoose.model("KeyStore", keyStoreSchema);
export const Log = mongoose.model("Log", logSchema);