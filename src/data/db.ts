import mongoose from "mongoose";
import "dotenv/config";
import { logger } from "../lib/logger.js";
import type { IApiKey, IUser } from "../types/models.js";

const DATABASE_URL = process.env.MONGODB_URL;

if(!DATABASE_URL){
    throw new Error("Please provide a MongoDB URL");
}

mongoose.connect(DATABASE_URL)
.then(() => logger.info("Connected to MongoDB"))
.catch((err) => logger.error("Failed to connect to MongoDB " + err));

const userSchema = new mongoose.Schema<IUser>({
    _id: {
        type: String,
        required: true
    },
    username: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

const apiKeySchema = new mongoose.Schema<IApiKey>({
    userId: String,
    apiKey: String,
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

const phoneNumbersSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    phoneNUmber: {
        type: String,
        required: true
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

const sessionSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true
    },
    userId: {
        type: String,
        required: true
    },
    phoneNumber: {
        type: String,
        required: true
    }
});


export const User = mongoose.model<IUser>("User", userSchema);
export const ApiKey = mongoose.model<IApiKey>("ApiKey", apiKeySchema);
export const PhoneNumber = mongoose.model("PhoneNumber", phoneNumbersSchema);
export const Credential = mongoose.model("Credential", credentialSchema);
export const KeyStore = mongoose.model("KeyStore", keyStoreSchema);
export const Log = mongoose.model("Log", logSchema);
export const Session = mongoose.model("Session", sessionSchema);