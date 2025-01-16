// data-source.ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from './api/user/user-entity';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// Resolve the SSL certificate path
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
    console.log('TypeORM SSL is enabled with the provided certificate.');
  } else {
    console.error(`TypeORM SSL certificate not found at path: ${sslCertPath}`);
    throw new Error(`SSL certificate not found at path: ${sslCertPath}`);
  }
} else {
  console.warn('TypeORM SSL is not enabled. It is recommended to use SSL for database connections.');
}

// Log the connection configuration (excluding sensitive information)
console.log('TypeORM Connection Configuration:');
console.log({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  username: process.env.DB_USER,
  database: process.env.DB_NAME,
  ssl: sslOptions,
});

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'postgres',
  synchronize: false, // Always false in production
  logging: ['error', 'warn', 'info', 'query'], // Enable detailed logging
  entities: [User], // Add your entities here
  migrations: ['./src/migrations/*.ts'],
  subscribers: [],
  extra: {
    ssl: sslOptions, // Correctly nested within 'extra'
  },
});

// Initialize the DataSource
AppDataSource.initialize()
  .then(() => {
    console.log('TypeORM connected to PostgreSQL database successfully.');
  })
  .catch((error) => {
    console.error('TypeORM failed to connect to the database:', error);
  });
