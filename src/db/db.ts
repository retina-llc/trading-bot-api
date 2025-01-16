// db.ts
import { Client } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const sslCertPath = process.env.SSL_CERT_PATH || path.resolve(__dirname, '../certs/us-east-1-bundle.pem');

// Define the sslOptions with a union type
let sslOptions: boolean | { rejectUnauthorized: boolean; ca: string } = false;

// Read the SSL certificate if SSL mode is 'verify-full'
if (process.env.DB_SSLMODE === 'verify-full') {
  if (fs.existsSync(sslCertPath)) {
    sslOptions = {
      rejectUnauthorized: true, // Ensures the server certificate is verified
      ca: fs.readFileSync(sslCertPath).toString(),
    };
    console.log('pg Client SSL is enabled with the provided certificate.');
  } else {
    console.error(`pg Client SSL certificate not found at path: ${sslCertPath}`);
    throw new Error(`SSL certificate not found at path: ${sslCertPath}`);
  }
} else {
  console.warn('pg Client SSL is not enabled. It is recommended to use SSL for database connections.');
}

const client = new Client({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD?.trim(), // Trim whitespace
  ssl: sslOptions,
});

export const connectDB = async (): Promise<void> => {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL via pg Client');
  } catch (error) {
    console.error('Database connection error via pg Client:', (error as Error).message);
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
    console.error('Error executing query via pg Client:', (error as Error).message);
    throw error;
  }
}

export const disconnectDB = async (): Promise<void> => {
  try {
    await client.end();
    console.log('Disconnected from PostgreSQL via pg Client');
  } catch (error) {
    console.error('Error disconnecting from database via pg Client:', (error as Error).message);
    throw error;
  }
};
