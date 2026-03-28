import { Credential, KeyStore } from "../data/db.js";
import { BufferJSON, initAuthCreds, proto } from 'baileys';
import type { AuthenticationState, AuthenticationCreds, SignalDataTypeMap } from 'baileys';
 
export const useNoSQLAuthState = async (
	phoneNumber: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> => {

	const writeCreds = async (creds: AuthenticationCreds) => {
		await Credential.findOneAndUpdate({phoneNumber: phoneNumber}, 
			{$set: {credential: JSON.stringify(creds, BufferJSON.replacer)}}, {upsert: true});
	}

	const readCreds = async () => {
		try{
			const cred = await Credential.findOne({phoneNumber: phoneNumber});
			if(cred?.credential === null || cred?.credential === undefined){
				throw new Error("No credentials found");
			}
			return JSON.parse(cred.credential, BufferJSON.reviver);
		}catch(error){
			return initAuthCreds();
		}
	}

	const readKeys = async (type: string, ids: string[]) => {
		const keys = await KeyStore.find({phoneNumber: phoneNumber, type: type, id: {$in: ids}});
		return keys.map(key => {
			const value = JSON.parse(key.value || "null", BufferJSON.reviver);
			return {
				...key,
				value: type === 'app-state-sync-key' ? proto.Message.AppStateSyncKeyData.fromObject(value) : value
			}
		});
	}

	const creds: AuthenticationCreds = await readCreds();


	return {
		state: {
			creds,
			keys: {
				get: async (type, ids) => {
					const data: { [_: string]: SignalDataTypeMap[typeof type] } = {}
					const keys = await readKeys(type, ids);
					keys.forEach(({id, value}) => {
						data[id] = value;
					});
					return data;
				},
				set: async (data: any) => {
					const keys: any[] = [];
					const toDeleteKeys: any[] = [];

					for (const category in data) {
						for (const id in data[category as keyof SignalDataTypeMap]) {
							const value = data[category as keyof SignalDataTypeMap]![id]
							const key = `${category}-${id}`;

							if(value){
								keys.push({
									phoneNumber: phoneNumber,
									key: key,
									type: category,
									id: id,
									value: JSON.stringify(value, BufferJSON.replacer)
								});
							}else{
								toDeleteKeys.push(key);
							}
						}
					}

					const ops = keys.map(entry => ({
						updateOne: {
							filter: {phoneNumber: phoneNumber, key: entry.key},
							update: {$set: entry},
							upsert: true
						}
					}))
					 
					if(ops.length > 0){
						await KeyStore.bulkWrite(ops);
					}
					if(toDeleteKeys.length > 0){
						await KeyStore.deleteMany({ phoneNumber: phoneNumber, key: { $in: toDeleteKeys } });
					}
				}
			}
		},
		saveCreds: async () => {
			return writeCreds(creds);
		}
	}
}