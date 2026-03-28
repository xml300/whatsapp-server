import mongoose from "mongoose";

mongoose.connect("mongodb://127.0.0.1:27017/whatsapp")
.then(() => console.log("Connected to MongoDB"))
.catch((err) => console.log(err));

const userSchema = new mongoose.Schema({
    apiKey: String,
    phoneNumber: String
});

const credentialSchema = new mongoose.Schema({
    phoneNumber: String,
    credential: String,
}, {strict: false});

const keyStoreSchema = new mongoose.Schema({
    key: String,
    value: String,
    phoneNumber: String,
    type: String,
}, {strict: false});

export const User = mongoose.model("User", userSchema);
export const Credential = mongoose.model("Credential", credentialSchema);
export const KeyStore = mongoose.model("KeyStore", keyStoreSchema);