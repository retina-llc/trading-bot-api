import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from './api/user/user-entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'postgres',
  synchronize: false, // Always false in production
  logging: true,
  entities: [User], // Add your entities here
  migrations: ['./src/migrations/*.ts'],
  subscribers: [],
});
