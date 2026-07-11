import { User } from "../../data/db.js";
import type { IUser } from "../../types/models.js";

export const Users = {
    create: async (data: Omit<IUser, "createdAt" | "updatedAt">) => {
        const existingUser = await User.findOne({ phoneNumber: data.phoneNumber });
        if (existingUser) {
            throw new Error("User already exists");
        }

        const user = new User(data);
        await user.save();
        return user;
    },

    getByUsername: async (username: string) => {
        const user = await User.findOne({ username });
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
};