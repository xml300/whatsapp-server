export interface IUser {
    _id: string,
    username: string,
    password: string,
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

export interface IPhoneNumber {
    userId: string,
    phoneNumber: string
};

export interface ISession {
    id: string,
    userId: string,
    phoneNumber: string
};

export interface IEvent {
    _id?: string | undefined;
    userId: string;
    sessionId: string;
    eventType: string;
    payload: any;
    createdAt?: Date | undefined;
}
