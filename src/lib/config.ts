export const Config = {
    get JWT_SECRET(): string {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new Error("JWT_SECRET environment variable is missing or empty.");
        }
        return secret;
    }
};