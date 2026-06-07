import { User } from "../data/db.js";

export const Users = {
    create: async (row: Record<string, any>) => {
        const existingUser = await User.findOne({ phoneNumber: row.phoneNumber });
        if (existingUser) {
            throw new Error("User already exists");
        }

        const user = new User(row);
        await user.save();
        return user;
    },

    get: async (apiKey: string) => {
        const user = await User.findOne({ apiKey });
        return user;
    },

    getByPhoneNumber: async (phoneNumber: string) => {
        const user = await User.findOne({ phoneNumber });
        return user;
    },

    update: async (phoneNumber: string, update: Record<string, any>) => {
        const user = await User.findOneAndUpdate({ phoneNumber }, update, { new: true });
        return user;
    },
}
