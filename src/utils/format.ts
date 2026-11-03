export function formatJid(phoneNumber: string): string {
    if (phoneNumber.includes("@")) {
        return phoneNumber;
    }
    return `${phoneNumber}@s.whatsapp.net`;
}

export function normalizePhoneNumber(phoneNumber: string) {
    phoneNumber = phoneNumber.replace(/\D/g, "");

    if (phoneNumber.length === 13 && phoneNumber.startsWith("234")) {
        return phoneNumber;
    }

    if (phoneNumber.length === 11 && phoneNumber.startsWith("0")) {
        return "234" + phoneNumber.slice(1);
    }

    if (phoneNumber.length === 10 && /^(7|8|9)/.test(phoneNumber)) {
        return "234" + phoneNumber;
    }

    return null;
}

export function isValidGroupJid(val: string): boolean {
    return typeof val === "string" && /^[0-9-]+@g\.us$/i.test(val.trim());
}

export function formatGroupJid(val: string): string | null {
    if (typeof val !== "string") {
        return null;
    }
    let t = val.trim();
    if (!t.includes("@") && /^[0-9-]+$/.test(t)) {
        t = `${t}@g.us`;
    }
    return isValidGroupJid(t) ? t : null;
}

export function isValidNewsletterJid(val: string): boolean {
    return typeof val === "string" && /^[0-9a-zA-Z_-]+@newsletter$/i.test(val.trim());
}

export function formatNewsletterJid(val: string): string | null {
    if (typeof val !== "string") {
        return null;
    }
    let t = val.trim();
    if (!t.includes("@") && /^[0-9a-zA-Z_-]+$/.test(t)) {
        t = `${t}@newsletter`;
    }
    return isValidNewsletterJid(t) ? t : null;
}

export function normalizeParticipantJid(val: string): string | null {
    if (typeof val !== "string") {
        return null;
    }
    const t = val.trim();
    const lower = t.toLowerCase();
    if (lower.endsWith("@s.whatsapp.net") || lower.endsWith("@lid")) {
        return t;
    }
    const normalized = normalizePhoneNumber(t);
    if (normalized) {
        return `${normalized}@s.whatsapp.net`;
    }
    return null;
}

export function buildVCard(contact: { displayName: string; phoneNumber?: string; vcard?: string }): string {
    if (contact.vcard && contact.vcard.trim().length > 0) {
        return contact.vcard.trim();
    }

    const displayName = contact.displayName || "";
    const lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${displayName}`,
        `N:;${displayName};;;`
    ];

    if (contact.phoneNumber && contact.phoneNumber.trim()) {
        const rawPhone = contact.phoneNumber.trim();
        const normalized = normalizePhoneNumber(rawPhone);
        const waid = normalized || rawPhone.replace(/\D/g, "");
        if (waid) {
            lines.push(`TEL;type=CELL;type=VOICE;waid=${waid}:+${waid}`);
        } else {
            lines.push(`TEL;type=CELL;type=VOICE:${rawPhone}`);
        }
    }

    lines.push("END:VCARD");
    return lines.join("\n");
}
