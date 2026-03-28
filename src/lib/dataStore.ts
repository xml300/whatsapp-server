import fs from "fs";
import { User } from "../data/db.js";

class DataStore {
    constructor(){

    }

    async createUser(row: Record<string, any>){
        const user = new User(row);
        await user.save();
        return user;
    }

    async getUser(apiKey: string){
        const user = await User.findOne({apiKey});
        return user;
    }
}

export const dataStore = new DataStore();