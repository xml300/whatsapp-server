import { Credential, KeyStore } from "./db.js";

export async function clearSessionKeys(phoneNumber: string) {
    try {
        await Promise.all([
            KeyStore.deleteMany({ phoneNumber }),
            Credential.deleteMany({ phoneNumber })
        ]);
        return true;
    } catch {
        return false;
    }
}

export async function clearUserKeys(phoneNumber: string) {
    return clearSessionKeys(phoneNumber);
}

