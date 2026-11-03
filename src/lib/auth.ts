import { Credential, KeyStore } from "../data/db.js";
import { BufferJSON, initAuthCreds, proto } from 'baileys';
import type { AuthenticationState, AuthenticationCreds, SignalDataTypeMap } from 'baileys';

const keyLocks = new Map<string, Promise<unknown>>();

async function withKeyLock<T>(phoneNumber: string, fn: () => Promise<T>): Promise<T> {
	const current = keyLocks.get(phoneNumber) ?? Promise.resolve();
	let resolveLock!: () => void;
	const next = new Promise<void>((resolve) => {
		resolveLock = resolve;
	});
	keyLocks.set(phoneNumber, next);

	try {
		await current.catch(() => {});
		return await fn();
	} finally {
		resolveLock();
		if (keyLocks.get(phoneNumber) === next) {
			keyLocks.delete(phoneNumber);
		}
	}
}
 
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
		if (ids.length === 0) return [];
		const compositeKeys = ids.map(id => `${type}-${id}`);
		const keys = await KeyStore.find({ phoneNumber: phoneNumber, key: { $in: compositeKeys } }).lean();
		return keys.map(key => {
			const value = JSON.parse(key.value || "null", BufferJSON.reviver);
			return {
				id: key.id as string,
				value: type === 'app-state-sync-key' ? proto.Message.AppStateSyncKeyData.fromObject(value) : value
			}
		});
	}

	const creds: AuthenticationCreds = await withKeyLock(phoneNumber, () => readCreds());


	return {
		state: {
			creds,
			keys: {
				get: async (type, ids) => {
					return withKeyLock(phoneNumber, async () => {
						const data: { [_: string]: SignalDataTypeMap[typeof type] } = {}
						const keys = await readKeys(type, ids);
						keys.forEach(({id, value}) => {
							data[id] = value;
						});
						return data;
					});
				},
				set: async (data: any) => {
					return withKeyLock(phoneNumber, async () => {
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

						const ops: any[] = keys.map(entry => ({
							updateOne: {
								filter: { phoneNumber: phoneNumber, key: entry.key },
								update: { $set: entry },
								upsert: true
							}
						}));
						if (toDeleteKeys.length > 0) {
							ops.push({
								deleteMany: {
									filter: { phoneNumber: phoneNumber, key: { $in: toDeleteKeys } }
								}
							});
						}
						if (ops.length > 0) {
							await KeyStore.bulkWrite(ops);
						}
					});
				}
			}
		},
		saveCreds: async () => {
			return withKeyLock(phoneNumber, () => writeCreds(creds));
		}
	}
}