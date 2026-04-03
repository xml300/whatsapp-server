import { User } from "../data/db.js";

class DataStore {
    constructor(){

    }

    async createUser(row: Record<string, any>){
        const existingUser = await User.findOne({phoneNumber: row.phoneNumber});
        if(existingUser){
            throw new Error("User already exists");
        }

        const user = new User(row);
        await user.save();
        return user;
    }

    async getUser(apiKey: string){
        const user = await User.findOne({apiKey});
        return user;
    }

    async updateUser(phoneNumber: string, update: Record<string, any>){
        const user = await User.findOneAndUpdate({phoneNumber}, update, {new: true});
        return user;
    }
}

export const dataStore = new DataStore();