import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  email!: string;

  @Column()
  password!: string;

  @Column({ type: 'varchar', nullable: true })
  wallet_address!: string | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  @Column({ type: 'boolean', default: false })
  has_subscription!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  subscription_expiry!: Date | null; // New field for subscription expiry

  @Column({ type: 'jsonb', default: {} })
apiKeys!: Partial<{
  bitmartApiKey: string;
  bitmartApiSecret: string;
  bitmartApiMemo: string;
  monitoringApiKey: string;
  monitoringApiSecret: string;
  monitoringApiMemo: string;
}> | null;
@Column('decimal', { precision: 10, scale: 2, default: 0 })
partial_usd_balance: number = 0;


}
