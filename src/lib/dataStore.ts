import fs from "fs";

class DataStore {
    constructor(){

    }

    readData(key: string){
        const db = JSON.parse(fs.readFileSync("./src/data/db.json", "utf-8"));
        return db.find((item: Record<string, any>) => Object.values(item)[0] === key);
    }

    writeData(row: Record<string, any>){
        const db = fs.readFileSync("./src/data/db.json", "utf-8");
        const data = JSON.parse(db);
        data.push(row);
        fs.writeFileSync("./src/data/db.json", JSON.stringify(data));
    }

}

export const dataStore = new DataStore();