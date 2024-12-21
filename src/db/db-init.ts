import { connectDB, disconnectDB } from './db';

const createUsersTable = async (): Promise<void> => {
    const query = `
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            wallet_address VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;

    try {
        await connectDB();
        console.log('Users table created successfully');
    } catch (error) {
        console.error('Error creating users table:', error);
    } finally {
        await disconnectDB();
    }
};

createUsersTable();
