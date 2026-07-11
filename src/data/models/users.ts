import { createHash } from "crypto";

import { User } from "../../data/db.js";
import type { IUser } from "../../types/models.js";

export const Users = {
    create: async (data: Omit<IUser, "_id" | "createdAt" | "updatedAt">) => {
        const existingUser = await User.findOne({ username: data.username });
        if (existingUser) {
            throw new Error("User already exists");
        }

        const user = new User({
            _id: createHash('sha256').update(data.username).digest('hex'),
            ...data
        });
        await user.save();
        return user;
    },

    getById: async (id: string) => {
        const user = await User.findById(id);
        if (!user) return null;
        return user;
    },

    getByUsername: async (username: string) => {
        const user = await User.findOne({ username });
        if (!user) return null;
        return user;
    },

    getByPhoneNumber: async (phoneNumber: string) => {
        const user = await User.findOne({ phoneNumber });
        if (!user) return null;
        return user;
    },

    update: async (id: string, update: Record<string, any>) => {
        const user = await User.findOneAndUpdate({ _id: id }, update, { new: true });
        return user;
    },
};