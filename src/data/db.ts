import mongoose from "mongoose";

mongoose.connect("mongodb://127.0.0.1:27017/whatsapp")
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