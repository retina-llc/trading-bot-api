import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD?.trim(), // Trim whitespace
});


export const connectDB = async (): Promise<void> => {
    try {
        await client.connect();
        console.log('Connected to PostgreSQL');
    } catch (error) {
        console.error('Database connection error:', (error as Error).message);
        throw error;
    }
};

export async function executeQuery(query: string, params: any[] = []): Promise<any> {
    console.log('Executing query:', query);
    console.log('With parameters:', params);
    try {
        const result = await client.query(query, params);
        console.log('Query result:', result.rows);
        return result.rows;
    } catch (error) {
        console.error('Error executing query:', (error as Error).message);
        throw error;
    }
}

export const disconnectDB = async (): Promise<void> => {
    try {
        await client.end();
        console.log('Disconnected from PostgreSQL');
    } catch (error) {
        console.error('Error disconnecting from database:', (error as Error).message);
        throw error;
    }
};
