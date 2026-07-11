export interface IUser {
    _id: string,
    username: string,
    password: string,
    phoneNumber: string,
    createdAt: Date,
    updatedAt: Date
}

export interface IApiKey {
    _id: string,
    userId: string,
    apiKey: string,
    createdAt: Date,
    updatedAt: Date
}